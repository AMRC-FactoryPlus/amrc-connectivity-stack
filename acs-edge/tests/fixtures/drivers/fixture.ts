/*
 * ACS Edge Agent
 * Driver fixtures: the on-disk format, and reading and writing it
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import path from "path";

export const FORMAT = "acs-driver-fixture";
export const VERSION = 1;

/* One MQTT message as the broker delivered it. */
export interface MqttEvent {
    t: number,
    type: "mqtt",
    topic: string,
    payload: string,
    encoding?: "utf8" | "base64",
}

/* The response a REST endpoint gives from time t until the next event
 * for the same path. */
export interface HttpEvent {
    t: number,
    type: "http",
    path: string,
    status: number,
    content_type: string,
    body: string,
}

export interface OpcuaValue {
    dataType: string,
    value: any,
}

/* OPC UA node values that change at time t. The first event holds
 * every node. */
export interface OpcuaEvent {
    t: number,
    type: "opcua",
    values: { [node_id: string]: OpcuaValue },
}

/* One datagram sent to the connection's port at time t. The built-in
 * UDP connection hands the agent every datagram under the address ""
 * (the empty string), so the event has no address. */
export interface UdpEvent {
    t: number,
    type: "udp",
    payload: string,
    encoding?: "utf8" | "base64",
}

export type FixtureEvent = MqttEvent | HttpEvent | OpcuaEvent | UdpEvent;

/* The events that carry one payload for one address. */
export type PayloadEvent = MqttEvent | HttpEvent | UdpEvent;

/* A metric the fixture cannot drive, and why. */
export interface Finding {
    device: string,
    metric: string,
    address: string,
    path: string,
    problem: string,
}

export interface FixtureMeta {
    format: string,
    version: number,
    name: string,
    agent: string,
    protocol: string,
    payloadFormat: string,
    delimiter: string,
    source: "synthetic" | "recorded",
    seed?: number,
    duration_ms: number,
    interval_ms: number,
    features: string[],
    counts: {
        devices: number,
        metrics: number,
        read_metrics: number,
        addresses: number,
        events: number,
        bytes: number,
    },
    findings: Finding[],
}

export interface Fixture {
    meta: FixtureMeta,
    connection: any,
    events: FixtureEvent[],
}

export function read_fixture (dir: string): Fixture {
    const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
    const meta = JSON.parse(read("fixture.json"));
    if (meta.format != FORMAT || meta.version != VERSION)
        throw new Error(`${dir} is not a version ${VERSION} driver fixture`);
    const events = read("events.jsonl").split("\n")
        .filter(l => l.trim() != "")
        .map(l => JSON.parse(l));
    return { meta, connection: JSON.parse(read("connection.json")), events };
}

export function write_fixture (dir: string, fixture: Fixture) {
    fs.mkdirSync(dir, { recursive: true });
    const write = (f: string, s: string) =>
        fs.writeFileSync(path.join(dir, f), s);
    write("fixture.json", JSON.stringify(fixture.meta, null, 2) + "\n");
    write("connection.json",
        JSON.stringify(fixture.connection, null, 2) + "\n");
    write("events.jsonl",
        fixture.events.map(e => JSON.stringify(e) + "\n").join(""));
}

/* The payload as the built-in connection hands it to the Edge Agent's
 * parser: a Buffer for MQTT and UDP, and for REST what axios gives,
 * which is a parsed object for a JSON response and a string otherwise. */
export function event_payload (ev: PayloadEvent): any {
    if (ev.type == "mqtt" || ev.type == "udp")
        return Buffer.from(ev.payload, ev.encoding == "base64" ? "base64" : "utf8");
    if (/json/.test(ev.content_type)) {
        try { return JSON.parse(ev.body); }
        catch { return ev.body; }
    }
    return ev.body;
}

/* The Edge Agent address an event is for. */
export function event_address (ev: PayloadEvent): string {
    if (ev.type == "udp") return "";
    return ev.type == "mqtt" ? ev.topic : ev.path;
}
