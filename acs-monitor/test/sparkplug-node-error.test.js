/*
 * ACS Monitor
 * Tests that MQTT errors from the Sparkplug node don't crash the
 * monitor.
 */

import assert           from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test }         from "node:test";
import { format }       from "node:util";

import { SparkplugNode } from "../lib/sparkplug/node.js";

test("an MQTT error from the Sparkplug node is logged, not thrown",
async () => {
    const logs = [];
    const debug = {
        log: (ch, ...args) => logs.push(`${ch}: ${format(...args)}`),
    };
    debug.bound = ch => debug.log.bind(debug, ch);

    /* The node re-emits the MQTT client's events */
    const splug = new EventEmitter();
    const fplus = {
        debug,
        Auth: {
            find_principal: async () => ({
                uuid:       "3f4c8a6e-6d7b-4f63-9d2e-2a9b3c1d4e5f",
                sparkplug:  "Group/Monitor",
            }),
        },
        MQTT: { basic_sparkplug_node: async () => splug },
    };

    await new SparkplugNode({ fplus }).init();

    /* What mqtt.js emits when the broker resets the connection */
    const err = Object.assign(new Error("read ECONNRESET"),
        { code: "ECONNRESET" });
    assert.doesNotThrow(() => splug.emit("error", err));
    assert.ok(logs.some(l => /MQTT error: read ECONNRESET/.test(l)),
        "the error is logged");
});
