# ACS Edge Agent driver library
# Edge Scout: list a device's addresses for the Edge Agent
# Copyright 2026 University of Sheffield
#
# The protocol is the "Scouting" section of acs-edge/docs/edge-split.md.
# The library does everything in it except produce items: the hello,
# seq, batching, the limits, pacing, the watchdog, cancel and errors.

from __future__ import annotations

import asyncio
import collections
import inspect
import json
import logging
import re
from dataclasses import dataclass, field
from importlib import metadata
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from .driver import Driver

# The versions of features.scout this library speaks.
SCOUT_VERSIONS = (1,)

# The limits the Edge Agent sends, with their defaults and ceilings.
# The agent always sends all five, already clamped, but the library
# clamps again so a faulty agent can't overload a device.
DEFAULT_LIMITS: Dict[str, Any] = {
    "items": 20000, "depth": 8, "seconds": 120, "pace_ms": 20, "samples": False,
}
LIMIT_CEILINGS: Dict[str, int] = {"items": 50000, "depth": 32, "seconds": 600}

# The most items, and the most bytes as JSON, in one items message,
# with room left for {"seq":N,"type":"items","items":[...]}.
BATCH_ITEMS = 500
BATCH_BYTES = 256 * 1024
BATCH_OVERHEAD = 64

# The largest window the library keeps to. A bigger one from the Edge
# Agent is cut to this.
MAX_WINDOW = 64

# The codes a driver may put in the error of an end message.
LIBRARY_CODES = {"UNSUPPORTED", "OPTIONS", "CONN", "AUTH", "CANCELLED", "ERR"}
TRUNCATION_REASONS = {"items", "depth", "seconds", "size", "partial_access"}

SCAN_ID = re.compile(r"^[A-Za-z0-9_]{1,64}$")
MAX_OPTIONS = 8 * 1024
MAX_MESSAGE = 512
MAX_NOTE = 256
MAX_EXCLUDED = 8
MAX_PREFIXES = 4
MAX_SCOPE_STRING = 256


class ScoutError(Exception):
    """A handler raises this from scout to end the scan with a library
    code: OPTIONS, CONN, AUTH or ERR. Any other code is sent as ERR."""

    def __init__(self, code: str, message: Optional[str] = None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


class ScoutStopped(Exception):
    """ScoutSink.add raises this once the scan has stopped, at the item
    cap, on cancel or at the time limit. `reason` says which. A handler
    may let it escape from scout: the library ends the scan correctly
    whatever the handler does after it."""

    def __init__(self, reason: str):
        super().__init__(f"The scan has stopped: {reason}")
        self.reason = reason


@dataclass
class ScoutRequest:
    """What the Edge Agent asked for. `limits` holds all five limits,
    clamped."""

    root: Optional[str]
    folder_id: Optional[str]
    options: Dict[str, Any]
    limits: Dict[str, Any]


@dataclass
class ScoutEnd:
    """What a handler's scout returns. A dict with the same keys, or
    None for a plain result, is accepted too."""

    exhaustive: bool = False
    truncated: bool = False
    reason: Optional[str] = None
    excluded: List[Dict[str, Any]] = field(default_factory=list)


def _library_name() -> str:
    for dist in ("amrc.factoryplus.edge_driver", "amrc-factoryplus-edge-driver"):
        try:
            return f"py-edge-driver {metadata.version(dist)}"
        except metadata.PackageNotFoundError:
            continue
    return "py-edge-driver"


LIBRARY_NAME = _library_name()


def _clip(value, length):
    if isinstance(value, str) and len(value) > length:
        return value[:length]
    return value


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def clamp_limits(limits: Any) -> Dict[str, Any]:
    """Fill in and clamp the limits of a start request."""
    given = limits if isinstance(limits, dict) else {}

    def number(key, low):
        value = given.get(key)
        n = value if _is_int(value) and value >= low else DEFAULT_LIMITS[key]
        return min(n, LIMIT_CEILINGS[key]) if key in LIMIT_CEILINGS else n

    return {
        "items": number("items", 1),
        "depth": number("depth", 1),
        "seconds": number("seconds", 1),
        "pace_ms": number("pace_ms", 0),
        "samples": given.get("samples") is True,
    }


def clamp_window(window: Any) -> Optional[int]:
    """The window of a start request, cut to MAX_WINDOW, or None for
    none."""
    if not _is_int(window) or window < 1:
        return None
    return min(window, MAX_WINDOW)


def _dumps(value) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _clean_excluded(excluded, log) -> List[Dict[str, Any]]:
    """Check the excluded list a handler returned, cutting it to the
    protocol's limits."""
    if excluded is None:
        return []
    if not isinstance(excluded, list):
        log.warning("Handler returned excluded that is not a list: %r", excluded)
        return []
    good = []
    for scope in excluded:
        if not isinstance(scope, dict):
            continue
        sid, reason = scope.get("id"), scope.get("reason")
        if not (isinstance(sid, str) and sid and isinstance(reason, str) and reason):
            continue
        clean = {"id": _clip(sid, MAX_SCOPE_STRING), "reason": _clip(reason, 32)}
        if isinstance(scope.get("prefixes"), list):
            clean["prefixes"] = [
                _clip(p, MAX_SCOPE_STRING)
                for p in scope["prefixes"] if isinstance(p, str) and p
            ][:MAX_PREFIXES]
        good.append(clean)
    if len(good) != len(excluded) or len(good) > MAX_EXCLUDED:
        log.warning("Handler's excluded list cut from %d to %d scopes",
                    len(excluded), min(len(good), MAX_EXCLUDED))
    return good[:MAX_EXCLUDED]


class ScoutSink:
    """What a handler's scout uses to report what it finds."""

    def __init__(self, scan: "_Scan"):
        self._scan = scan
        self.limits = scan.limits
        # Set when the scan stops: on cancel, at a cap or at the time
        # limit. A handler should stop when it is set.
        self.cancelled = scan.cancelled

    async def add(self, items) -> None:
        """Queue items for sending. Waits while batches go out, so the
        handler slows to the speed of the broker, and while the Edge
        Agent's window is full, so it slows to the agent's pace. Raises
        ScoutStopped once the scan has stopped, including at the item
        cap."""
        await self._scan.add(items)

    def progress(self, visited: Optional[int] = None, note: Optional[str] = None,
                 **_ignored) -> None:
        """Record how far the scan has got. The library sends progress
        on a timer, with `found` counted from the items added."""
        self._scan.set_progress(visited, note)

    async def pace(self) -> None:
        """Wait pace_ms, as the driver should between southbound
        requests. Wakes early when the scan stops."""
        delay = self.limits["pace_ms"] / 1000
        if delay <= 0 or self.cancelled.is_set():
            return
        try:
            await asyncio.wait_for(self.cancelled.wait(), delay)
        except asyncio.TimeoutError:
            pass


class _Scan:
    """One running scan."""

    def __init__(self, scouter: "Scouter", scan_id: str, session: int,
                 handler, request: ScoutRequest, window: Optional[int] = None):
        self.scouter = scouter
        self.log = scouter.log
        self.id = scan_id
        self.session = session
        self.handler = handler
        self.request = request
        self.limits = request.limits

        self.seq = 0
        # Why the library stopped the scan: items, seconds, cancel or
        # done. None while it runs.
        self.stopped: Optional[str] = None
        self.stop_note: Optional[str] = None
        self.cancelled = asyncio.Event()
        self.ended = False

        self.count = 0
        self.visited: Optional[int] = None
        self.note: Optional[str] = None
        self.depths: Dict[str, int] = {}
        self.depth_cut = False

        self.pending: List[str] = []
        self.pending_bytes = 0
        self.flush_handle: Optional[asyncio.TimerHandle] = None
        self.done: Optional[asyncio.Future] = None

        # The Edge Agent's window, and the seq of each items message it
        # has not acked yet. Batches go out one at a time, each waiting
        # for room.
        self.window = window
        self.unacked: collections.deque = collections.deque()
        self.acked_seq = -1
        self.acked = asyncio.Event()
        self.flushing = asyncio.Lock()

    def ack(self, seq: int) -> None:
        """The agent has handled every message up to seq."""
        self.acked_seq = max(self.acked_seq, seq)
        while self.unacked and self.unacked[0] <= seq:
            self.unacked.popleft()
        self.acked.set()

    async def room(self) -> bool:
        """Wait until another items message fits in the window. Once the
        scan has stopped it waits at most grace_s, and returns False if
        there is still no room."""
        loop = asyncio.get_running_loop()
        deadline = None
        while self.window is not None and len(self.unacked) >= self.window:
            if self.ended:
                return False
            self.acked.clear()
            if self.stopped:
                if deadline is None:
                    deadline = loop.time() + self.scouter.grace_s
                left = deadline - loop.time()
                if left <= 0:
                    return False
                try:
                    await asyncio.wait_for(self.acked.wait(), left)
                except asyncio.TimeoutError:
                    pass
                continue
            ack = asyncio.ensure_future(self.acked.wait())
            stop = asyncio.ensure_future(self.cancelled.wait())
            await asyncio.wait({ack, stop}, return_when=asyncio.FIRST_COMPLETED)
            ack.cancel()
            stop.cancel()
        return True

    def send(self, msg: Dict[str, Any]) -> None:
        body = _dumps({"seq": self.seq, **msg})
        self.seq += 1
        self.scouter.publish(self.id, body, self.session)

    def stop(self, why: str, note: Optional[str] = None) -> None:
        if self.stopped:
            return
        self.stopped = why
        self.stop_note = note
        self.cancelled.set()

    def set_progress(self, visited, note) -> None:
        if _is_int(visited) and visited >= 0:
            self.visited = visited
        if note is None or isinstance(note, str):
            self.note = _clip(note, MAX_NOTE)

    def send_progress(self) -> None:
        if self.stopped or self.ended:
            return
        self.send({
            "type": "progress",
            "visited": max(self.visited or 0, self.count),
            "found": self.count,
            "note": self.note,
        })

    def prepare(self, raw):
        """Prepare one item for sending, or return None to drop it."""
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) \
                or not raw["id"]:
            self.log.warning("Dropping an item with no id: %r", raw)
            return None

        item = dict(raw)
        if not self.limits["samples"]:
            item.pop("sample", None)

        # The depth cap, as a safety net under the handler's own. A
        # branch scan's first item is its folder, at depth 0. The depth
        # of a dropped item is kept too, so its children go with it.
        folder_id = self.request.folder_id
        if self.count == 0 and folder_id is not None and item["id"] == folder_id:
            depth = 0
        else:
            parent = 0 if item.get("parent") is None \
                else self.depths.get(item.get("parent"))
            depth = 1 if parent is None else parent + 1
        self.depths[item["id"]] = depth
        if depth > self.limits["depth"]:
            self.depth_cut = True
            return None

        try:
            text = _dumps(item)
        except (TypeError, ValueError) as e:
            self.log.warning("Dropping item %s: %s", item["id"], e)
            return None
        size = len(text.encode("utf-8"))
        if size > BATCH_BYTES - BATCH_OVERHEAD:
            self.log.warning("Dropping item %s: %d bytes is too big for a message",
                             item["id"], size)
            return None
        return text, size

    async def add(self, items) -> None:
        if self.stopped or self.ended:
            raise ScoutStopped(self.stopped or "ended")
        if not isinstance(items, (list, tuple)):
            items = [items]

        for raw in items:
            if self.count >= self.limits["items"]:
                self.stop("items")
                break
            prepared = self.prepare(raw)
            if prepared is None:
                continue
            text, size = prepared

            if len(self.pending) >= BATCH_ITEMS or \
                    self.pending_bytes + size + 1 + BATCH_OVERHEAD > BATCH_BYTES:
                await self.flush()
            if self.stopped:
                break

            self.pending.append(text)
            self.pending_bytes += size + 1
            self.count += 1

        if len(self.pending) >= BATCH_ITEMS:
            await self.flush()
        elif self.pending and self.flush_handle is None:
            loop = asyncio.get_running_loop()
            self.flush_handle = loop.call_later(
                self.scouter.flush_s, lambda: asyncio.ensure_future(self.flush()))

        if self.stopped:
            raise ScoutStopped(self.stopped)

    def flush_now(self) -> None:
        if self.flush_handle is not None:
            self.flush_handle.cancel()
            self.flush_handle = None
        # Nothing goes out after the end message.
        if self.ended:
            self.pending = []
        if not self.pending:
            return
        batch, self.pending, self.pending_bytes = self.pending, [], 0
        seq = self.seq
        self.seq += 1
        if self.window is not None and seq > self.acked_seq:
            self.unacked.append(seq)
        body = f'{{"seq":{seq},"type":"items","items":[{",".join(batch)}]}}'
        self.scouter.publish(self.id, body, self.session)

    async def flush(self) -> None:
        """Send the pending items once the window has room, then give
        the event loop a turn so data goes out between batches."""
        async with self.flushing:
            if self.flush_handle is not None:
                self.flush_handle.cancel()
                self.flush_handle = None
            if not self.pending:
                return
            if not await self.room():
                if not self.ended:
                    self.log.warning(
                        "Dropping %d items: the Edge Agent's window stayed full "
                        "after the scan stopped", len(self.pending))
                self.pending, self.pending_bytes = [], 0
                return
            self.flush_now()
        await asyncio.sleep(0)

    async def _call_handler(self):
        """Run the handler's scout, catching what it raises."""
        request = ScoutRequest(
            root=self.request.root, folder_id=self.request.folder_id,
            options=self.request.options, limits=dict(self.limits))
        try:
            result = self.handler.scout(request, ScoutSink(self))
            if inspect.isawaitable(result):
                result = await result
            return ("value", result)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - every failure becomes ERR
            return ("error", e)

    async def _tick(self) -> None:
        while not self.stopped:
            await asyncio.sleep(self.scouter.progress_s)
            self.send_progress()

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        if self.window is None:
            self.send({"type": "accept"})
        else:
            self.send({"type": "accept", "window": self.window})

        watchdog = loop.call_later(self.limits["seconds"], self.stop, "seconds")
        ticker = asyncio.ensure_future(self._tick())
        work = asyncio.ensure_future(self._call_handler())
        stop_wait = asyncio.ensure_future(self.cancelled.wait())

        await asyncio.wait({work, stop_wait}, return_when=asyncio.FIRST_COMPLETED)
        if not work.done():
            # The library stopped the scan. Give the handler a moment to
            # return, then cancel it, so a scan never overlaps the next.
            await asyncio.wait({work}, timeout=self.scouter.grace_s)
        if work.done():
            result = work.result()
        else:
            work.cancel()
            result = ("hung", None)

        watchdog.cancel()
        ticker.cancel()
        stop_wait.cancel()

        # Once stopped, add refuses more items.
        if not self.stopped:
            self.stop("done")

        end = self.end_message(result)
        if end.get("error", {}).get("code") != "CANCELLED":
            await self.flush()
        if self.flush_handle is not None:
            self.flush_handle.cancel()
        self.ended = True
        self.log.info("Scan %s ended: %s", self.id, end)
        self.send(end)

    def end_message(self, result) -> Dict[str, Any]:
        kind, value = result

        def error(code, message):
            return {"type": "end",
                    "error": {"code": code, "message": _clip(message or code, MAX_MESSAGE)}}

        if self.stopped == "cancel":
            return error("CANCELLED", self.stop_note)

        if isinstance(value, ScoutEnd):
            value = {"exhaustive": value.exhaustive, "truncated": value.truncated,
                     "reason": value.reason, "excluded": value.excluded}

        def result_keys(truncated, reason):
            given = value if isinstance(value, dict) else {}
            return {
                "type": "end",
                "exhaustive": given.get("exhaustive") is True,
                "truncated": truncated,
                "reason": reason if truncated else None,
                "excluded": _clean_excluded(given.get("excluded"), self.log),
            }

        # A cap the library enforced decides the result, whatever the
        # handler did after it.
        if self.stopped in ("items", "seconds"):
            return result_keys(True, self.stopped)

        if kind == "error":
            e = value
            if isinstance(e, ScoutError):
                code = e.code if e.code in LIBRARY_CODES and e.code != "CANCELLED" \
                    else "ERR"
                return error(code, e.message)
            self.log.error("Scan handler failed: %r", e)
            return error("ERR", str(e) or type(e).__name__)

        if value is not None and not isinstance(value, dict):
            return error("ERR", "The handler's scout returned something that is not a ScoutEnd")

        given = value or {}
        truncated = given.get("truncated") is True
        if truncated and given.get("reason") not in TRUNCATION_REASONS:
            return error("ERR", "The handler returned a truncated scan with reason "
                         + json.dumps(given.get("reason")))
        if not truncated and self.depth_cut:
            return result_keys(True, "depth")
        return result_keys(truncated, given.get("reason"))


class Scouter:
    """Handles the scout topic for a Driver. The Driver subscribes to it
    and routes its messages here. Everything runs on the driver's event
    loop."""

    def __init__(self, driver: "Driver"):
        self.driver = driver
        self.log = logging.getLogger("scout")
        self.scan: Optional[_Scan] = None

        # Timings in seconds, which tests shorten. Progress goes out at
        # least every 5 s, a stopped handler gets grace_s to return, and
        # a part-filled batch waits flush_s for more items.
        self.progress_s = 4.0
        self.grace_s = 2.0
        self.flush_s = 0.1

    @property
    def supported(self) -> bool:
        """The hello comes from the handler class, not a live handler,
        so a driver whose configuration failed still answers
        correctly."""
        return getattr(self.driver.HandlerClass, "scouts", False) is True

    def publish(self, scan_id: str, body: str, session: Optional[int] = None) -> bool:
        """Publish on found/<id>. Nothing goes out unless the driver has
        subscribed to scout on the current MQTT session."""
        driver = self.driver
        if not driver.scout_seen or not driver.mqtt.is_connected():
            return False
        if session is not None and session != driver.scout_session:
            return False
        try:
            info = driver.mqtt.publish(driver.topic("found", scan_id), body)
            if getattr(info, "rc", 0) != 0:
                self.log.warning("Can't publish on found/%s: %s", scan_id, info.rc)
                return False
            return True
        except Exception as e:  # noqa: BLE001
            self.log.warning("Can't publish on found/%s: %s", scan_id, e)
            return False

    async def handle(self, payload) -> None:
        try:
            msg = json.loads(payload if isinstance(payload, str) else bytes(payload))
        except (TypeError, ValueError) as e:
            self.log.warning("Bad scout message: %s", e)
            return
        op = msg.get("op") if isinstance(msg, dict) else None

        if op == "hello":
            self.hello()
        elif op == "start":
            await self.start(msg)
        elif op == "cancel":
            self.cancel_id(msg.get("id"))
        elif op == "ack":
            self.ack(msg.get("id"), msg.get("seq"))
        else:
            self.log.warning("Unknown scout message: %r", msg)

    def hello(self) -> None:
        self.publish("hello", _dumps({
            "seq": 0,
            "type": "hello",
            "versions": list(SCOUT_VERSIONS),
            "supported": self.supported,
            "library": LIBRARY_NAME,
        }))

    def refuse(self, scan_id: str, code: str, message: str) -> None:
        """End a scan straight away, without accept."""
        self.log.info("Refusing scan %s: %s %s", scan_id, code, message)
        self.publish(scan_id, _dumps({
            "seq": 0, "type": "end",
            "error": {"code": code, "message": _clip(message, MAX_MESSAGE)},
        }))

    async def start(self, msg: Dict[str, Any]) -> None:
        scan_id = msg.get("id")
        if not isinstance(scan_id, str) or not SCAN_ID.match(scan_id) \
                or scan_id == "hello":
            self.log.warning("Ignoring a scan start with a bad id: %r", scan_id)
            return

        if self.scan is not None:
            return self.refuse(scan_id, "ERR", "A scan is already running")
        version = msg.get("version")
        if version != 1 or not _is_int(version):
            return self.refuse(scan_id, "ERR", f"Unknown scan request version {version}")
        if not self.supported:
            return self.refuse(scan_id, "UNSUPPORTED", "This driver can't list its addresses")

        root = msg.get("root")
        folder_id = msg.get("folder_id")
        options = msg.get("options", {})
        if root is not None and not isinstance(root, str):
            return self.refuse(scan_id, "OPTIONS", "root must be a string or null")
        if folder_id is not None and (not isinstance(folder_id, str) or not folder_id):
            return self.refuse(scan_id, "OPTIONS", "folder_id must be a string or null")
        if folder_id is not None and root is None:
            return self.refuse(scan_id, "OPTIONS", "folder_id needs a root")
        if not isinstance(options, dict):
            return self.refuse(scan_id, "OPTIONS", "options must be an object")
        if len(_dumps(options).encode("utf-8")) > MAX_OPTIONS:
            return self.refuse(scan_id, "OPTIONS", "options is over 8 KiB")

        handler = self.driver.handler
        if handler is None:
            return self.refuse(scan_id, "CONN", "The driver has no working configuration")
        if not callable(getattr(handler, "scout", None)):
            return self.refuse(scan_id, "ERR", "The handler sets scouts but has no scout method")

        request = ScoutRequest(root=root, folder_id=folder_id, options=options,
                               limits=clamp_limits(msg.get("limits")))
        scan = _Scan(self, scan_id, self.driver.scout_session, handler, request,
                     window=clamp_window(msg.get("window")))
        self.scan = scan
        self.log.info("Starting scan %s: %s", scan_id, request)

        scan.done = asyncio.ensure_future(self._run(scan))
        await scan.done

    async def _run(self, scan: _Scan) -> None:
        try:
            await scan.run()
        except Exception as e:  # noqa: BLE001
            self.log.error("Scan %s failed in the library: %r", scan.id, e)
        finally:
            if self.scan is scan:
                self.scan = None

    def ack(self, scan_id, seq) -> None:
        if self.scan is None or self.scan.id != scan_id or not _is_int(seq) or seq < 0:
            return
        self.scan.ack(seq)

    def cancel_id(self, scan_id) -> None:
        if self.scan is None or self.scan.id != scan_id:
            self.log.info("Ignoring cancel for scan %s, which isn't running", scan_id)
            return
        self.scan.stop("cancel", "Cancelled by the Edge Agent")

    def cancel(self, note: str) -> None:
        """Cancel the running scan, if any. A new driver configuration
        does this."""
        if self.scan is not None:
            self.scan.stop("cancel", note)

    def reset(self) -> None:
        """The driver has connected to the broker again. A running scan
        belongs to the old session, so stop it without a word: its
        publishes are dropped, and the agent has already seen the
        disconnect. The scan is forgotten at once, so the agent can
        start a new one on the new session."""
        if self.scan is not None:
            self.scan.stop("cancel", "The driver reconnected")
        self.scan = None
