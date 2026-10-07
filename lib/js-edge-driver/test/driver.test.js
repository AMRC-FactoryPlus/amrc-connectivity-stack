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
