/*
 * ACS simulator driver
 * Test harness: a driver on a fake MQTT client, and schema checks
 * Copyright 2026 University of Sheffield
 */

import assert from "node:assert/strict";

import Ajv2020 from "ajv/dist/2020.js";
import add_formats from "ajv-formats";

import { add_schemas } from "../../../lib/edge-scout-schemas/lib/index.js";

const ajv = new Ajv2020({ strictTypes: true, strictTuples: true });
add_formats(ajv);
export const validator = add_schemas(ajv);
const check_found = validator("found");
const check_item = validator("item");
/* One entry of a values answer. */
export const check_value = ajv.getSchema("urn:edge-scout:common#/$defs/read_value");

export const LIMITS = { items: 20000, depth: 8, seconds: 120, pace_ms: 0, samples: false };

const ENV = {
    EDGE_USERNAME:  "Conn",
    EDGE_MQTT:      "mqtt://localhost:1",
    EDGE_PASSWORD:  "x",
};

export function assert_item (item) {
    assert.ok(check_item(item),
        `item fails the schema: ${JSON.stringify(item)} ${JSON.stringify(check_item.errors)}`);
}

/* A stand-in for the mqtt.js client that records what the driver
 * publishes. The driver connects manually, so this never touches the
 * network. */
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

/* A library Driver of class `cls` around the handler class, configured
 * and told about the feature as the Edge Agent does on READY. */
export async function ready_driver (cls, Handler, conf = {}) {
    const driver = new cls({ handler: Handler, env: ENV });
    driver.mqtt = fake_mqtt();
    driver.scouter.progress_ms = 60000;
    driver.scouter.grace_ms = 50;
    driver.scouter.flush_ms = 5;

    await driver.messageHandlers.get("conf")(Buffer.from(JSON.stringify(conf)));
    await driver.setAddrs({ version: 1, addrs: {}, groups: {}, features: { scout: 1 } });
    assert.ok(driver.mqtt.subscribed.includes("fpEdge1/Conn/scout"));
    return driver;
}

/* Every found message published for one id, parsed and checked
 * against the schemas. */
export function found (driver, id) {
    const topic = `fpEdge1/Conn/found/${id}`;
    return driver.mqtt.published
        .filter(([t]) => t == topic)
        .map(([, p]) => {
            const msg = JSON.parse(p);
            assert.ok(check_found(msg),
                `found message fails the schema: ${p.slice(0, 200)} ${JSON.stringify(check_found.errors)}`);
            if (msg.type == "items")
                msg.items.forEach(assert_item);
            return msg;
        });
}

/* Start a scan through the scout topic and wait for it to end.
 * Returns the found messages, after checking the seq rule and that
 * there is exactly one end, last. */
export async function scan (driver, id, request) {
    await driver.handleMessage("fpEdge1/Conn/scout", Buffer.from(JSON.stringify({
        op: "start", id, version: 1, root: null, folder_id: null,
        options: {}, ...request, limits: { ...LIMITS, ...request?.limits },
    })));
    await driver.scouter.scan?.done;
    const msgs = found(driver, id);
    assert.deepEqual(msgs.map(m => m.seq), msgs.map((m, i) => i));
    assert.equal(msgs.filter(m => m.type == "end").length, 1);
    assert.equal(msgs.at(-1).type, "end");
    return msgs;
}

export function items_of (msgs) {
    return msgs.filter(m => m.type == "items").flatMap(m => m.items);
}

/* A stand-in for the library's `out`, for calling a handler's scout
 * directly. It records items and keeps to the item cap as the library
 * does. */
export function fake_out (limits = {}) {
    const abort = new AbortController();
    const out = {
        items:      [],
        calls:      [],
        progressed: [],
        paces:      0,
        limits:     { ...LIMITS, ...limits },
        signal:     abort.signal,
        abort:      () => abort.abort(),
        async add (items) {
            items = Array.isArray(items) ? items : [items];
            out.calls.push(items.length);
            for (const item of items) {
                if (out.items.length >= out.limits.items) {
                    abort.abort();
                    throw new Error("item cap");
                }
                out.items.push(item);
            }
        },
        progress (p) { out.progressed.push(p); },
        async pace () { out.paces++; },
    };
    return out;
}

/* Check that every item's parent is listed before it, or is null, or
 * is `outside` (the parent of a branch scan's folder). */
export function assert_tree (items, outside = null) {
    const seen = new Set();
    for (const item of items) {
        assert_item(item);
        assert.ok(!seen.has(item.id), `duplicate id ${item.id}`);
        assert.ok(item.parent === null || item.parent === outside || seen.has(item.parent),
            `parent ${item.parent} of ${item.id} is not listed before it`);
        seen.add(item.id);
    }
}
