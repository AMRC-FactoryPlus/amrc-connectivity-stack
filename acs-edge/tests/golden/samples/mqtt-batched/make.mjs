/*
 * ACS Edge Agent
 * Golden-output harness: build the mqtt-batched sample
 * Copyright 2026 University of Sheffield
 *
 * The fixture generator can't make JSON (Batched) payloads, so this
 * sample is built here. Run `node make.mjs` in this directory to
 * write it again.
 *
 * It is the shape of a busy production connection with the names
 * changed: under JSON (Batched), one device reads topics that carry
 * a JSON array of {value, timestamp} items next to topics that carry
 * one JSON object, and the Edge Agent reads an object as plain JSON.
 * It also has wildcard addresses: `sample/hf/#` overlaps the exact
 * address `sample/hf/extra`, and `sample/+/status` matches topics no
 * metric names exactly, so only the subscription sees them.
 *
 * Item timestamps are written `__NOW_MS-<ms>__`, which the fake broker
 * replaces with the time it sends the message less <ms>, so both runs
 * of a comparison get timestamps at the same offsets.
 */

import fs from "fs";

const DURATION = 5000;
const INTERVAL = 1000;

const tag = (Name, type, address, path) => ({
    Name, type, method: "GET", address, path, value: null, recordToDB: true,
});
const device = (deviceId, tags) => ({
    deviceId, deviceType: "00000000-0000-4000-8000-000000000001",
    pubInterval: 0, payloadFormat: "JSON (Batched)", templates: [], tags,
});
const filter = name => `$.set.datapoints[?(@.name=='${name}')].value`;

const connection = {
    name:           "sample-mqtt-batched",
    uuid:           "00000000-0000-4000-8000-000000000002",
    connType:       "MQTT",
    payloadFormat:  "JSON (Batched)",
    devices: [
        device("Device_1", [
            tag("Metric_01", "DoubleLE", "sample/hf_01", "$.value"),
            tag("Metric_02", "FloatLE", "sample/hf_02", "$.value"),
            tag("Metric_03", "Boolean", "sample/hf_03", "$.value"),
            tag("Metric_04", "DoubleLE", "sample/set_01", filter("ActLoad")),
            tag("Metric_05", "String", "sample/set_01", filter("Program")),
            tag("Metric_06", "DoubleLE", "sample/hf/#", "$.value"),
            tag("Metric_07", "DoubleLE", "sample/hf/extra", "$.value"),
        ]),
        device("Device_2", [
            tag("Metric_08", "UInt32LE", "sample/set_02", filter("Count")),
            tag("Metric_09", "DoubleLE", "sample/+/status", "$.value"),
        ]),
    ],
    MQTTConnDetails: {
        host: "mqtt.example", port: 1883, useSSL: false, protocol: "mqtt",
        clientId: "", username: "", password: "REDACTED",
        keepAlive: 60, cleanSession: true,
    },
};

/* Three items per message, 100 ms apart, the last sent now. */
const items = values => values.map((value, i) =>
    `{"value":${JSON.stringify(value)},"timestamp":__NOW_MS-${(values.length - 1 - i) * 100}__}`);
const array = values => `[${items(values).join(",")}]`;
const set = points => JSON.stringify({ set: { datapoints:
    Object.entries(points).map(([name, value]) => ({ name, value })) } });

/* Floats are exact 32-bit values so they survive Sparkplug. */
const f32 = x => Math.fround(x);
const PROGRAMS = ["SETUP", "RUN_A", "RUN_B"];

const events = [];
for (let n = 0, t0 = 20; t0 < DURATION; n++, t0 += INTERVAL) {
    const k = [0, 1, 2].map(i => 3 * n + i);
    const msgs = [
        ["sample/hf_01", array(k.map(i => 100 + 10 * Math.sin(i / 3)))],
        ["sample/hf_02", array(k.map(i => f32(20 + Math.cos(i / 2))))],
        ["sample/hf_03", array(k.map(i => i % 4 < 2))],
        ["sample/set_01", set({ ActLoad: 40 + n * 1.5, Program: PROGRAMS[n % 3] })],
        ["sample/hf/extra", array(k.map(i => 5 + i / 8))],
        ["sample/set_02", set({ Count: 1000 + 7 * n })],
        ["sample/line/status", `{"value":${n}}`],
        ["sample/hf/other", array([n])],
    ];
    msgs.forEach(([topic, payload], i) =>
        events.push({ t: t0 + 37 * i, type: "mqtt", topic, payload }));
}

const meta = {
    format: "acs-driver-fixture", version: 1,
    name: connection.name, agent: "sample-agent", protocol: "MQTT",
    payloadFormat: connection.payloadFormat, delimiter: "",
    source: "synthetic", seed: 1,
    duration_ms: DURATION, interval_ms: INTERVAL,
    features: [
        "batched:array-and-object", "many-metrics-per-address",
        "mqtt:protocol:mqtt", "mqtt:wildcard", "mqtt:overlapping-filters",
        "multi-device", "payload:JSON (Batched)", "protocol:MQTT",
        "type:Boolean", "type:Double", "type:Float", "type:String", "type:UInt32",
    ],
    counts: {
        devices: connection.devices.length,
        metrics: 9, read_metrics: 9, addresses: 9,
        events: events.length,
        bytes: events.reduce((n, e) => n + Buffer.byteLength(e.payload), 0),
    },
    findings: [],
};

const here = new URL(".", import.meta.url);
fs.writeFileSync(new URL("fixture.json", here), JSON.stringify(meta, null, 2) + "\n");
fs.writeFileSync(new URL("connection.json", here), JSON.stringify(connection, null, 2) + "\n");
fs.writeFileSync(new URL("events.jsonl", here),
    events.map(e => JSON.stringify(e)).join("\n") + "\n");
