/*
 * ACS Edge Agent driver library
 * Driver tests.
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Run with `node --test test/`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Driver } from "../lib/driver.js";

const SECRET = "not-a-real-password";

/* The MQTT client is created with manualConnect, so as long as we
 * never call run() this makes no network connection. */
function make_driver (seen) {
    class Handler {
        static create (driver, conf) {
            seen.push(conf);
            return new Handler();
        }
        connect () { return "UP"; }
    }
    return new Driver({
        handler: Handler,
        env: {
            VERBOSE:        "ALL",
            EDGE_USERNAME:  "test",
            EDGE_MQTT:      "mqtt://localhost:1",
            EDGE_PASSWORD:  "x",
        },
    });
}

test("conf is logged without secrets, handler gets them", async t => {
    const lines = [];
    t.mock.method(console, "log", (...a) => lines.push(a.join(" ")));

    const seen = [];
    const driver = make_driver(seen);
    const conf = { host: "plc", password: SECRET };

    await driver.messageHandlers.get("conf")(
        Buffer.from(JSON.stringify(conf)));

    const logged = lines.join("\n");
    assert.match(logged, /CONF:/);
    assert.match(logged, /password/);
    assert.doesNotMatch(logged, new RegExp(SECRET));

    assert.deepEqual(seen, [conf]);
});

/* The agent sends a write to cmd/<address>, and an address may contain
 * "/". The handler must get the whole address, not its first segment. */
test("cmd passes the whole address to the handler", () => {
    const driver = make_driver([]);
    const cmds = [];
    driver.handler = { cmd: (name, data) => cmds.push([name, data.toString()]) };

    driver.handleMessage("fpEdge1/test/cmd/40001", Buffer.from("a"));
    driver.handleMessage("fpEdge1/test/cmd/plant/line1/speed", Buffer.from("b"));
    driver.handleMessage("fpEdge1/test/cmd//leading/slash", Buffer.from("c"));

    assert.deepEqual(cmds, [
        ["40001", "a"],
        ["plant/line1/speed", "b"],
        ["/leading/slash", "c"],
    ]);
});

test("other messages still get one data segment", () => {
    const driver = make_driver([]);
    const got = [];
    driver.message("rsp", (p, data) => got.push(data));
    driver.message("poll", (p, data) => got.push(data));

    driver.handleMessage("fpEdge1/test/rsp/file", Buffer.from("{}"));
    driver.handleMessage("fpEdge1/test/poll", Buffer.from("1\n2"));

    assert.deepEqual(got, ["file", undefined]);
});

/* Typed writes. These payloads are exactly what the Edge Agent sends on
 * write/<address> (acs-edge writeValToJSON), one per scalar Sparkplug
 * type, with the JS value the handler should get. */
const TYPED = [
    ['{"type":"Boolean","value":true}',          "Boolean",  true],
    ['{"type":"Boolean","value":false}',         "Boolean",  false],
    ['{"type":"Int8","value":-128}',             "Int8",     -128],
    ['{"type":"Int16","value":-2}',              "Int16",    -2],
    ['{"type":"Int32","value":-2147483648}',     "Int32",    -2147483648],
    ['{"type":"Int64","value":"-9223372036854775808"}', "Int64", -9223372036854775808n],
    ['{"type":"UInt8","value":255}',             "UInt8",    255],
    ['{"type":"UInt16","value":65535}',          "UInt16",   65535],
    ['{"type":"UInt32","value":4294967295}',     "UInt32",   4294967295],
    ['{"type":"UInt64","value":"18446744073709551615"}', "UInt64", 18446744073709551615n],
    ['{"type":"Float","value":1.5}',             "Float",    1.5],
    ['{"type":"Double","value":-0.1}',           "Double",   -0.1],
    ['{"type":"Double","value":"NaN"}',          "Double",   NaN],
    ['{"type":"Float","value":"-Infinity"}',     "Float",    -Infinity],
    ['{"type":"String","value":"héllo \\"q\\"/1"}', "String", 'héllo "q"/1'],
    ['{"type":"Text","value":"a\\nb"}',          "Text",     "a\nb"],
    ['{"type":"UUID","value":"2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c"}', "UUID",
        "2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c"],
    ['{"type":"DateTime","value":1763380800123}', "DateTime", 1763380800123],
];

function typed_driver (handler) {
    class Handler {
        static typedWrites = true;
        static create () { return handler; }
        connect () { return "UP"; }
    }
    const driver = new Driver({
        handler: Handler,
        env: {
            EDGE_USERNAME:  "test",
            EDGE_MQTT:      "mqtt://localhost:1",
            EDGE_PASSWORD:  "x",
        },
    });
    assert.equal(driver.setupHandler({}), true);
    const published = [];
    driver.mqtt = { connected: true, publish: (t, p) => published.push([t, p]) };
    return { driver, published };
}

async function set_addrs (driver, addrs) {
    assert.equal(await driver.setAddrs({ version: 1, addrs, groups: {} }), true);
}

test("a handler without write subscribes to cmd, not write", () => {
    const driver = make_driver([]);
    assert.equal(driver.typedWrites, false);
    assert.ok(driver.messageHandlers.has("cmd/#"));
    assert.ok(!driver.messageHandlers.has("write/#"));
});

/* edge-ftp's handler has a write method of its own, so having one must
 * not switch a driver to typed writes. */
test("a handler with its own write method still gets cmd", () => {
    const cmds = [];
    class Handler {
        static create () { return new Handler(); }
        connect () { return "UP"; }
        async write (args, result) { throw new Error("not a typed write"); }
        cmd (name, data) { cmds.push([name, data.toString()]); }
    }
    const driver = new Driver({
        handler: Handler,
        env: { EDGE_USERNAME: "test", EDGE_MQTT: "mqtt://localhost:1", EDGE_PASSWORD: "x" },
    });
    driver.setupHandler({});

    assert.equal(driver.typedWrites, false);
    assert.ok(driver.messageHandlers.has("cmd/#"));
    assert.ok(!driver.messageHandlers.has("write/#"));
    driver.handleMessage("fpEdge1/test/cmd/a/b", Buffer.from("x"));
    assert.deepEqual(cmds, [["a/b", "x"]]);
});

test("a handler class with typedWrites subscribes to write, not cmd", () => {
    const { driver } = typed_driver({ write () {} });
    assert.equal(driver.typedWrites, true);
    assert.ok(driver.messageHandlers.has("write/#"));
    assert.ok(!driver.messageHandlers.has("cmd/#"));
});

test("every scalar type reaches write as a JS value", async () => {
    const got = [];
    const { driver, published } = typed_driver({
        parseAddr: a => ({ node: a }),
        write: (spec, type, value) => got.push([spec, type, value]),
    });
    await set_addrs(driver, { 17: "ns=2;s=Motor/Speed" });

    for (const [payload] of TYPED)
        await driver.handleMessage("fpEdge1/test/write/ns=2;s=Motor/Speed",
            Buffer.from(payload));

    assert.deepEqual(got, TYPED.map(([, type, value]) =>
        [{ node: "ns=2;s=Motor/Speed" }, type, value]));
    assert.deepEqual(published, []);
});

test("a failed write is reported on err for its data topic", async () => {
    const { driver, published } = typed_driver({
        write (spec, type, value) {
            if (spec == "ro")
                throw Object.assign(new Error("BadNotWritable"), { code: "RO" });
            throw new Error("device said no");
        },
    });
    await set_addrs(driver, { 1: "ro", 2: "plant/x" });

    const w = '{"type":"Int16","value":1}';
    await driver.handleWrite("ro", Buffer.from(w));
    await driver.handleWrite("plant/x", Buffer.from(w));

    assert.deepEqual(published.map(([t, p]) => [t, p.toString()]), [
        ["fpEdge1/test/err/1", "RO\nBadNotWritable"],
        ["fpEdge1/test/err/2", "ERR\ndevice said no"],
    ]);
});

test("a bad typed write is refused as CMD without calling write", async () => {
    const calls = [];
    const { driver, published } = typed_driver({ write: (...a) => calls.push(a) });
    await set_addrs(driver, { 5: "a" });

    for (const p of [
        "not json",
        '{"value":1}',
        '{"type":"Int16","value":1.5}',
        '{"type":"Int64","value":"12x"}',
        '{"type":"Boolean","value":"true"}',
        '{"type":"Bytes","value":"AA=="}',
    ])
        await driver.handleWrite("a", Buffer.from(p));
    /* Not in the address map, so there is no data topic for err. */
    await driver.handleWrite("b", Buffer.from('{"type":"Int16","value":1}'));

    assert.deepEqual(calls, []);
    assert.equal(published.length, 6);
    for (const [t, p] of published) {
        assert.equal(t, "fpEdge1/test/err/5");
        assert.match(p.toString(), /^CMD\n/);
    }
});

/* A write with an id is one the Edge Agent is waiting for, so it gets
 * an answer on result/<id> whether it worked or not, and no err. */
test("a write with an id is answered on result", async () => {
    let busy = false;
    const { driver, published } = typed_driver({
        async write (spec, type, value) {
            if (spec == "ro")
                throw Object.assign(new Error("BadNotWritable"), { code: "RO" });
            if (busy) throw new Error("device busy");
        },
    });
    await set_addrs(driver, { 1: "ro", 2: "plant/x" });

    const w = id => Buffer.from(`{"type":"Int16","value":1,"id":"${id}"}`);
    await driver.handleWrite("plant/x", w("ab12_1"));
    await driver.handleWrite("ro", w("ab12_2"));
    busy = true;
    await driver.handleWrite("plant/x", w("ab12_3"));
    await driver.handleWrite("nowhere", w("ab12_4"));
    await driver.handleWrite("plant/x",
        Buffer.from('{"type":"Int16","value":1.5,"id":"ab12_5"}'));

    assert.deepEqual(published.map(([t, p]) => [t, p.toString()]), [
        ["fpEdge1/test/result/ab12_1", ""],
        ["fpEdge1/test/result/ab12_2", "RO\nBadNotWritable"],
        ["fpEdge1/test/result/ab12_3", "ERR\ndevice busy"],
        ["fpEdge1/test/result/ab12_4", "CMD\naddress not in the address map"],
        ["fpEdge1/test/result/ab12_5", "CMD\nbad Int16 value 1.5"],
    ]);
});

/* Without an id the Edge Agent isn't waiting, as before confirmed
 * writes: nothing on success, err on failure. An id that can't be a
 * topic level is treated as no id. */
test("a write without an id is not answered", async () => {
    const { driver, published } = typed_driver({ write () {} });
    await set_addrs(driver, { 1: "a" });

    await driver.handleWrite("a", Buffer.from('{"type":"Int16","value":1}'));
    await driver.handleWrite("a", Buffer.from('{"type":"Int16","value":1,"id":"x/#"}'));
    await driver.handleWrite("a", Buffer.from('{"type":"Int16","value":1,"id":7}'));
    assert.deepEqual(published, []);
});

test("a write with an id before the handler exists is refused", async () => {
    const driver = new Driver({
        handler: class { static typedWrites = true; },
        env: {
            EDGE_USERNAME:  "test",
            EDGE_MQTT:      "mqtt://localhost:1",
            EDGE_PASSWORD:  "x",
        },
    });
    const published = [];
    driver.mqtt = { connected: true, publish: (t, p) => published.push([t, p]) };
    await driver.handleWrite("a", Buffer.from('{"type":"Int16","value":1,"id":"z_1"}'));
    assert.deepEqual(published, [["fpEdge1/test/result/z_1", "ERR\nthe driver has no handler yet"]]);
});

/* The same ranges as the Rust library and acs-edge's INT_RANGES. */
test("typed_value refuses values that don't fit their type", async () => {
    const { typed_value } = await import("../lib/driver.js");
    const ok = [
        ["Int8", -128, -128], ["Int8", 127, 127], ["UInt8", 255, 255],
        ["Int16", -32768, -32768], ["UInt16", 65535, 65535],
        ["Int32", -2147483648, -2147483648], ["UInt32", 4294967295, 4294967295],
        ["Int64", "-9223372036854775808", -(2n ** 63n)],
        ["Int64", "+5", 5n], ["Int64", 12, 12n],
        ["UInt64", "18446744073709551615", 2n ** 64n - 1n],
        ["Float", 3.4e38, 3.4e38], ["Float", "Infinity", Infinity],
        ["Double", 1e39, 1e39], ["DateTime", 1763380800123, 1763380800123],
    ];
    for (const [type, value, want] of ok)
        assert.equal(typed_value(type, value), want, `${type} ${value}`);

    const bad = [
        ["Int8", 128], ["Int8", -129], ["UInt8", 256], ["UInt8", -1],
        ["Int16", 32768], ["UInt16", 65536], ["Int32", 2147483648],
        ["UInt32", 4294967296], ["UInt32", -1], ["Int16", 1.5],
        ["Int64", "9223372036854775808"], ["Int64", ""], ["Int64", " 1"],
        ["Int64", "0x10"], ["Int64", "1e3"], ["Int64", 2 ** 60],
        ["UInt64", "-1"], ["UInt64", "18446744073709551616"], ["UInt64", -1],
        ["Float", 1e39], ["Float", -3.5e38], ["DateTime", 1e300],
    ];
    for (const [type, value] of bad)
        assert.equal(typed_value(type, value), undefined, `${type} ${value}`);
});

/* A rejected address map is remembered: the handler connecting again
 * reports ADDR, not UP, until a good map arrives. */
test("a rejected address map stays ADDR when the handler connects", async () => {
    const results = ["CONN", "UP"];
    class Handler {
        static create () { return new Handler(); }
        parseAddr (a) { return a == "bad" ? undefined : a; }
        connect () { return results.shift() ?? "UP"; }
    }
    const driver = new Driver({
        handler: Handler,
        env: {
            EDGE_USERNAME:  "test",
            EDGE_MQTT:      "mqtt://localhost:1",
            EDGE_PASSWORD:  "x",
        },
    });
    driver.reconnect = 10;
    const statuses = [];
    driver.mqtt = {
        connected: true,
        publish: (t, p) => { if (t.endsWith("/status")) statuses.push(p); },
    };
    const send = (msg, obj) => driver.messageHandlers.get(msg)(
        Buffer.from(JSON.stringify(obj)));

    await send("conf", {});
    await send("addr", { version: 1, addrs: { 1: "bad" }, groups: {} });
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(statuses, ["CONN", "ADDR", "ADDR"]);

    await send("addr", { version: 1, addrs: { 1: "a" }, groups: {} });
    assert.equal(statuses.at(-1), "UP");
});
