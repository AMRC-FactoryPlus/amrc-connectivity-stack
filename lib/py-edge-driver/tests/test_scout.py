# ACS Edge Agent driver library
# Edge Scout tests, against a fake MQTT client
# Copyright 2026 University of Sheffield
#
# Every message the library publishes is checked against the schemas
# in lib/edge-scout-schemas.

import asyncio
import json
import time
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from amrc.factoryplus.edge_driver import (
    Handler, PolledDriver, ReadValue, ScoutEnd, ScoutError, ScoutStopped,
)
from amrc.factoryplus.edge_driver.driver import Driver
from amrc.factoryplus.edge_driver.scout import (
    LIBRARY_NAME, READ_TIMEOUT_S, clamp_limits, value_text,
)

SCHEMAS = Path(__file__).resolve().parents[2] / "edge-scout-schemas"


def _load_schemas():
    schemas = {}
    for f in (SCHEMAS / "schemas").glob("*.schema.json"):
        schema = json.loads(f.read_text())
        schemas[schema["$id"]] = schema
    registry = Registry().with_resources(
        (sid, Resource.from_contents(s)) for sid, s in schemas.items())
    return {
        name: Draft202012Validator(schemas[f"urn:edge-scout:{name}"], registry=registry)
        for name in ("found", "item", "request")
    }


VALIDATORS = _load_schemas()


def fixtures(kind, schema):
    out = []
    for f in sorted((SCHEMAS / "fixtures" / kind).glob("*.json")):
        fx = json.loads(f.read_text())
        if fx.get("schema") == schema:
            out.append((f.name, fx))
    return out


FEATURES = {"scout": 1}
LIMITS = {"items": 20000, "depth": 8, "seconds": 120, "pace_ms": 0, "samples": False}


class FakeInfo:
    rc = 0


class FakeMqtt:
    """A stand-in for the paho client that records what the driver
    does."""

    def __init__(self):
        self.connected = True
        self.published = []
        self.subscribed = []
        self.fail_subscribe = False

    def is_connected(self):
        return self.connected

    def publish(self, topic, payload=None, *args, **kwargs):
        self.published.append((topic, payload))
        return FakeInfo()

    def subscribe(self, topic, *args, **kwargs):
        if self.fail_subscribe:
            return (4, None)
        topics = [t if isinstance(t, str) else t[0]
                  for t in (topic if isinstance(topic, list) else [topic])]
        self.subscribed.extend(topics)
        return (0, 1)


def scout_handler(scout_fn, valid_addrs=None, scouts=True, read_fn=None):
    class ScoutHandler(Handler):
        validAddrs = valid_addrs

        @classmethod
        def create(cls, driver, conf):
            return cls()

        def close(self, callback=None):
            if callback:
                callback()

        async def connect(self):
            return "UP"

        def scout(self, request, out):
            return scout_fn(request, out)

        def read_values(self, addresses):
            return read_fn(addresses)

    ScoutHandler.scouts = scouts
    ScoutHandler.reads = read_fn is not None
    return ScoutHandler


def make_driver(handler_class, cls=Driver, **timing):
    driver = cls(handler=handler_class, edge_username="Conn",
                 edge_mqtt="mqtt://localhost:1883", edge_password="x")
    driver.mqtt = FakeMqtt()
    driver.scouter.progress_s = timing.get("progress_s", 60)
    driver.scouter.grace_s = timing.get("grace_s", 0.05)
    driver.scouter.flush_s = 0.005
    return driver


def found(driver, scan_id):
    topic = f"fpEdge1/Conn/found/{scan_id}"
    msgs = []
    for t, p in driver.mqtt.published:
        if t != topic:
            continue
        msg = json.loads(p)
        VALIDATORS["found"].validate(msg)
        if msg["type"] == "items":
            for item in msg["items"]:
                VALIDATORS["item"].validate(item)
        msgs.append(msg)
    return msgs


def seqs_ok(msgs):
    assert [m["seq"] for m in msgs] == list(range(len(msgs)))


def scouts_subscribed(driver):
    return [t for t in driver.mqtt.subscribed if t.endswith("/scout")]


async def ready(driver, conf=None):
    driver._loop = asyncio.get_running_loop()
    await driver.conf_handler(json.dumps(conf or {}))
    await driver.set_addrs({"version": 1, "addrs": {}, "groups": {}, "features": FEATURES})


async def scan(driver, scan_id, **extra):
    msg = {"op": "start", "id": scan_id, "version": 1, "root": None,
           "folder_id": None, "options": {}, "limits": LIMITS, **extra}
    await driver.scouter.handle(json.dumps(msg))
    return found(driver, scan_id)


def tree(n, parent=None, prefix="n"):
    return [{"id": f"{prefix}{i}", "parent": parent, "name": f"Item {i}",
             "kind": "value", "address": f"{prefix}{i}"} for i in range(n)]


async def nothing(request, out):
    return {}


# The gate

async def test_features_read_before_the_handler_check():
    driver = make_driver(scout_handler(nothing))
    assert driver.handler is None

    ok = await driver.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})

    assert ok is False
    assert scouts_subscribed(driver) == ["fpEdge1/Conn/scout"]


async def test_features_read_before_the_version_check():
    driver = make_driver(scout_handler(nothing))
    driver.setup_handler({})

    ok = await driver.set_addrs({"version": 9, "addrs": {}, "features": FEATURES})

    assert ok is False
    assert scouts_subscribed(driver) == ["fpEdge1/Conn/scout"]


async def test_a_bad_address_map_still_subscribes():
    driver = make_driver(scout_handler(nothing, valid_addrs={"good"}))
    driver.setup_handler({})

    await driver.addr_handler(json.dumps(
        {"version": 1, "addrs": {"1": "bad"}, "groups": {}, "features": FEATURES}))

    assert driver.status == "ADDR"
    assert scouts_subscribed(driver) == ["fpEdge1/Conn/scout"]


@pytest.mark.parametrize("features", [
    None, {}, {"scout": 2}, {"scout": "1"}, {"scout": 0}, {"scout": True},
    "scout", [1], {"other": 1},
])
async def test_no_subscription_without_a_known_feature(features):
    driver = make_driver(scout_handler(nothing))
    driver.setup_handler({})
    pkt = {"version": 1, "addrs": {}, "groups": {}}
    if features is not None:
        pkt["features"] = features
    await driver.set_addrs(pkt)
    assert scouts_subscribed(driver) == []


async def test_once_per_session_and_never_on_connect():
    driver = make_driver(scout_handler(nothing))
    assert "scout" not in driver.message_handlers

    driver.connected()
    assert scouts_subscribed(driver) == []
    assert driver.mqtt.subscribed == [
        f"fpEdge1/Conn/{t}" for t in driver.message_handlers]

    await ready(driver)
    await ready(driver)
    assert scouts_subscribed(driver) == ["fpEdge1/Conn/scout"]

    # A new session forgets the feature. An older agent sends no
    # features key, so the driver never asks again.
    driver.mqtt.subscribed.clear()
    driver.connected()
    await asyncio.sleep(0)
    await driver.addr_handler(json.dumps({"version": 1, "addrs": {}, "groups": {}}))
    assert scouts_subscribed(driver) == []
    assert driver.scout_seen is False

    await ready(driver)
    assert scouts_subscribed(driver) == ["fpEdge1/Conn/scout"]


async def test_a_failed_subscribe_lets_a_later_addr_try_again():
    driver = make_driver(scout_handler(nothing))
    driver.mqtt.fail_subscribe = True
    await driver.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})
    assert driver.scout_seen is False

    driver.mqtt.fail_subscribe = False
    await driver.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})
    assert scouts_subscribed(driver) == ["fpEdge1/Conn/scout"]


class Message:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = payload


async def test_scout_messages_are_routed_only_after_the_feature():
    driver = make_driver(scout_handler(nothing))
    driver._loop = asyncio.get_running_loop()
    hello = json.dumps({"op": "hello", "version": 1}).encode()

    driver.handle_message(None, None, Message("fpEdge1/Conn/scout", hello))
    await asyncio.sleep(0.05)
    assert driver.mqtt.published == []

    await driver.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})
    driver.handle_message(None, None, Message("fpEdge1/Conn/scout", hello))
    await asyncio.sleep(0.05)
    assert [m["type"] for m in found(driver, "hello")] == ["hello"]


# Hello

async def test_hello_comes_from_the_handler_class():
    yes = make_driver(scout_handler(nothing))
    # No conf yet, so no handler: the answer is still true.
    await yes.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})
    await yes.scouter.handle('{"op":"hello","version":1}')

    no = make_driver(scout_handler(nothing, scouts=False))
    await ready(no)
    await no.scouter.handle(b'{"op":"hello","version":1}')

    for driver, supported in ((yes, True), (no, False)):
        assert found(driver, "hello") == [{
            "seq": 0, "type": "hello", "versions": [1],
            "supported": supported, "reads": False, "library": LIBRARY_NAME,
        }]
    assert LIBRARY_NAME.startswith("py-edge-driver ")


async def test_the_default_handler_is_unsupported():
    class Plain(Handler):
        @classmethod
        def create(cls, driver, conf):
            return cls()

        def close(self, callback=None):
            if callback:
                callback()

        async def connect(self):
            return "UP"

    assert Plain.scouts is False
    driver = make_driver(Plain)
    await ready(driver)
    assert await scan(driver, "s1") == [{"seq": 0, "type": "end", "error": {
        "code": "UNSUPPORTED", "message": "This driver can't list its addresses"}}]

    # A class that sets scouts but keeps the default method.
    Plain.scouts = True
    driver = make_driver(Plain)
    await ready(driver)
    msgs = await scan(driver, "s2")
    assert msgs[-1]["error"]["code"] == "UNSUPPORTED"


# A scan

async def test_a_scan_sends_accept_batches_and_end():
    got = {}

    async def fn(request, out):
        got["request"] = request
        await out.add(tree(1200))
        return ScoutEnd(exhaustive=True, excluded=[
            {"id": "i=2253", "reason": "skipped", "prefixes": ["i="]}])

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "a1", options={"units": True})

    seqs_ok(msgs)
    assert [m["type"] for m in msgs] == ["accept", "items", "items", "items", "end"]
    assert [len(m["items"]) for m in msgs[1:4]] == [500, 500, 200]
    assert msgs[-1] == {"seq": 4, "type": "end", "exhaustive": True, "truncated": False,
                        "reason": None, "excluded": [
                            {"id": "i=2253", "reason": "skipped", "prefixes": ["i="]}]}
    assert got["request"].options == {"units": True}
    assert got["request"].limits == LIMITS
    assert driver.scouter.scan is None


async def test_small_adds_are_gathered():
    async def fn(request, out):
        for item in tree(30):
            await out.add(item)
        return None

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "g1")
    assert [m["type"] for m in msgs] == ["accept", "items", "end"]
    assert len(msgs[1]["items"]) == 30
    assert msgs[-1]["exhaustive"] is False


async def test_a_batch_stays_under_256_kib():
    detail = {"blob": "x" * 1900}

    async def fn(request, out):
        await out.add([{**i, "detail": detail} for i in tree(400)])

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "b1")
    batches = [p for t, p in driver.mqtt.published
               if t.endswith("/b1") and json.loads(p)["type"] == "items"]
    assert len(batches) > 2
    assert all(len(p.encode()) <= 256 * 1024 for p in batches)
    assert sum(len(m["items"]) for m in msgs if m["type"] == "items") == 400


async def test_bad_items_are_dropped():
    async def fn(request, out):
        await out.add([None, {"name": "no id"}, {"id": "", "parent": None},
                       {"id": "big", "parent": None, "name": "b", "kind": "folder",
                        "detail": {"x": "y" * 300000}},
                       {"id": "obj", "parent": None, "name": "o", "kind": "folder",
                        "detail": {"x": object()}},
                       {"id": "ok", "parent": None, "name": "ok", "kind": "folder"}])

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "d1")
    assert [i["id"] for i in msgs[1]["items"]] == ["ok"]


async def test_samples_only_when_asked():
    async def fn(request, out):
        await out.add({"id": "v", "parent": None, "name": "v", "kind": "value",
                       "address": "v", "sample": "21.5"})

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    assert "sample" not in (await scan(driver, "p1"))[1]["items"][0]
    msgs = await scan(driver, "p2", limits={**LIMITS, "samples": True})
    assert msgs[1]["items"][0]["sample"] == "21.5"


# Limits

def test_clamp_limits():
    assert clamp_limits(None) == {"items": 20000, "depth": 8, "seconds": 120,
                                  "pace_ms": 20, "samples": False}
    assert clamp_limits({"items": 10**6, "depth": 99, "seconds": 9999,
                         "pace_ms": 5, "samples": True}) == \
        {"items": 50000, "depth": 32, "seconds": 600, "pace_ms": 5, "samples": True}
    assert clamp_limits({"items": 0, "depth": -1, "seconds": 1.5, "pace_ms": True,
                         "samples": "yes"}) == \
        {"items": 20000, "depth": 8, "seconds": 120, "pace_ms": 20, "samples": False}


async def test_add_raises_at_the_item_cap():
    caught = []

    async def fn(request, out):
        for item in tree(25):
            try:
                await out.add(item)
            except ScoutStopped as e:
                caught.append(e)
                # The handler's own answer doesn't change the result.
                return {"exhaustive": True, "truncated": False}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "c1", limits={**LIMITS, "items": 10})

    seqs_ok(msgs)
    assert caught[0].reason == "items"
    assert sum(len(m["items"]) for m in msgs if m["type"] == "items") == 10
    assert msgs[-1] == {"seq": len(msgs) - 1, "type": "end", "exhaustive": True,
                        "truncated": True, "reason": "items", "excluded": []}


async def test_a_handler_that_lets_scout_stopped_escape_is_truncated():
    async def fn(request, out):
        await out.add(tree(5))

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "c2", limits={**LIMITS, "items": 3})
    assert msgs[-1]["truncated"] is True and msgs[-1]["reason"] == "items"
    assert len(msgs[1]["items"]) == 3


async def test_exactly_the_cap_is_not_truncated():
    async def fn(request, out):
        await out.add(tree(3))
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "c3", limits={**LIMITS, "items": 3})
    assert msgs[-1]["truncated"] is False


async def test_the_depth_cap():
    async def fn(request, out):
        await out.add([
            {"id": "a", "parent": None, "name": "a", "kind": "folder"},
            {"id": "a/b", "parent": "a", "name": "b", "kind": "folder"},
            {"id": "a/b/c", "parent": "a/b", "name": "c", "kind": "folder"},
            {"id": "a/b/c/d", "parent": "a/b/c", "name": "d", "kind": "value",
             "address": "d"},
        ])
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "e1", limits={**LIMITS, "depth": 2})
    assert [i["id"] for i in msgs[1]["items"]] == ["a", "a/b"]
    assert msgs[-1] == {"seq": 2, "type": "end", "exhaustive": True, "truncated": True,
                        "reason": "depth", "excluded": []}


async def test_a_branch_scan_folder_is_at_depth_0():
    async def fn(request, out):
        await out.add([
            {"id": request.folder_id, "parent": "up", "name": "f", "kind": "folder"},
            {"id": "f/a", "parent": request.folder_id, "name": "a", "kind": "folder"},
            {"id": "f/a/b", "parent": "f/a", "name": "b", "kind": "folder"},
        ])
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "e2", root="f", folder_id="f",
                      limits={**LIMITS, "depth": 2})
    assert [i["id"] for i in msgs[1]["items"]] == ["f", "f/a", "f/a/b"]
    assert msgs[-1]["truncated"] is False


async def test_the_watchdog_ends_a_hung_scan():
    cancelled = []

    async def fn(request, out):
        await out.add(tree(2))
        try:
            # Ignores the event and never returns.
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    t0 = time.monotonic()
    msgs = await scan(driver, "w1", limits={**LIMITS, "seconds": 1})
    took = time.monotonic() - t0

    assert 1.0 <= took < 2.0
    seqs_ok(msgs)
    assert len(msgs[1]["items"]) == 2
    assert msgs[-1] == {"seq": 2, "type": "end", "exhaustive": False, "truncated": True,
                        "reason": "seconds", "excluded": []}
    # The hung handler is cancelled after the grace period.
    assert cancelled == [True]
    assert driver.scouter.scan is None


async def test_progress_goes_out_on_a_timer():
    async def fn(request, out):
        await out.add(tree(3))
        out.progress(visited=40, note="ns=2;s=Line1")
        await asyncio.sleep(0.12)
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn), progress_s=0.04)
    await ready(driver)
    msgs = await scan(driver, "g2")
    seqs_ok(msgs)
    progress = [m for m in msgs if m["type"] == "progress"]
    assert progress
    assert progress[-1] == {"seq": progress[-1]["seq"], "type": "progress",
                            "visited": 40, "found": 3, "note": "ns=2;s=Line1"}


async def test_pace_waits_pace_ms():
    waited = []

    async def fn(request, out):
        t0 = time.monotonic()
        await out.pace()
        waited.append(time.monotonic() - t0)

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    await scan(driver, "q1", limits={**LIMITS, "pace_ms": 60})
    assert waited[0] >= 0.055


# Cancel

async def test_cancel_ends_the_scan_with_cancelled():
    late = []

    async def fn(request, out):
        await out.add(tree(2))
        await out.cancelled.wait()
        try:
            await out.add(tree(1, prefix="late"))
        except ScoutStopped as e:
            late.append(e.reason)
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    task = asyncio.ensure_future(scan(driver, "x1"))
    await asyncio.sleep(0.02)
    # A cancel for another scan is ignored.
    await driver.scouter.handle('{"op":"cancel","id":"other","version":1}')
    await driver.scouter.handle('{"op":"cancel","id":"x1","version":1}')
    msgs = await task

    assert late == ["cancel"]
    seqs_ok(msgs)
    assert msgs[-1] == {"seq": len(msgs) - 1, "type": "end", "error": {
        "code": "CANCELLED", "message": "Cancelled by the Edge Agent"}}
    assert not any(i["id"].startswith("late")
                   for m in msgs if m["type"] == "items" for i in m["items"])


async def test_a_hung_handler_is_still_cancelled():
    async def fn(request, out):
        await asyncio.Future()

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    task = asyncio.ensure_future(scan(driver, "x2"))
    await asyncio.sleep(0.01)
    driver.scouter.cancel_id("x2")
    msgs = await task
    assert msgs[-1]["error"]["code"] == "CANCELLED"


async def test_a_new_conf_cancels_the_running_scan():
    async def fn(request, out):
        await out.cancelled.wait()
        return {}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    task = asyncio.ensure_future(scan(driver, "x3"))
    await asyncio.sleep(0.01)
    await driver.conf_handler("{}")
    msgs = await task
    assert msgs[-1] == {"seq": 1, "type": "end", "error": {
        "code": "CANCELLED", "message": "A new driver configuration arrived"}}


async def test_a_second_start_gets_err_on_its_own_id():
    release = asyncio.Event()

    async def fn(request, out):
        await release.wait()
        await out.add(tree(1))
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    first = asyncio.ensure_future(scan(driver, "r1"))
    await asyncio.sleep(0.01)
    second = await scan(driver, "r2")
    release.set()
    msgs = await first

    assert second == [{"seq": 0, "type": "end", "error": {
        "code": "ERR", "message": "A scan is already running"}}]
    assert [m["type"] for m in msgs] == ["accept", "items", "end"]


async def test_a_reconnect_drops_the_scan_without_publishing():
    async def fn(request, out):
        await out.add(tree(1))
        await asyncio.Future()

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    task = asyncio.ensure_future(scan(driver, "z1"))
    await asyncio.sleep(0.03)
    before = len(found(driver, "z1"))

    driver.connected()
    await asyncio.sleep(0)
    assert driver.scouter.scan is None
    await task
    assert len(found(driver, "z1")) == before


# Errors

class Weird(Exception):
    pass


@pytest.mark.parametrize("raise_it,code,message", [
    (RuntimeError("boom"), "ERR", "boom"),
    (ScoutError("OPTIONS", "Root ns=2;s=Nope does not exist"), "OPTIONS",
     "Root ns=2;s=Nope does not exist"),
    (ScoutError("CONN", "Not connected"), "CONN", "Not connected"),
    (ScoutError("AUTH"), "AUTH", "AUTH"),
    (ScoutError("NOPE", "odd"), "ERR", "odd"),
    (ScoutError("CANCELLED", "fake"), "ERR", "fake"),
    (Weird(), "ERR", "Weird"),
])
async def test_a_raise_ends_the_scan(raise_it, code, message):
    async def fn(request, out):
        raise raise_it

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "t1")
    seqs_ok(msgs)
    assert msgs[-1]["error"] == {"code": code, "message": message}


async def test_a_sync_raise_and_bad_returns():
    def sync_raise(request, out):
        raise ValueError("sync")

    cases = [
        (sync_raise, "sync"),
        (lambda r, o: 42, "The handler's scout returned something that is not a ScoutEnd"),
        (lambda r, o: {"truncated": True, "reason": "bored"},
         'The handler returned a truncated scan with reason "bored"'),
    ]
    for i, (fn, message) in enumerate(cases):
        driver = make_driver(scout_handler(fn))
        await ready(driver)
        msgs = await scan(driver, f"u{i}")
        assert msgs[-1]["error"] == {"code": "ERR", "message": message}


async def test_excluded_is_kept_to_the_limits():
    excluded = [{"id": f"s{i}", "reason": "skipped",
                 "prefixes": ["a", "b", "c", "d", "e", ""]} for i in range(12)]

    async def fn(request, out):
        return ScoutEnd(exhaustive=True, truncated=True, reason="partial_access",
                        excluded=[{"reason": "no id"}, *excluded])

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    end = (await scan(driver, "h1"))[-1]
    assert end["reason"] == "partial_access"
    assert len(end["excluded"]) == 8
    assert end["excluded"][0] == {"id": "s0", "reason": "skipped",
                                  "prefixes": ["a", "b", "c", "d"]}


async def test_bad_start_requests():
    async def fn(request, out):
        raise AssertionError("must not run")

    driver = make_driver(scout_handler(fn))
    await ready(driver)

    async def code(scan_id, **extra):
        return (await scan(driver, scan_id, **extra))[-1]["error"]["code"]

    assert await code("o1", options=[]) == "OPTIONS"
    assert await code("o2", options=None) == "OPTIONS"
    assert await code("o3", folder_id="f") == "OPTIONS"
    assert await code("o4", root=5) == "OPTIONS"
    assert await code("o5", options={"x": "y" * 9000}) == "OPTIONS"
    assert await code("o6", version=2) == "ERR"

    # A start with a bad id has no topic to answer on.
    before = len(driver.mqtt.published)
    for scan_id in ["hello", "has-dash", "", 7, "x" * 65]:
        await scan(driver, scan_id)
    assert len(driver.mqtt.published) == before


async def test_no_working_configuration_answers_conn():
    Handler_ = scout_handler(nothing)
    Handler_.create = classmethod(lambda cls, driver, conf: None)
    driver = make_driver(Handler_)
    driver._loop = asyncio.get_running_loop()
    await driver.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})
    msgs = await scan(driver, "n1")
    assert msgs[-1]["error"] == {"code": "CONN",
                                 "message": "The driver has no working configuration"}


async def test_nothing_is_published_while_disconnected():
    async def fn(request, out):
        await out.add(tree(1))

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    driver.mqtt.connected = False
    await scan(driver, "m1")
    assert found(driver, "m1") == []


async def test_a_scan_gives_way_between_batches():
    ticks = 0
    counting = True

    def tick():
        nonlocal ticks
        ticks += 1
        if counting:
            asyncio.get_running_loop().call_soon(tick)

    during = []

    async def fn(request, out):
        t0 = ticks
        await out.add(tree(5000))
        during.append(ticks - t0)

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    asyncio.get_running_loop().call_soon(tick)
    await scan(driver, "y1")
    counting = False
    assert during[0] >= 5


async def test_works_on_a_polled_driver():
    async def fn(request, out):
        await out.add(tree(2))
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn), cls=PolledDriver)
    await ready(driver)
    msgs = await scan(driver, "k1")
    assert [m["type"] for m in msgs] == ["accept", "items", "end"]


# The Edge Agent's window

def items_msgs(driver, scan_id):
    return [m for m in found(driver, scan_id) if m["type"] == "items"]


async def test_a_scan_keeps_to_the_window_and_echoes_it():
    async def fn(request, out):
        for i in range(6):
            await out.add(tree(500, prefix=f"{i}/"))
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    # handle returns when the scan ends, which needs the acks.
    task = asyncio.ensure_future(driver.scouter.handle(json.dumps({
        "op": "start", "id": "w1", "version": 1, "root": None, "folder_id": None,
        "options": {}, "limits": LIMITS, "window": 2})))
    await asyncio.sleep(0.05)
    assert found(driver, "w1")[0] == {"seq": 0, "type": "accept", "window": 2}
    assert len(items_msgs(driver, "w1")) == 2

    # An ack covers every message up to its seq.
    await driver.scouter.handle(json.dumps({"op": "ack", "id": "w1", "seq": 1}))
    await asyncio.sleep(0.02)
    assert len(items_msgs(driver, "w1")) == 3
    await driver.scouter.handle(json.dumps({"op": "ack", "id": "other", "seq": 99}))
    await asyncio.sleep(0.02)
    assert len(items_msgs(driver, "w1")) == 3

    for seq in range(2, 7):
        await driver.scouter.handle(json.dumps({"op": "ack", "id": "w1", "seq": seq}))
    await asyncio.wait_for(task, 5)
    msgs = found(driver, "w1")
    seqs_ok(msgs)
    assert len(items_msgs(driver, "w1")) == 6
    assert msgs[-1]["type"] == "end"


@pytest.mark.parametrize("window", [None, 0, "4", True])
async def test_no_window_or_a_bad_one_sends_without_waiting(window):
    async def fn(request, out):
        await out.add(tree(1500))
        return {"exhaustive": True}

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    msgs = await scan(driver, "n1", window=window)
    assert msgs[0] == {"seq": 0, "type": "accept"}
    assert len(items_msgs(driver, "n1")) == 3


async def test_a_full_window_still_ends_at_the_time_cap():
    async def fn(request, out):
        i = 0
        while True:
            await out.add(tree(500, prefix=f"{i}/"))
            i += 1

    driver = make_driver(scout_handler(fn))
    await ready(driver)
    t0 = time.monotonic()
    msgs = await scan(driver, "t1", limits={**LIMITS, "seconds": 1}, window=1)
    seqs_ok(msgs)
    assert len(items_msgs(driver, "t1")) == 1
    assert msgs[-1] == {"seq": len(msgs) - 1, "type": "end", "exhaustive": False,
                        "truncated": True, "reason": "seconds", "excluded": []}
    assert time.monotonic() - t0 < 3


# The shared fixtures

async def test_every_valid_request_fixture_is_handled():
    requests = fixtures("valid", "request")
    assert len(requests) >= 3
    for name, fx in requests:
        async def fn(request, out):
            await out.add(tree(1))
            return {"exhaustive": True}

        driver = make_driver(scout_handler(fn))
        await ready(driver)
        data = fx["data"]
        await driver.scouter.handle(json.dumps(data))

        if data["op"] == "hello":
            assert [m["type"] for m in found(driver, "hello")] == ["hello"], name
        elif data["op"] == "start":
            assert [m["type"] for m in found(driver, data["id"])] == \
                ["accept", "items", "end"], name
        else:
            assert found(driver, data["id"]) == [], name


async def test_invalid_request_fixtures_never_crash_the_driver():
    for name, fx in fixtures("invalid", "request"):
        driver = make_driver(scout_handler(nothing))
        await ready(driver)
        await driver.scouter.handle(json.dumps(fx["data"]))
        for t, p in driver.mqtt.published:
            if "/found/" in t:
                VALIDATORS["found"].validate(json.loads(p))


# Reads of live values

def answer(driver, read_id):
    """The messages published for a read. An end is checked against
    the found schema. A values message is checked here, because the
    schema does not list it yet."""
    msgs = []
    for t, p in driver.mqtt.published:
        if t != f"fpEdge1/Conn/found/{read_id}":
            continue
        msg = json.loads(p)
        if msg["type"] == "values":
            assert msg["seq"] == 0
            assert set(msg) == {"seq", "type", "values"}
            for v in msg["values"]:
                assert set(v) == {"address", "value", "type", "ts", "error"}
                assert v["value"] is None or len(v["value"]) <= 1024
                assert v["error"] is None or len(v["error"]) <= 256
        else:
            VALIDATORS["found"].validate(msg)
        msgs.append(msg)
    return msgs


async def read(driver, read_id, addresses, **extra):
    msg = {"op": "read", "id": read_id, "version": 1, "addresses": addresses, **extra}
    await driver.scouter.handle(json.dumps(msg))
    return answer(driver, read_id)


def reader(fn=None, scouts=False):
    return scout_handler(nothing, scouts=scouts,
                         read_fn=fn or (lambda addresses: []))


async def test_hello_says_whether_the_handler_reads():
    driver = make_driver(reader())
    await driver.set_addrs({"version": 1, "addrs": {}, "features": FEATURES})
    await driver.scouter.handle('{"op":"hello","version":1}')
    assert found(driver, "hello")[0]["reads"] is True
    assert Handler.reads is False


async def test_a_read_answers_once_with_values():
    asked = []

    async def fn(addresses):
        asked.append(addresses)
        return [
            ReadValue("ns=2;s=Speed", 1450.5, "Double", 1795600000000),
            {"address": "plant/temp", "value": {"t": 21.4}, "type": "String",
             "ts": 1795599998000},
            ReadValue("ns=2;s=Gone", error="BadNodeIdUnknown"),
        ]

    driver = make_driver(reader(fn))
    await ready(driver)
    msgs = await read(driver, "v1", ["ns=2;s=Speed", "plant/temp", "ns=2;s=Gone"])

    assert asked == [["ns=2;s=Speed", "plant/temp", "ns=2;s=Gone"]]
    assert msgs == [{"seq": 0, "type": "values", "values": [
        {"address": "ns=2;s=Speed", "value": "1450.5", "type": "Double",
         "ts": 1795600000000, "error": None},
        {"address": "plant/temp", "value": '{"t":21.4}', "type": "String",
         "ts": 1795599998000, "error": None},
        {"address": "ns=2;s=Gone", "value": None, "type": None, "ts": None,
         "error": "BadNodeIdUnknown"},
    ]}]


async def test_one_entry_per_address_asked_for():
    def fn(addresses):
        # Sync is fine too. Extra, duplicate and addressless entries go,
        # and a missing address gets an error.
        return [{"address": "a", "value": 1}, {"address": "a", "value": 2},
                {"address": "zzz", "value": 3}, {"value": 4}, None]

    driver = make_driver(reader(fn))
    await ready(driver)
    msgs = await read(driver, "v2", ["a", "b", "a"])
    assert msgs[0]["values"] == [
        {"address": "a", "value": "1", "type": None, "ts": None, "error": None},
        {"address": "b", "value": None, "type": None, "ts": None,
         "error": "The driver returned no value"},
    ]


def test_values_as_text():
    assert value_text("plain text") == "plain text"
    assert value_text("") == ""
    assert value_text(None) is None
    assert value_text(True) == "true"
    assert value_text(False) == "false"
    assert value_text(42) == "42"
    assert value_text(-1.5) == "-1.5"
    assert value_text(1e21) == "1e+21"
    assert value_text([1, "a", None]) == '[1,"a",null]'
    assert value_text({"t": 21.4, "ok": True}) == '{"t":21.4,"ok":true}'
    assert value_text({"é": "ü"}) == '{"é":"ü"}'
    assert value_text(b"{\"t\":1}") == '{"t":1}'
    assert value_text({"at": object}) == '{"at":"<class \'object\'>"}'
    assert value_text("x" * 5000) == "x" * 1024
    assert value_text(list(range(1000))) == json.dumps(
        list(range(1000)), separators=(",", ":"))[:1024]


async def test_entries_are_cut_to_the_limits():
    from datetime import datetime, timezone

    def fn(addresses):
        return [
            {"address": "a", "value": "v" * 2000, "error": None,
             "ts": datetime(2026, 11, 25, tzinfo=timezone.utc)},
            {"address": "b", "error": "e" * 400, "ts": True, "type": 7},
            {"address": "c", "error": ValueError("bad"), "ts": 1.5e12, "type": ""},
        ]

    driver = make_driver(reader(fn))
    await ready(driver)
    a, b, c = (await read(driver, "v3", ["a", "b", "c"]))[0]["values"]
    assert a["value"] == "v" * 1024
    assert a["ts"] == 1795564800000
    assert b["error"] == "e" * 256
    assert b["ts"] is None and b["type"] is None
    assert c["error"] == "bad" and c["ts"] == 1500000000000 and c["type"] is None


async def test_a_handler_that_does_not_read_answers_unsupported():
    driver = make_driver(scout_handler(nothing))
    await ready(driver)
    assert await read(driver, "w1", ["a"]) == [{"seq": 0, "type": "end", "error": {
        "code": "UNSUPPORTED", "message": "This driver can't read values"}}]

    # A class that sets reads but keeps the default method.
    class Plain(Handler):
        reads = True

        @classmethod
        def create(cls, driver, conf):
            return cls()

        def close(self, callback=None):
            if callback:
                callback()

        async def connect(self):
            return "UP"

    driver = make_driver(Plain)
    await ready(driver)
    msgs = await read(driver, "w2", ["a"])
    assert msgs[0]["error"]["code"] == "UNSUPPORTED"


async def test_a_driver_that_is_not_connected_answers_conn():
    def fn(addresses):
        raise AssertionError("must not run")

    driver = make_driver(reader(fn))
    await ready(driver)
    driver.set_status("CONN")
    assert await read(driver, "c1", ["a"]) == [{"seq": 0, "type": "end", "error": {
        "code": "CONN", "message": "The driver is not connected to its device"}}]

    # No working configuration at all.
    Handler_ = reader(fn)
    Handler_.create = classmethod(lambda cls, driver, conf: None)
    driver = make_driver(Handler_)
    await ready(driver)
    assert (await read(driver, "c2", ["a"]))[0]["error"]["code"] == "CONN"


@pytest.mark.parametrize("raise_it,code,message", [
    (RuntimeError("boom"), "ERR", "boom"),
    (Weird(), "ERR", "Weird"),
    (ScoutError("CONN", "PLC unreachable"), "CONN", "PLC unreachable"),
    (ScoutError("OPTIONS", "odd"), "ERR", "odd"),
])
async def test_a_raise_answers_the_read_with_an_error(raise_it, code, message):
    async def fn(addresses):
        raise raise_it

    driver = make_driver(reader(fn))
    await ready(driver)
    assert await read(driver, "e1", ["a"]) == [{"seq": 0, "type": "end", "error": {
        "code": code, "message": message}}]


async def test_a_bad_return_answers_err():
    driver = make_driver(reader(lambda addresses: {"a": 1}))
    await ready(driver)
    assert (await read(driver, "e2", ["a"]))[0]["error"] == {
        "code": "ERR",
        "message": "The handler's read_values returned something that is not a list"}


async def test_a_hung_read_is_abandoned_after_4_s():
    assert READ_TIMEOUT_S == 4.0
    cancelled = asyncio.Event()

    async def fn(addresses):
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    driver = make_driver(reader(fn))
    driver.scouter.read_timeout_s = 0.05
    await ready(driver)
    start = time.monotonic()
    assert await read(driver, "h1", ["a"]) == []
    assert time.monotonic() - start < 1
    await asyncio.wait_for(cancelled.wait(), 1)

    # The driver still answers the next read.
    driver.HandlerClass.read_values = lambda self, addresses: [{"address": "a", "value": 1}]
    assert (await read(driver, "h2", ["a"]))[0]["type"] == "values"


async def test_a_read_runs_beside_a_running_scan():
    release = asyncio.Event()

    async def scout_fn(request, out):
        await out.add(tree(1))
        await release.wait()
        await out.add(tree(1, prefix="m"))
        return {"exhaustive": True}

    driver = make_driver(scout_handler(
        scout_fn, read_fn=lambda addresses: [{"address": "n0", "value": 7}]))
    await ready(driver)
    scanning = asyncio.ensure_future(scan(driver, "s1"))
    await asyncio.sleep(0.03)
    assert driver.scouter.scan is not None

    msgs = await read(driver, "r1", ["n0"])
    assert msgs[0]["values"][0]["value"] == "7"
    assert driver.scouter.scan is not None and not scanning.done()

    release.set()
    scan_msgs = await scanning
    seqs_ok(scan_msgs)
    assert [m["type"] for m in scan_msgs] == ["accept", "items", "items", "end"]
    assert scan_msgs[-1]["exhaustive"] is True


async def test_a_read_through_the_mqtt_callback_does_not_wait_for_a_scan():
    release = asyncio.Event()

    async def scout_fn(request, out):
        await release.wait()

    driver = make_driver(scout_handler(
        scout_fn, read_fn=lambda addresses: [{"address": "a", "value": "x"}]))
    await ready(driver)
    start = json.dumps({"op": "start", "id": "s2", "version": 1, "root": None,
                        "folder_id": None, "options": {}, "limits": LIMITS})
    driver.handle_message(None, None, Message("fpEdge1/Conn/scout", start.encode()))
    await asyncio.sleep(0.02)
    msg = json.dumps({"op": "read", "id": "r2", "version": 1, "addresses": ["a"]})
    driver.handle_message(None, None, Message("fpEdge1/Conn/scout", msg.encode()))
    await asyncio.sleep(0.05)
    assert answer(driver, "r2")[0]["values"][0]["value"] == "x"
    release.set()
    await asyncio.sleep(0.05)
    assert found(driver, "s2")[-1]["type"] == "end"


async def test_bad_read_requests():
    def fn(addresses):
        raise AssertionError("must not run")

    driver = make_driver(reader(fn))
    await ready(driver)

    async def error(read_id, addresses, **extra):
        return (await read(driver, read_id, addresses, **extra))[0]["error"]["code"]

    assert await error("b1", []) == "ERR"
    assert await error("b2", "a") == "ERR"
    assert await error("b3", ["a", 5]) == "ERR"
    assert await error("b4", [""]) == "ERR"
    assert await error("b5", ["x" * 1025]) == "ERR"
    assert await error("b6", ["a"], version=2) == "ERR"

    # A read with a bad id has no topic to answer on.
    before = len(driver.mqtt.published)
    for read_id in ["hello", "has-dash", "", 7, "x" * 65]:
        await read(driver, read_id, ["a"])
    assert len(driver.mqtt.published) == before


async def test_a_read_after_a_reconnect_is_not_published():
    gate = asyncio.Event()

    async def fn(addresses):
        await gate.wait()
        return [{"address": "a", "value": 1}]

    driver = make_driver(reader(fn))
    await ready(driver)
    task = asyncio.ensure_future(read(driver, "q1", ["a"]))
    await asyncio.sleep(0.01)
    # A new MQTT session: the answer belongs to the old one.
    driver.connected()
    await ready(driver)
    gate.set()
    assert await task == []
