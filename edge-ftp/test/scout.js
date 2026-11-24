/*
 * ACS FTP driver
 * Edge Scout test: the driver answers that it can't list addresses.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { PolledDriver } from "@amrc-factoryplus/edge-driver";

import { FTPHandler } from "../lib/handler.js";

/* The driver is built on the in-repo library, so it subscribes to
 * scout when the Edge Agent offers it and answers UNSUPPORTED, not
 * LIBRARY. No conf is sent: the answer must not depend on reaching
 * the device. */
test("a scan answers UNSUPPORTED", async () => {
    const driver = new PolledDriver({
        env: {
            EDGE_USERNAME:  "Conn",
            EDGE_MQTT:      "mqtt://localhost:1",
            EDGE_PASSWORD:  "x",
        },
        handler:    FTPHandler,
        serial:     true,
    });
    const published = [];
    const subscribed = [];
    driver.mqtt = {
        connected: true,
        publish (topic, payload) {
            published.push([topic, JSON.parse(payload)]);
        },
        async publishAsync (topic, payload) {
            this.publish(topic, payload);
        },
        async subscribeAsync (topic) {
            subscribed.push(topic);
            return [{ topic, qos: 0 }];
        },
    };

    await driver.setAddrs({ version: 1, addrs: {}, groups: {},
        features: { scout: 1 } });
    assert.deepStrictEqual(subscribed, ["fpEdge1/Conn/scout"]);

    const send = msg => driver.handleMessage("fpEdge1/Conn/scout",
        Buffer.from(JSON.stringify(msg)));
    await send({ op: "hello" });
    await send({ op: "start", id: "s1", version: 1, root: null,
        folder_id: null, options: {} });

    const [[hello_topic, hello], [end_topic, end]] = published;
    assert.strictEqual(hello_topic, "fpEdge1/Conn/found/hello");
    assert.strictEqual(hello.supported, false);
    assert.match(hello.library, /^js-edge-driver \d+\.\d+\.\d+/);
    assert.strictEqual(end_topic, "fpEdge1/Conn/found/s1");
    assert.deepStrictEqual(end, { seq: 0, type: "end",
        error: { code: "UNSUPPORTED", message: "This driver can't list its addresses" } });
});
