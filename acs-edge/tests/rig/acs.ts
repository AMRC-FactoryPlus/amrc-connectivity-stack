/*
 * ACS Edge Agent
 * Split-driver cluster rig: ACS objects the loader and remover share
 * Copyright 2026 University of Sheffield
 */

import crypto from "crypto";

import type { Protocol, Rig, RigConnection } from "./rig.js";

/* A v5 UUID, as `uuid_v5` in the service client makes it. Done here so
 * this file loads without the service client, which is an ES module
 * the jest tests can't load. */
export function uuid_v5 (name: string, namespace: string): string {
    const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
    const h = crypto.createHash("sha1")
        .update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const hex = h.subarray(0, 16).toString("hex");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
        hex.slice(16, 20), hex.slice(20)].join("-");
}

/* The namespace of the rig's UUIDs. Every object the loader creates
 * has a UUID made from this, the rig's prefix and the object's place
 * in the rig, so a second load finds the objects the first made. */
const RIG_NAMESPACE = "6d1c4f0e-5b7a-4c39-9e2a-3f6b8a0d47c1";

export function rig_uuid (rig: Rig, ...parts: string[]): string {
    return uuid_v5([rig.prefix, ...parts].join("\0"), RIG_NAMESPACE);
}

export const node_uuid = (rig: Rig, node: string) => rig_uuid(rig, "node", node);
export const conn_uuid = (rig: Rig, c: RigConnection) => rig_uuid(rig, "connection", c.node, c.id);
export const device_uuid = (rig: Rig, c: RigConnection, dev: string) =>
    rig_uuid(rig, "device", c.node, c.id, dev);

/* The built-in DriverDefs, from acs-service-setup/lib/uuids.js
 * (`ACS.Driver`). A connection made in the Manager before version 7
 * names one of these. */
export const BuiltIn: { [p in Protocol]: string } = {
    "REST":     "c9f5c6ac-de4d-11ef-befa-ef66bbfc8926",
    "OPC UA":   "f32fed40-de4d-11ef-a011-1711bd498427",
    "MQTT":     "f4789ae4-de4d-11ef-9de4-ab74010e5ff5",
    "UDP":      "f76120f0-de4d-11ef-baeb-4b617561ae1d",
};

/* From lib/js-service-client/lib/uuids.js. */
export const App = {
    Info:                       "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    SparkplugAddress:           "8e32801b-f35a-4cbf-a5c3-2af64d3debd7",
    ServiceConfig:              "5b47881c-b012-4040-945c-eacafca539b2",
    EdgeAgentConfig:            "aac6f843-cfee-4683-b121-6943bfdf9173",
    EdgeAgentDeployment:        "f2b9417a-ef7f-421f-b387-bb8183a48cdb",
    EdgeClusterConfiguration:   "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
    DeviceInformation:          "a98ffed5-c613-4e70-bfd3-efeee250ade5",
    ConnectionConfiguration:    "fa8b429c-de3e-11ef-87fd-6382f0eac944",
};
export const Class = {
    Device:                     "18773d6d-a70d-443a-b29a-3f1583195290",
    EdgeAgent:                  "00da3c0b-f62b-4761-a689-39ad0c33f864",
    EdgeAgentConnection:        "f371cbfc-de3e-11ef-b361-7b31622bc42f",
};
export const Service = {
    Clusters:                   "2706aa43-a826-441e-9cec-cd3d4ce623c2",
    Manager:                    "619eecab-742d-4824-8b97-bcae472e5c04",
};

/* A ServiceClient from the environment: DIRECTORY_URL, and
 * SERVICE_USERNAME and SERVICE_PASSWORD (or a Kerberos ccache). */
export async function service_client (): Promise<any> {
    if (!process.env.DIRECTORY_URL)
        throw new Error("Set DIRECTORY_URL, SERVICE_USERNAME and SERVICE_PASSWORD");
    const { ServiceClient } = await import("@amrc-factoryplus/service-client");
    return new ServiceClient({ env: process.env });
}

/* The edge cluster to put the rig on: the one named, or the only one. */
export async function find_cluster (cdb: any, want?: string) {
    const clusters: Map<string, any> = await cdb.get_all_configs(App.EdgeClusterConfiguration);
    if (want) {
        const conf = clusters.get(want);
        if (!conf) throw new Error(`No edge cluster ${want}`);
        return { uuid: want, conf };
    }
    if (clusters.size != 1)
        throw new Error(`There are ${clusters.size} edge clusters; choose one with --cluster <uuid>: `
            + [...clusters.keys()].join(", "));
    const [[uuid, conf]] = [...clusters.entries()];
    return { uuid, conf };
}

/* The name the Manager stores beside a connection's name, for
 * Kubernetes (NewConnectionDialog.vue `sanitizeConnectionName`). */
export function k8s_name (name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9-.]/g, "-")
        .replace(/^[^a-z0-9]+/, "")
        .replace(/[^a-z0-9]+$/, "");
}

/* The name of the Secret the Manager seals connection passwords into. */
export function secret_name (node: string) {
    return `edge-agent-sensitive-information-${node}`;
}

/* Logs each write, and makes it unless this is a dry run. */
export class Writer {
    dry:    boolean
    writes = 0

    constructor (dry: boolean) {
        this.dry = dry;
    }

    async do (what: string, fn: () => Promise<any>) {
        this.writes++;
        console.log("%s%s", this.dry ? "Would " : "", what);
        if (!this.dry) await fn();
    }
}
