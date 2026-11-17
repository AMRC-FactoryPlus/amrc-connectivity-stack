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
