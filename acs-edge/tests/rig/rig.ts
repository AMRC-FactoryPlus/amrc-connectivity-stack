/*
 * ACS Edge Agent
 * Split-driver cluster rig: the rig file and the connection entries
 * Copyright 2026 University of Sheffield
 *
 * A rig is a set of mock devices, one per connection, and the Edge
 * Agent connections that read them. `make-rig` writes it as one JSON
 * file from connection configs in the redacted export form
 * (`{agent, sparkplug, connection}`). The mocks, the loader, the
 * remover, the checker and the local runner all read that file, so
 * each connection is pointed at its mock in exactly one place:
 * `rig_entry()` below.
 *
 * A rig made from real configs names real things. Keep it outside the
 * repository.
 */

import crypto from "crypto";
import fs from "fs";
import zlib from "zlib";

export const RIG_FORMAT = "acs-split-driver-rig";
export const RIG_VERSION = 1;

/* The protocols the rig mocks, as the connection's `connType`. */
export type Protocol = "OPC UA" | "MQTT" | "REST" | "UDP";
export const PROTOCOLS: Protocol[] = ["OPC UA", "MQTT", "REST", "UDP"];

/* The first port each kind of mock listens on. Each connection of a
 * protocol gets the next port up. A UDP connection keeps its own
 * port, because that is the port the device sends to. */
export const BASE_PORTS: { [p in Protocol]: number } = {
    "OPC UA":   4840,
    "MQTT":     1883,
    "REST":     8080,
    "UDP":      0,
};

/* The port the mock pods answer status and stop/start requests on. */
export const CONTROL_PORT = 9000;

/* One connection in the rig. */
export interface RigConnection {
    /* Unique in the rig, safe in a URL: `<protocol>-<n>`. */
    id:         string,
    protocol:   Protocol,
    /* The Edge Agent this connection runs on in the rig. */
    node:       string,
    /* The connection's name in the rig, the source name with the
     * rig's prefix. */
    name:       string,
    /* The source config file, for the report. */
    source:     string,
    /* The port its mock listens on (the UDP port for UDP). */
    port:       number,
    /* The credentials the mock accepts and the connection sends, if
     * the source connection uses any. The password is made up when
     * the rig is made. */
    username?:  string,
    password?:  string,
    /* The `__FPSI__` placeholder the password is stored under. */
    secret?:    string,
    /* For REST, the path part of the source base URL, which the mock
     * expects in front of every address. */
    base_path?: string,
    /* What the rig changed from the source because a mock can't do it,
     * e.g. TLS. Reported, never silently dropped. */
    changes:    string[],
    /* MQTT topics whose payload is a JSON array of `{value, timestamp}`
     * items instead of one object, as a source that batches its values
     * sends. Only for connections made with `--batched`. */
    array_topics?: string[],
    /* The source deviceConnections[] entry, unchanged. */
    connection: any,
}

export interface RigNode {
    name:       string,
    /* The source Edge Agent, for the report. */
    agent:      string,
    /* The `sparkplug` block of the source Edge Agent config. */
    sparkplug:  any,
    /* Values for the node's EdgeAgentDeployment, merged over the Edge
     * Agent chart's for this node only: its resource requests, and an
     * image pin for a node made with `--batched`. */
    values?:    any,
}

export interface Rig {
    format:     string,
    version:    number,
    /* Every node, connection and device the loader creates has a name
     * starting with this. The remover finds the rig by it. */
    prefix:     string,
    /* The Kubernetes namespace the mocks run in. */
    namespace:  string,
    /* Seed and length of the synthetic data each mock replays in a
     * loop. */
    seed:       number,
    duration_ms: number,
    /* MQTT publish interval per topic, and UDP datagram interval. */
    mqtt_interval_ms: number,
    nodes:      RigNode[],
    connections: RigConnection[],
}

/* Read a rig file, gzipped or not. */
export function read_rig (file: string): Rig {
    let buf = fs.readFileSync(file);
    if (buf[0] == 0x1f && buf[1] == 0x8b) buf = zlib.gunzipSync(buf);
    const rig = JSON.parse(buf.toString("utf8"));
    if (rig.format != RIG_FORMAT || rig.version != RIG_VERSION)
        throw new Error(`${file} is not a version ${RIG_VERSION} rig file`);
    return rig;
}

export function write_rig (file: string, rig: Rig) {
    const json = JSON.stringify(rig, null, 1) + "\n";
    fs.writeFileSync(file, file.endsWith(".gz") ? zlib.gzipSync(json) : json);
}

/* The service name of a protocol's mock pod. */
export function mock_service (proto: Protocol): string {
    return "rig-" + proto.toLowerCase().replace(/[^a-z]/g, "");
}

/* A name made safe for a Sparkplug node or device: letters, digits,
 * underscore and hyphen. */
export function sparkplug_safe (name: string): string {
    return name.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

/* Made-up credentials, so a rig never carries a real password. */
export function made_up_password (): string {
    return crypto.randomBytes(12).toString("base64url");
}

export function made_up_secret (): string {
    return "__FPSI__" + crypto.randomBytes(16).toString("hex");
}

/* The details key of a built-in connection entry. */
export function details_key (proto: Protocol): string {
    return {
        "OPC UA":   "OPCUAConnDetails",
        "MQTT":     "MQTTConnDetails",
        "REST":     "RESTConnDetails",
        "UDP":      "UDPConnDetails",
    }[proto];
}

export interface EntryOpts {
    /* Where the connection reaches its mock. For UDP this is ignored:
     * the connection listens and the sender comes to it. */
    host:       string,
    /* The password as the Edge Agent config holds it: the `__FPSI__`
     * placeholder on a cluster, or the password itself locally. */
    password:   (c: RigConnection) => string | undefined,
    /* Give the connection and the Edge Agent entry this UUID. */
    uuid?:      string,
    /* Device Instance_UUIDs, by deviceId, to replace the source's. */
    devices?:   { [deviceId: string]: string },
}

/* The built-in connection entry for a rig connection: the source entry
 * with its name, its UUID and its details pointed at the mock, and
 * nothing else changed. Devices, tags, addresses, paths, payload
 * formats, poll interval and security settings stay exactly as the
 * source has them, including anything odd, because the odd cases are
 * what the rig is for. */
export function rig_entry (c: RigConnection, opts: EntryOpts): any {
    const entry = JSON.parse(JSON.stringify(c.connection));
    entry.name = c.name;
    if (opts.uuid) entry.uuid = opts.uuid;

    const key = details_key(c.protocol);
    const src = entry[key] ?? {};
    const pw = opts.password(c);
    let details: any;

    switch (c.protocol) {
    case "OPC UA":
        details = {
            ...src,
            endpoint:   `opc.tcp://${opts.host}:${c.port}`,
        };
        if (src.useCredentials) {
            details.username = c.username;
            details.password = pw;
        }
        break;
    case "MQTT":
        details = {
            ...src,
            protocol:   "mqtt",
            host:       opts.host,
            port:       c.port,
            useSSL:     false,
        };
        if (src.username) {
            details.username = c.username;
            details.password = pw;
        }
        break;
    case "REST":
        details = {
            ...src,
            baseURL:    `http://${opts.host}:${c.port}${c.base_path ?? ""}`,
        };
        if (src.authMethod && src.authMethod != "None") {
            details.username = c.username;
            details.password = pw;
        }
        break;
    case "UDP":
        details = { ...src, port: c.port };
        break;
    }
    entry[key] = details;

    if (opts.devices) {
        for (const dev of entry.devices ?? []) {
            const uuid = opts.devices[dev.deviceId];
            if (!uuid) continue;
            for (const tag of dev.tags ?? [])
                if (tag.Name == "Instance_UUID") tag.value = uuid;
        }
    }
    return entry;
}

/* The ConnectionConfiguration `config` the Manager would hold for this
 * connection: the details without anything the Manager keeps
 * elsewhere. */
export function manager_config (entry: any, proto: Protocol): any {
    return JSON.parse(JSON.stringify(entry[details_key(proto)] ?? {}));
}

/* The connections of one node, in rig order. */
export function node_connections (rig: Rig, node: string): RigConnection[] {
    return rig.connections.filter(c => c.node == node);
}

/* The Sparkplug type of a metric whose config type may carry a byte
 * order (`FloatLE`, `UInt16BE`), which only says how to read it from a
 * buffer. A write must name the Sparkplug type, as the device's birth
 * does. */
export function sparkplug_type (type: string): string {
    return type.replace(/(LE|BE)$/, "");
}

/* Devices of a connection, by Sparkplug device id. */
export function device_ids (c: RigConnection): string[] {
    return (c.connection.devices ?? []).map((d: any) => d.deviceId);
}
