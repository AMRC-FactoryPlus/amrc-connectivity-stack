/*
 * ACS Edge Agent driver library
 * Edge Scout tests, against a fake MQTT client.
 * Copyright 2026 University of Sheffield
 *
 * Run with `npm test`. Every message the library publishes is checked
 * against the schemas in lib/edge-scout-schemas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import Ajv2020 from "ajv/dist/2020.js";
import add_formats from "ajv-formats";

import { add_schemas, load_fixtures }
    from "../../edge-scout-schemas/lib/index.js";

import { Driver } from "../lib/driver.js";
import { PolledDriver } from "../lib/polled.js";
import {
    ScoutError, ScoutStopped, LIBRARY_NAME, clamp_limits, value_text,
} from "../lib/scout.js";

const ajv = new Ajv2020({ strictTypes: true, strictTuples: true });
add_formats(ajv);
const validator = add_schemas(ajv);
const check_found = validator("found");
const check_item = validator("item");

const ENV = {
    EDGE_USERNAME:  "Conn",
    EDGE_MQTT:      "mqtt://localhost:1",
    EDGE_PASSWORD:  "x",
};
const FEATURES = { scout: 1 };
const LIMITS = { items: 20000, depth: 8, seconds: 120, pace_ms: 0, samples: false };

/* A stand-in for the mqtt.js client that records what the driver
 * does. The driver is created with manualConnect, so swapping the
 * client never touches the network. */
function fake_mqtt () {
    const mqtt = {
        connected:  true,
        published:  [],
        subscribed: [],
        publish (topic, payload) {
            mqtt.published.push([topic, payload.toString()]);
        },
        async publishAsync (topic, payload) {
            mqtt.publish(topic, payload);
        },
        async subscribeAsync (topics) {
            topics = Array.isArray(topics) ? topics : [topics];
            mqtt.subscribed.push(...topics);
            return topics.map(topic => ({ topic, qos: 0 }));
        },
    };
    return mqtt;
}

function make_driver (Handler, opts) {
    const driver = new (opts?.cls ?? Driver)({ handler: Handler, env: ENV });
    driver.mqtt = fake_mqtt();
    driver.scouter.progress_ms = opts?.progress_ms ?? 60000;
    driver.scouter.grace_ms = opts?.grace_ms ?? 50;
    driver.scouter.flush_ms = 5;
    return driver;
}

/* Every found message published so far for one id, parsed and checked
 * against the schema. */
function found (driver, id) {
    const topic = `fpEdge1/Conn/found/${id}`;
    return driver.mqtt.published
        .filter(([t]) => t == topic)
        .map(([, p]) => {
            const msg = JSON.parse(p);
            assert.ok(check_found(msg),
                `found message fails the schema: ${p.slice(0, 200)} ${JSON.stringify(check_found.errors)}`);
            if (msg.type == "items")
                for (const item of msg.items)
                    assert.ok(check_item(item),
                        `item fails the schema: ${JSON.stringify(item)} ${JSON.stringify(check_item.errors)}`);
            return msg;
        });
}

function seqs_ok (msgs) {
    assert.deepEqual(msgs.map(m => m.seq), msgs.map((m, i) => i));
}

async function send (driver, msg, obj) {
    return driver.handleMessage(`fpEdge1/Conn/${msg}`,
        Buffer.from(JSON.stringify(obj)));
}

/* Configure the driver and advertise the feature, as the agent does on
 * READY. */
async function ready (driver, conf = {}) {
    await driver.messageHandlers.get("conf")(Buffer.from(JSON.stringify(conf)));
    await driver.setAddrs({ version: 1, addrs: {}, groups: {}, features: FEATURES });
}

/* Send a start and wait for the scan to end. */
async function scan (driver, id, extra) {
    await driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "start", id, version: 1, root: null, folder_id: null,
        options: {}, limits: LIMITS, ...extra,
    })));
    return found(driver, id);
}

function scout_handler (scout, statics) {
    return class Handler {
        static scouts = true;
        static create () { return new Handler(); }
        static validAddrs = statics?.validAddrs;
        connect () { return "UP"; }
        scout (req, out) { return scout(req, out, this); }
    };
}

function tree (n, parent = null, prefix = "n") {
    return Array.from({ length: n }, (_, i) => ({
        id: `${prefix}${i}`, parent, name: `Item ${i}`,
        kind: "value", address: `${prefix}${i}`,
    }));
}

/* The gate */

test("features is read before the handler check", async () => {
    const driver = make_driver(scout_handler(() => ({})));
    assert.equal(driver.handler, undefined);

    const ok = await driver.setAddrs({ version: 1, addrs: {}, features: FEATURES });

    assert.equal(ok, false);
    assert.deepEqual(driver.mqtt.subscribed, ["fpEdge1/Conn/scout"]);
});

test("features is read before the version check", async () => {
    const driver = make_driver(scout_handler(() => ({})));
    driver.setupHandler({});

    const ok = await driver.setAddrs({ version: 9, addrs: {}, features: FEATURES });

    assert.equal(ok, false);
    assert.deepEqual(driver.mqtt.subscribed, ["fpEdge1/Conn/scout"]);
});

test("a bad address map still subscribes to scout", async () => {
    const Handler = scout_handler(() => ({}), { validAddrs: new Set(["good"]) });
    const driver = make_driver(Handler);
    driver.setupHandler({});

    await send(driver, "addr", { version: 1, addrs: { 1: "bad" }, groups: {}, features: FEATURES });

    assert.equal(driver.status, "ADDR");
    assert.deepEqual(driver.mqtt.subscribed, ["fpEdge1/Conn/scout"]);
});

test("no features, an unknown version, or a bad features key: no subscription", async () => {
    const driver = make_driver(scout_handler(() => ({})));
    driver.setupHandler({});

    for (const features of [undefined, null, {}, { scout: 2 }, { scout: "1" },
        { scout: 0 }, "scout", [1], { other: 1 }])
        await driver.setAddrs({ version: 1, addrs: {}, groups: {}, features });
    await send(driver, "addr", "not an object");

    assert.deepEqual(driver.mqtt.subscribed, []);
});

test("scout is subscribed once per session, and never on connect", async () => {
    const driver = make_driver(scout_handler(() => ({})));
    assert.ok(!driver.messageHandlers.has("scout"));

    await driver.connected();
    const on_connect = [...driver.mqtt.subscribed];
    assert.ok(!on_connect.some(t => t.includes("scout")));
    assert.deepEqual(on_connect,
        [...driver.messageHandlers.keys()].map(t => `fpEdge1/Conn/${t}`));

    await ready(driver);
    await ready(driver);
    const scouts = () => driver.mqtt.subscribed.filter(t => t.endsWith("/scout"));
    assert.deepEqual(scouts(), ["fpEdge1/Conn/scout"]);

    /* A new session forgets the feature. An older agent sends no
     * features key, so the driver never asks again. */
    driver.mqtt.subscribed.length = 0;
    await driver.connected();
    await driver.messageHandlers.get("addr")(
        Buffer.from(JSON.stringify({ version: 1, addrs: {}, groups: {} })));
    assert.deepEqual(scouts(), []);
    assert.equal(driver.scout_seen, false);

    /* A newer agent again: subscribe again. */
    await ready(driver);
    assert.deepEqual(scouts(), ["fpEdge1/Conn/scout"]);
});

test("a failed subscribe lets a later addr try again", async () => {
    const driver = make_driver(scout_handler(() => ({})));
    let fail = true;
    driver.mqtt.subscribeAsync = async topic => {
        if (fail) throw new Error("connection closed");
        driver.mqtt.subscribed.push(topic);
        return [{ topic, qos: 0 }];
    };
    await driver.setAddrs({ version: 1, addrs: {}, features: FEATURES });
    await new Promise(r => setImmediate(r));
    assert.equal(driver.scout_seen, false);

    fail = false;
    await driver.setAddrs({ version: 1, addrs: {}, features: FEATURES });
    assert.deepEqual(driver.mqtt.subscribed, ["fpEdge1/Conn/scout"]);
});

test("scout messages before the feature are ignored", async () => {
    const driver = make_driver(scout_handler(() => ({})));
    await send(driver, "scout", { op: "hello", version: 1 });
    assert.deepEqual(driver.mqtt.published, []);
});

/* Hello */

test("hello comes from the handler class", async () => {
    const yes = make_driver(scout_handler(() => ({})));
    /* No conf yet, so no handler: the answer is still true. */
    await yes.setAddrs({ version: 1, addrs: {}, features: FEATURES });
    await send(yes, "scout", { op: "hello", version: 1 });

    class Plain {
        static create () { return new Plain(); }
        connect () { return "UP"; }
    }
    const no = make_driver(Plain);
    await ready(no);
    await send(no, "scout", { op: "hello", version: 1 });

    for (const [driver, supported] of [[yes, true], [no, false]]) {
        const [hello, ...rest] = found(driver, "hello");
        assert.deepEqual(rest, []);
        assert.deepEqual(hello, {
            seq: 0, type: "hello", versions: [1], supported, reads: false,
            library: LIBRARY_NAME,
        });
    }
    assert.match(LIBRARY_NAME, /^js-edge-driver \d+\.\d+\.\d+/);
});

test("a handler class without scouts answers UNSUPPORTED", async () => {
    class Plain {
        static create () { return new Plain(); }
        connect () { return "UP"; }
        /* A scout method alone is not enough. */
        scout () { throw new Error("must not be called"); }
    }
    const driver = make_driver(Plain);
    await ready(driver);

    const msgs = await scan(driver, "s1");
    assert.deepEqual(msgs, [{ seq: 0, type: "end",
        error: { code: "UNSUPPORTED", message: "This driver can't list its addresses" } }]);
});

/* A scan */

test("a scan sends accept, items in batches of 500, and end", async () => {
    let got;
    const driver = make_driver(scout_handler(async (req, out) => {
        got = req;
        await out.add(tree(1200));
        return { exhaustive: true, truncated: false, reason: null,
            excluded: [{ id: "i=2253", reason: "skipped", prefixes: ["i="] }] };
    }));
    await ready(driver);

    const msgs = await scan(driver, "a1", { options: { units: true } });
    seqs_ok(msgs);
    assert.deepEqual(msgs.map(m => m.type), ["accept", "items", "items", "items", "end"]);
    assert.deepEqual(msgs.slice(1, 4).map(m => m.items.length), [500, 500, 200]);
    assert.deepEqual(msgs.at(-1), { seq: 4, type: "end", exhaustive: true,
        truncated: false, reason: null,
        excluded: [{ id: "i=2253", reason: "skipped", prefixes: ["i="] }] });
    assert.deepEqual(got, { root: null, folder_id: null, options: { units: true }, limits: LIMITS });
    assert.equal(driver.scouter.scan, null);
});

test("small adds are gathered into one batch", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        for (const item of tree(30)) await out.add(item);
        return { exhaustive: false };
    }));
    await ready(driver);

    const msgs = await scan(driver, "g1");
    assert.deepEqual(msgs.map(m => m.type), ["accept", "items", "end"]);
    assert.equal(msgs[1].items.length, 30);
});

test("a batch stays under 256 KiB", async () => {
    const detail = { blob: "x".repeat(1900) };
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(400).map(i => ({ ...i, detail })));
        return {};
    }));
    await ready(driver);

    await scan(driver, "b1");
    const batches = driver.mqtt.published
        .filter(([t, p]) => t.endsWith("/b1") && JSON.parse(p).type == "items");
    assert.ok(batches.length > 2);
    for (const [, p] of batches)
        assert.ok(Buffer.byteLength(p) <= 256 * 1024, `${Buffer.byteLength(p)} bytes`);
    const items = batches.flatMap(([, p]) => JSON.parse(p).items);
    assert.equal(items.length, 400);
});

test("items with no id, or too big for a message, are dropped", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add([null, { name: "no id" }, { id: "", parent: null },
            { id: "big", parent: null, name: "b", kind: "folder", detail: { x: "y".repeat(300000) } },
            { id: "ok", parent: null, name: "ok", kind: "folder" }]);
        return {};
    }));
    await ready(driver);

    const msgs = await scan(driver, "d1");
    assert.deepEqual(msgs[1].items.map(i => i.id), ["ok"]);
});

test("samples are removed unless the limits ask for them", async () => {
    const handler = async (req, out) => {
        await out.add([{ id: "v", parent: null, name: "v", kind: "value",
            address: "v", sample: "21.5" }]);
        return {};
    };
    const driver = make_driver(scout_handler(handler));
    await ready(driver);

    assert.equal((await scan(driver, "p1"))[1].items[0].sample, undefined);
    const msgs = await scan(driver, "p2", { limits: { ...LIMITS, samples: true } });
    assert.equal(msgs[1].items[0].sample, "21.5");
});

/* Limits */

test("clamp_limits fills defaults and keeps to the ceilings", () => {
    assert.deepEqual(clamp_limits(undefined),
        { items: 20000, depth: 8, seconds: 120, pace_ms: 20, samples: false });
    assert.deepEqual(
        clamp_limits({ items: 1e6, depth: 99, seconds: 9999, pace_ms: 5, samples: true }),
        { items: 50000, depth: 32, seconds: 600, pace_ms: 5, samples: true });
    assert.deepEqual(
        clamp_limits({ items: 0, depth: -1, seconds: 1.5, pace_ms: -3, samples: "yes" }),
        { items: 20000, depth: 8, seconds: 120, pace_ms: 20, samples: false });
});

test("out.add rejects at the item cap, and the scan is truncated", async () => {
    let caught;
    const driver = make_driver(scout_handler(async (req, out) => {
        for (const item of tree(25)) {
            try {
                await out.add(item);
            }
            catch (e) {
                caught = e;
                /* The handler's own answer doesn't change the result. */
                return { exhaustive: true, truncated: false };
            }
        }
    }));
    await ready(driver);

    const msgs = await scan(driver, "c1", { limits: { ...LIMITS, items: 10 } });
    seqs_ok(msgs);
    assert.ok(caught instanceof ScoutStopped);
    assert.equal(caught.reason, "items");
    assert.equal(msgs.filter(m => m.type == "items").flatMap(m => m.items).length, 10);
    assert.deepEqual(msgs.at(-1), { seq: msgs.length - 1, type: "end",
        exhaustive: true, truncated: true, reason: "items", excluded: [] });
});

test("a handler that lets ScoutStopped escape is still truncated, not ERR", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(5));
    }));
    await ready(driver);

    const msgs = await scan(driver, "c2", { limits: { ...LIMITS, items: 3 } });
    assert.equal(msgs.at(-1).truncated, true);
    assert.equal(msgs.at(-1).reason, "items");
    assert.equal(msgs[1].items.length, 3);
});

test("exactly the item cap is not a truncation", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(3));
        return { exhaustive: true };
    }));
    await ready(driver);

    const msgs = await scan(driver, "c3", { limits: { ...LIMITS, items: 3 } });
    assert.deepEqual(msgs.at(-1).truncated, false);
});

test("items below the depth cap are dropped and the scan is truncated", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add([
            { id: "a", parent: null, name: "a", kind: "folder" },
            { id: "a/b", parent: "a", name: "b", kind: "folder" },
            { id: "a/b/c", parent: "a/b", name: "c", kind: "folder" },
            { id: "a/b/c/d", parent: "a/b/c", name: "d", kind: "value", address: "d" },
        ]);
        return { exhaustive: true };
    }));
    await ready(driver);

    const msgs = await scan(driver, "e1", { limits: { ...LIMITS, depth: 2 } });
    assert.deepEqual(msgs[1].items.map(i => i.id), ["a", "a/b"]);
    assert.deepEqual(msgs.at(-1), { seq: 2, type: "end", exhaustive: true,
        truncated: true, reason: "depth", excluded: [] });
});

test("a branch scan's folder is at depth 0", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add([
            { id: req.folder_id, parent: "up", name: "f", kind: "folder" },
            { id: "f/a", parent: req.folder_id, name: "a", kind: "folder" },
            { id: "f/a/b", parent: "f/a", name: "b", kind: "folder" },
        ]);
        return { exhaustive: true };
    }));
    await ready(driver);

    const msgs = await scan(driver, "e2",
        { root: "f", folder_id: "f", limits: { ...LIMITS, depth: 2 } });
    assert.deepEqual(msgs[1].items.map(i => i.id), ["f", "f/a", "f/a/b"]);
    assert.equal(msgs.at(-1).truncated, false);
});

test("the watchdog ends a hung scan at the time limit", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(2));
        /* Ignores the signal and never returns. */
        await new Promise(() => {});
    }));
    await ready(driver);

    const t0 = Date.now();
    const msgs = await scan(driver, "w1", { limits: { ...LIMITS, seconds: 1 } });
    const took = Date.now() - t0;
    assert.ok(took >= 1000 && took < 2000, `${took} ms`);
    seqs_ok(msgs);
    assert.equal(msgs[1].items.length, 2);
    assert.deepEqual(msgs.at(-1), { seq: 2, type: "end", exhaustive: false,
        truncated: true, reason: "seconds", excluded: [] });
    assert.equal(driver.scouter.scan, null);
});

test("progress goes out on a timer with the handler's counts", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(3));
        out.progress({ visited: 40, note: "ns=2;s=Line1" });
        await new Promise(r => setTimeout(r, 120));
        return { exhaustive: true };
    }), { progress_ms: 40 });
    await ready(driver);

    const msgs = await scan(driver, "g2");
    seqs_ok(msgs);
    const progress = msgs.filter(m => m.type == "progress");
    assert.ok(progress.length >= 1);
    assert.deepEqual(progress.at(-1), { seq: progress.at(-1).seq, type: "progress",
        visited: 40, found: 3, note: "ns=2;s=Line1" });
});

test("out.pace waits pace_ms and wakes on cancel", async () => {
    let waited;
    const driver = make_driver(scout_handler(async (req, out) => {
        const t0 = Date.now();
        await out.pace();
        waited = Date.now() - t0;
        return {};
    }));
    await ready(driver);
    await scan(driver, "q1", { limits: { ...LIMITS, pace_ms: 60 } });
    assert.ok(waited >= 55, `${waited} ms`);
});

/* Cancel */

test("cancel ends the scan with CANCELLED", async () => {
    let signalled = false;
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(2));
        await new Promise(r => out.signal.addEventListener("abort", r));
        signalled = true;
        await out.add(tree(1, null, "late")).catch(e => assert.ok(e instanceof ScoutStopped));
        return { exhaustive: true };
    }));
    await ready(driver);

    const done = scan(driver, "x1");
    await new Promise(r => setTimeout(r, 20));
    /* A cancel for another scan is ignored. */
    await send(driver, "scout", { op: "cancel", id: "other" });
    await send(driver, "scout", { op: "cancel", id: "x1" });
    const msgs = await done;

    assert.ok(signalled);
    seqs_ok(msgs);
    assert.deepEqual(msgs.at(-1), { seq: msgs.length - 1, type: "end",
        error: { code: "CANCELLED", message: "Cancelled by the Edge Agent" } });
    assert.ok(!msgs.some(m => m.items?.some(i => i.id.startsWith("late"))));
});

test("a hung handler is still cancelled", async () => {
    const driver = make_driver(scout_handler(() => new Promise(() => {})));
    await ready(driver);

    const done = scan(driver, "x2");
    await new Promise(r => setTimeout(r, 10));
    await send(driver, "scout", { op: "cancel", id: "x2" });
    const msgs = await done;
    assert.equal(msgs.at(-1).error.code, "CANCELLED");
});

test("a new conf cancels the running scan", async () => {
    const driver = make_driver(scout_handler(
        (req, out) => new Promise(r => out.signal.addEventListener("abort", () => r({})))));
    await ready(driver);

    driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "start", id: "x3", version: 1, root: null, folder_id: null,
        options: {}, limits: LIMITS })));
    const running = driver.scouter.scan.done;
    await send(driver, "conf", {});
    await running;

    const msgs = found(driver, "x3");
    assert.deepEqual(msgs.at(-1), { seq: 1, type: "end",
        error: { code: "CANCELLED", message: "A new driver configuration arrived" } });
});

test("a second start while one runs gets ERR on its own id", async () => {
    let release;
    const driver = make_driver(scout_handler(async (req, out) => {
        await new Promise(r => release = r);
        await out.add(tree(1));
        return { exhaustive: true };
    }));
    await ready(driver);

    const first = scan(driver, "r1");
    await new Promise(r => setTimeout(r, 10));
    const second = await scan(driver, "r2");
    release();
    const msgs = await first;

    assert.deepEqual(second, [{ seq: 0, type: "end",
        error: { code: "ERR", message: "A scan is already running" } }]);
    assert.deepEqual(msgs.map(m => m.type), ["accept", "items", "end"]);
    assert.equal(msgs.at(-1).truncated, false);
});

test("a reconnect drops the running scan without publishing", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(1));
        await new Promise(() => {});
    }));
    await ready(driver);

    driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "start", id: "z1", version: 1, root: null, folder_id: null,
        options: {}, limits: LIMITS })));
    const running = driver.scouter.scan.done;
    await new Promise(r => setTimeout(r, 20));
    const before = found(driver, "z1").length;

    await driver.connected();
    assert.equal(driver.scouter.scan, null);
    await running;
    assert.equal(found(driver, "z1").length, before);
});

/* Errors */

test("a throw ends the scan with ERR, and ScoutError with its code", async () => {
    const cases = [
        [() => { throw new Error("boom"); }, "ERR", "boom"],
        [async () => { throw new Error("later"); }, "ERR", "later"],
        [() => { throw new ScoutError("OPTIONS", "Root ns=2;s=Nope does not exist"); },
            "OPTIONS", "Root ns=2;s=Nope does not exist"],
        [async () => { throw new ScoutError("CONN", "Not connected"); }, "CONN", "Not connected"],
        [async () => { throw new ScoutError("AUTH"); }, "AUTH", "AUTH"],
        [async () => { throw new ScoutError("NOPE", "odd"); }, "ERR", "odd"],
        [async () => { throw new ScoutError("CANCELLED", "fake"); }, "ERR", "fake"],
        [async () => { throw "a string"; }, "ERR", "a string"],
        [async () => 42, "ERR", "The handler's scout returned something that is not an object"],
        [async () => ({ truncated: true, reason: "bored" }), "ERR",
            'The handler returned a truncated scan with reason "bored"'],
    ];
    let i = 0;
    for (const [fn, code, message] of cases) {
        const driver = make_driver(scout_handler(fn));
        await ready(driver);
        const msgs = await scan(driver, `t${i++}`);
        assert.deepEqual(msgs.at(-1).error, { code, message }, message);
        seqs_ok(msgs);
    }
});

test("a handler's own truncation and excluded list are kept to the limits", async () => {
    const excluded = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`, reason: "skipped", prefixes: ["a", "b", "c", "d", "e", ""],
    }));
    const driver = make_driver(scout_handler(async () => ({
        exhaustive: true, truncated: true, reason: "partial_access",
        excluded: [{ reason: "no id" }, ...excluded],
    })));
    await ready(driver);

    const end = (await scan(driver, "h1")).at(-1);
    assert.equal(end.reason, "partial_access");
    assert.equal(end.excluded.length, 8);
    assert.deepEqual(end.excluded[0], { id: "s0", reason: "skipped", prefixes: ["a", "b", "c", "d"] });
});

test("a handler that returns nothing gives a plain result", async () => {
    const driver = make_driver(scout_handler(async () => undefined));
    await ready(driver);
    assert.deepEqual((await scan(driver, "h2")).at(-1),
        { seq: 1, type: "end", exhaustive: false, truncated: false, reason: null, excluded: [] });
});

test("bad start requests", async () => {
    const driver = make_driver(scout_handler(() => { throw new Error("must not run"); }));
    await ready(driver);

    const end = async (id, extra) => (await scan(driver, id, extra)).at(-1).error;
    assert.equal((await end("o1", { options: [] })).code, "OPTIONS");
    assert.equal((await end("o2", { options: null })).code, "OPTIONS");
    assert.equal((await end("o3", { folder_id: "f" })).code, "OPTIONS");
    assert.equal((await end("o4", { root: 5 })).code, "OPTIONS");
    assert.equal((await end("o5", { options: { x: "y".repeat(9000) } })).code, "OPTIONS");
    assert.equal((await end("o6", { version: 2 })).code, "ERR");

    /* A start with a bad id has no topic to answer on. */
    const before = driver.mqtt.published.length;
    for (const id of ["hello", "has-dash", "", 7, "x".repeat(65)])
        await scan(driver, id);
    assert.equal(driver.mqtt.published.length, before);
});

test("a driver with no working configuration answers CONN", async () => {
    const Handler = scout_handler(() => ({}));
    Handler.create = () => undefined;
    const driver = make_driver(Handler);
    await ready(driver);
    assert.equal(driver.status, "CONF");

    assert.deepEqual((await scan(driver, "n1")).at(-1).error,
        { code: "CONN", message: "The driver has no working configuration" });
});

test("nothing is published while the broker is disconnected", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(1));
        return {};
    }));
    await ready(driver);
    driver.mqtt.connected = false;
    await scan(driver, "m1");
    assert.deepEqual(found(driver, "m1"), []);
});

test("a scan gives way to other work between batches", async () => {
    /* Counts turns of the event loop while the scan runs. */
    let ticks = 0, counting = true;
    const tick = () => { ticks++; if (counting) setImmediate(tick); };
    setImmediate(tick);
    let ticks_during;
    const driver = make_driver(scout_handler(async (req, out) => {
        const t0 = ticks;
        await out.add(tree(5000));
        ticks_during = ticks - t0;
        return {};
    }));
    await ready(driver);
    await scan(driver, "y1");
    counting = false;
    /* Ten batches, each followed by a turn of the event loop. */
    assert.ok(ticks_during >= 5, `${ticks_during} timer ticks`);
});

test("works on a PolledDriver too", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        await out.add(tree(2));
        return { exhaustive: true };
    }), { cls: PolledDriver });
    await ready(driver);
    const msgs = await scan(driver, "k1");
    assert.deepEqual(msgs.map(m => m.type), ["accept", "items", "end"]);
});

test("a scan keeps to the Edge Agent's window, and echoes it in accept", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        for (let i = 0; i < 6; i++)
            await out.add(tree(500).map(it => ({ ...it, id: `${i}/${it.id}` })));
        return { exhaustive: true };
    }));
    await ready(driver);
    /* handle resolves when the scan ends, which needs the acks. */
    driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "start", id: "w1", version: 1, root: null, folder_id: null,
        options: {}, limits: LIMITS, window: 2,
    })));
    const items = () => found(driver, "w1").filter(m => m.type == "items");
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(found(driver, "w1")[0], { seq: 0, type: "accept", window: 2 });
    assert.equal(items().length, 2, "two messages ahead of the acks");

    /* An ack covers every message up to its seq. */
    await send(driver, "scout", { op: "ack", id: "w1", seq: 1 });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(items().length, 3);
    await send(driver, "scout", { op: "ack", id: "other", seq: 99 });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(items().length, 3, "an ack for another scan changes nothing");

    for (let seq = 2; seq <= 6; seq++)
        await send(driver, "scout", { op: "ack", id: "w1", seq });
    await driver.scouter.scan?.done;
    const msgs = found(driver, "w1");
    seqs_ok(msgs);
    assert.equal(msgs.filter(m => m.type == "items").length, 6);
    assert.equal(msgs.at(-1).type, "end");
});

test("a start with no window sends without waiting, and a bad window is none", async () => {
    for (const window of [undefined, 0, "4"]) {
        const driver = make_driver(scout_handler(async (req, out) => {
            await out.add(tree(1500));
            return { exhaustive: true };
        }));
        await ready(driver);
        const msgs = await scan(driver, "n1", { window });
        assert.deepEqual(msgs[0], { seq: 0, type: "accept" });
        assert.equal(msgs.filter(m => m.type == "items").length, 3);
    }
});

test("a full window doesn't stop the time cap", async () => {
    const driver = make_driver(scout_handler(async (req, out) => {
        for (let i = 0; ; i++)
            await out.add(tree(500).map(it => ({ ...it, id: `${i}/${it.id}` })));
    }));
    await ready(driver);
    const t0 = Date.now();
    const msgs = await scan(driver, "t1", { limits: { ...LIMITS, seconds: 1 }, window: 1 });
    await driver.scouter.scan?.done;
    const all = found(driver, "t1");
    seqs_ok(all);
    assert.equal(all.filter(m => m.type == "items").length, 1);
    assert.deepEqual(all.at(-1), { seq: all.length - 1, type: "end", exhaustive: false,
        truncated: true, reason: "seconds", excluded: [] });
    assert.ok(Date.now() - t0 < 3000);
    assert.ok(msgs);
});

/* The shared fixtures: every valid request is handled, and the hello,
 * start and cancel shapes give the right answers. */
test("every valid request fixture is handled", async () => {
    const requests = load_fixtures("valid").filter(f => f.schema == "request");
    assert.ok(requests.length >= 3);
    for (const fx of requests) {
        let release;
        const driver = make_driver(scout_handler(async (req, out) => {
            await new Promise(r => release = r);
            await out.add(tree(1));
            return { exhaustive: true };
        }));
        await ready(driver);
        await send(driver, "scout", fx.data);
        const id = fx.data.op == "hello" ? "hello" : fx.data.id;

        if (fx.data.op == "hello")
            assert.equal(found(driver, id)[0].type, "hello", fx.file);
        if (fx.data.op == "start") {
            await new Promise(r => setTimeout(r, 5));
            release();
            await driver.scouter.scan?.done;
            assert.deepEqual(found(driver, id).map(m => m.type),
                ["accept", "items", "end"], fx.file);
        }
        if (fx.data.op == "cancel")
            assert.deepEqual(found(driver, id), [], fx.file);
        if (fx.data.op == "read") {
            await new Promise(r => setTimeout(r, 5));
            assert.equal(found(driver, id)[0].error.code, "UNSUPPORTED", fx.file);
        }
    }
});

test("invalid request fixtures never crash the driver", async () => {
    const requests = load_fixtures("invalid").filter(f => f.schema == "request");
    for (const fx of requests) {
        const driver = make_driver(scout_handler(async () => ({ exhaustive: true })));
        await ready(driver);
        await send(driver, "scout", fx.data);
        await driver.scouter.scan?.done;
        for (const [t, p] of driver.mqtt.published.filter(([t]) => t.includes("/found/")))
            assert.ok(check_found(JSON.parse(p)), `${fx.file}: ${t} ${p}`);
    }
});

/* Live values */

const check_value = (() => {
    const a = new Ajv2020({ strictTypes: true, strictTuples: true });
    add_formats(a);
    add_schemas(a);
    return a.getSchema("urn:edge-scout:common#/$defs/read_value");
})();

function read_handler (read_values, statics) {
    return class Handler {
        static scouts = statics?.scouts ?? false;
        static reads = statics?.reads ?? true;
        static create () { return new Handler(); }
        connect () { return "UP"; }
        scout (req, out) { return statics?.scout?.(req, out); }
        read_values (addresses, signal) { return read_values(addresses, signal, this); }
    };
}

/* Send a read and wait for its answer, checked against the schemas. */
async function read (driver, id, addresses, extra) {
    await driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "read", id, version: 1, addresses, ...extra,
    })));
    const msgs = found(driver, id);
    for (const m of msgs.filter(m => m.type == "values"))
        for (const v of m.values)
            assert.ok(check_value(v), `${JSON.stringify(v)} ${JSON.stringify(check_value.errors)}`);
    return msgs;
}

test("hello says reads from the handler class", async () => {
    const driver = make_driver(read_handler(() => []));
    await driver.setAddrs({ version: 1, addrs: {}, features: FEATURES });
    await send(driver, "scout", { op: "hello", version: 1 });
    assert.deepEqual(found(driver, "hello"), [{
        seq: 0, type: "hello", versions: [1], supported: false, reads: true,
        library: LIBRARY_NAME,
    }]);
});

test("value_text turns values into text as the protocol says", () => {
    assert.equal(value_text("plain"), "plain");
    assert.equal(value_text(""), "");
    assert.equal(value_text(1450.5), "1450.5");
    assert.equal(value_text(true), "true");
    assert.equal(value_text(NaN), "NaN");
    assert.equal(value_text(Infinity), "Infinity");
    assert.equal(value_text(-Infinity), "-Infinity");
    assert.equal(value_text(null), null);
    assert.equal(value_text(undefined), null);
    assert.equal(value_text(12n), "12");
    assert.equal(value_text({ t: 21.4 }), "{\"t\":21.4}");
    assert.equal(value_text([1, 2n]), "[1,\"2\"]");
    assert.equal(value_text(new Date(0)), "\"1970-01-01T00:00:00.000Z\"");
});

test("a read answers one entry per address, as text", async () => {
    let asked;
    const driver = make_driver(read_handler(addresses => {
        asked = addresses;
        return [
            { address: "a", value: 1450.5, type: "Double", ts: 1795600000000 },
            { address: "b", value: { t: 21.4 }, type: "String", ts: new Date(1795599998000) },
            { address: "c", value: null, type: null, ts: null, error: "BadNodeIdUnknown" },
            { address: "d", value: "x".repeat(2000), type: "Int16BE", ts: 1.5,
                error: new Error("y".repeat(300)) },
            { address: "not asked", value: 1 },
            { address: "a", value: "a second answer is ignored" },
        ];
    }));
    await ready(driver);
    assert.equal(driver.status, "UP");

    const msgs = await read(driver, "r1", ["a", "b", "c", "d", "e", "a"].slice(0, 5));
    assert.deepEqual(asked, ["a", "b", "c", "d", "e"]);
    assert.equal(msgs.length, 1);
    const [msg] = msgs;
    assert.equal(msg.seq, 0);
    assert.equal(msg.type, "values");
    assert.deepEqual(msg.values.slice(0, 3), [
        { address: "a", value: "1450.5", type: "Double", ts: 1795600000000, error: null },
        { address: "b", value: "{\"t\":21.4}", type: "String", ts: 1795599998000, error: null },
        { address: "c", value: null, type: null, ts: null, error: "BadNodeIdUnknown" },
    ]);
    const d = msg.values[3];
    assert.equal(d.value.length, 1024);
    assert.equal(d.type, null);
    assert.equal(d.ts, null);
    assert.equal(d.error.length, 256);
    assert.deepEqual(msg.values[4],
        { address: "e", value: null, type: null, ts: null, error: "The driver gave no value" });
});

test("a handler class without reads answers UNSUPPORTED", async () => {
    let called = false;
    const driver = make_driver(read_handler(() => { called = true; return []; }, { reads: false }));
    await ready(driver);
    const msgs = await read(driver, "r1", ["a"]);
    assert.deepEqual(msgs, [{ seq: 0, type: "end",
        error: { code: "UNSUPPORTED", message: "This driver can't read values" } }]);
    assert.equal(called, false);
});

test("a read while the driver isn't UP answers CONN", async () => {
    const driver = make_driver(read_handler(() => []));
    await driver.setAddrs({ version: 1, addrs: {}, features: FEATURES });
    const msgs = await read(driver, "r1", ["a"]);
    assert.equal(msgs[0].error.code, "CONN");
});

test("a throw answers ERR, and ScoutError CONN answers CONN", async () => {
    let fail;
    const driver = make_driver(read_handler(() => { throw fail; }));
    await ready(driver);

    fail = new Error("boom");
    assert.deepEqual((await read(driver, "r1", ["a"]))[0].error, { code: "ERR", message: "boom" });
    fail = new ScoutError("CONN", "The PLC went away");
    assert.deepEqual((await read(driver, "r2", ["a"]))[0].error,
        { code: "CONN", message: "The PLC went away" });
    fail = new ScoutError("OPTIONS", "not a read code");
    assert.equal((await read(driver, "r3", ["a"]))[0].error.code, "ERR");

    const bad = make_driver(read_handler(() => "not a list"));
    await ready(bad);
    assert.equal((await read(bad, "r4", ["a"]))[0].error.code, "ERR");
});

test("a handler that doesn't answer in time is abandoned without an answer", async () => {
    let signal;
    const driver = make_driver(read_handler((a, s) => {
        signal = s;
        return new Promise(() => {});
    }));
    driver.scouter.read_ms = 50;
    await ready(driver);
    const t0 = Date.now();
    const msgs = await read(driver, "r1", ["a"]);
    assert.ok(Date.now() - t0 >= 45);
    assert.deepEqual(msgs, []);
    assert.equal(signal.aborted, true);
});

test("bad reads are ignored or answered ERR", async () => {
    const driver = make_driver(read_handler(() => []));
    await ready(driver);

    await read(driver, "hello", ["a"]);
    await read(driver, "bad-id", ["a"]);
    assert.deepEqual(driver.mqtt.published.filter(([t]) => t.includes("/found/")), []);

    for (const [id, extra] of [["r1", { version: 2 }], ["r2", { addresses: [] }],
        ["r3", { addresses: Array.from({ length: 41 }, (_, i) => `a${i}`) }],
        ["r4", { addresses: [1] }], ["r5", { addresses: "a" }]])
    {
        const msgs = await read(driver, id, ["a"], extra);
        assert.equal(msgs[0].error.code, "ERR", id);
    }
});

test("a read runs beside a running scan", async () => {
    let release;
    const driver = make_driver(read_handler(
        () => [{ address: "a", value: 7, type: "Int32", ts: null }],
        { scouts: true, scout: async (req, out) => {
            await out.add(tree(1));
            await new Promise(r => release = r);
            return { exhaustive: true };
        } }));
    await ready(driver);

    /* handle resolves when the scan ends, so don't wait for it. */
    driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "start", id: "s1", version: 1, root: null, folder_id: null,
        options: {}, limits: LIMITS,
    })));
    await new Promise(r => setTimeout(r, 20));
    assert.ok(driver.scouter.scan);

    const msgs = await read(driver, "r1", ["a"]);
    assert.deepEqual(msgs[0].values, [{ address: "a", value: "7", type: "Int32", ts: null, error: null }]);
    assert.equal(driver.scouter.scan.id, "s1");

    release();
    await driver.scouter.scan?.done;
    assert.deepEqual(found(driver, "s1").map(m => m.type), ["accept", "items", "end"]);
});

test("a read's answer is dropped after a reconnect", async () => {
    let release;
    const driver = make_driver(read_handler(() => new Promise(r => release = r)));
    await ready(driver);
    const p = driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "read", id: "r1", version: 1, addresses: ["a"],
    })));
    await new Promise(r => setTimeout(r, 5));
    driver.scout_session++;
    release([{ address: "a", value: 1 }]);
    await p;
    assert.deepEqual(found(driver, "r1"), []);
});
