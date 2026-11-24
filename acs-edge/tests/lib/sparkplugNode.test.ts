/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* SparkplugNode against a fake Sparkplug client. The node gets its
 * client from fplus.MQTT.basic_sparkplug_node, so the fake stands in
 * for the broker connection and records every publish. */

import { EventEmitter } from "events";
import Long from "long";

import { SparkplugNode } from "../../lib/sparkplugNode";
import { sparkplugDataType } from "../../lib/helpers/typeHandler";
import * as UUIDs from "../../lib/uuids";

const NODE_UUID = "11111111-2222-4333-8444-555555555555";

class FakeClient extends EventEmitter {
    calls: [string, ...any[]][] = [];
    connect () { this.calls.push(["connect"]); }
    stop () { this.calls.push(["stop"]); }
    publishNodeBirth (p: any) { this.calls.push(["NBIRTH", p]); }
    publishNodeData (p: any) { this.calls.push(["NDATA", p]); }
    publishDeviceBirth (d: string, p: any, o: any) { this.calls.push(["DBIRTH", d, p, o]); }
    publishDeviceData (d: string, p: any, o: any) { this.calls.push(["DDATA", d, p, o]); }
    publishDeviceDeath (d: string, p: any) { this.calls.push(["DDEATH", d, p]); }
    of (kind: string) { return this.calls.filter(c => c[0] == kind); }
}

async function setup (conf: any = {}) {
    const client = new FakeClient();
    const opts: any[] = [];
    const fplus: any = {
        MQTT: {
            basic_sparkplug_node: async (o: any) => { opts.push(o); return client; },
        },
    };
    const node = await new SparkplugNode(fplus, {
        address: { group: "G", node: "N" } as any,
        uuid: NODE_UUID,
        ...conf,
    }).init();
    return { node, client, opts };
}

/* Let the async publish methods run. */
const settle = () => new Promise(r => setImmediate(r));

test("init connects a Sparkplug client for the node's address", async () => {
    const { client, opts } = await setup();
    expect(opts).toHaveLength(1);
    expect(opts[0].address).toEqual({ group: "G", node: "N" });
    expect(opts[0].publishDeath).toBe(true);
    expect(opts[0].clientId).toMatch(/^G-N-/);
    expect(client.of("connect")).toHaveLength(1);
});

test("the NBIRTH names the Edge Agent schema and this node, and gives every metric an alias", async () => {
    const { node, client } = await setup({ configRevision: "rev-uuid" });
    const dbirthAll = jest.fn();
    node.on("dbirth-all", dbirthAll);

    client.emit("birth");
    await settle();

    const [[, payload]] = client.of("NBIRTH");
    expect(payload.uuid).toBe(UUIDs.Special.FactoryPlus);
    const byName = Object.fromEntries(payload.metrics.map((m: any) => [m.name, m]));
    expect(byName["Schema_UUID"].value).toBe(UUIDs.Schema.EdgeAgent);
    expect(byName["Instance_UUID"].value).toBe(NODE_UUID);
    expect(byName["Config_Revision"].value).toBe("rev-uuid");
    expect(byName["Node Control/Rebirth"].value).toBe(false);
    expect(byName["Alerts/Config_Unavailable/Active"].value).toBe(false);
    expect(payload.metrics.map((m: any) => m.alias))
        .toEqual(payload.metrics.map((_: any, i: number) => i));
    expect(dbirthAll).toHaveBeenCalledTimes(1);
});

test("a DBIRTH is dropped while offline and sent once connected", async () => {
    const { node, client } = await setup();
    const metrics = () => [{ name: "temp", type: sparkplugDataType.float, value: 1.5 }];

    await node.publishDBirth("dev", metrics() as any);
    expect(client.of("DBIRTH")).toHaveLength(0);

    client.emit("connect");
    expect(node.isOnline).toBe(true);
    await node.publishDBirth("dev", metrics() as any);

    const [[, dev, payload, opts]] = client.of("DBIRTH");
    expect(dev).toBe("dev");
    expect(payload.metrics[0].name).toBe("temp");
    expect(payload.metrics[0].value).toBe(1.5);
    expect(typeof payload.metrics[0].alias).toBe("number");
    expect(opts).toEqual({ compress: false });

    client.emit("offline");
    expect(node.isOnline).toBe(false);
});

test("DDATA carries values and aliases but no names or properties", async () => {
    const { node, client } = await setup();
    await node.publishDData("dev", [{
        name: "temp", alias: 7, type: sparkplugDataType.float, value: 2.5,
        properties: { address: { type: "String", value: "a" } },
        timestamp: 1_700_000_000_000,
    }] as any);

    const [[, dev, payload]] = client.of("DDATA");
    expect(dev).toBe("dev");
    const [m] = payload.metrics;
    expect(m.name).toBeUndefined();
    expect(m.properties).toBeUndefined();
    expect(m.alias).toBe(7);
    expect(m.value).toBe(2.5);
    /* A millisecond timestamp is sent as unsigned nanoseconds. */
    expect(m.timestampNs).toBe(1_700_000_000_000_000_000n);
    expect(Long.isLong(m.timestamp)).toBe(true);
    expect(m.timestamp.unsigned).toBe(true);
    expect(m.timestamp.toString()).toBe("1700000000000000000");
});

test("strings are stringified and an empty value is sent as null", async () => {
    const { node, client } = await setup();
    await node.publishDData("dev", [
        { name: "s", alias: 1, type: sparkplugDataType.string, value: 42 },
        { name: "e", alias: 2, type: sparkplugDataType.string, value: "" },
    ] as any);

    const [[, , payload]] = client.of("DDATA");
    expect(payload.metrics[0].value).toBe("42");
    expect(payload.metrics[1].value).toBeNull();
});

test("a metric name loses characters Sparkplug does not allow", async () => {
    const { node, client } = await setup();
    client.emit("connect");
    await node.publishDBirth("dev", [
        { name: "a.b#c/d (e)", type: sparkplugDataType.float, value: 1 },
    ] as any);
    const [[, , payload]] = client.of("DBIRTH");
    expect(payload.metrics[0].name).toBe("abc/d (e)");
});

test("NCMD Rebirth republishes the NBIRTH and Reload asks the agent to stop", async () => {
    const { node, client } = await setup();
    const stop = jest.fn();
    node.on("stop", stop);

    client.emit("ncmd", { metrics: [{ name: "Node Control/Rebirth", value: true }] });
    await settle();
    expect(client.of("NBIRTH")).toHaveLength(1);

    client.emit("ncmd", { metrics: [{ name: "Node Control/Reload Edge Agent Config", value: true }] });
    await settle();
    expect(stop).toHaveBeenCalledTimes(1);
});

test("a DCMD is passed on to the agent", async () => {
    const { node, client } = await setup();
    const dcmd = jest.fn();
    node.on("dcmd", dcmd);
    const payload = { metrics: [] };
    client.emit("dcmd", "dev", payload);
    expect(dcmd).toHaveBeenCalledWith("dev", payload);
});

test("DDEATH is published with a nanosecond timestamp", async () => {
    const { node, client } = await setup();
    await node.publishDDeath("dev");
    const [[, dev, payload]] = client.of("DDEATH");
    expect(dev).toBe("dev");
    expect(BigInt(payload.timestamp.toString())).toBeGreaterThan(1_000_000_000_000_000n);
});

test("stop stops the client and marks the node offline", async () => {
    const { node, client } = await setup();
    client.emit("connect");
    await node.stop();
    expect(client.of("stop")).toHaveLength(1);
    expect(node.isOnline).toBe(false);
});

test("the NBIRTH offers Node Control/Scout as an empty String", async () => {
    const { client } = await setup();
    client.emit("birth");
    await settle();
    const [[, payload]] = client.of("NBIRTH");
    const scout = payload.metrics.find((m: any) => m.name == "Node Control/Scout");
    expect(scout).toBeDefined();
    expect(scout.type).toBe(sparkplugDataType.string);
    expect(scout.value).toBeNull();
});

test("NCMD Scout passes the parsed request on, by name or by alias", async () => {
    const { node, client } = await setup();
    const scout = jest.fn();
    node.on("scout", scout);
    const req = { version: 1, op: "cancel", request: "r", connection: "c" };

    client.emit("ncmd", { metrics: [{ name: "Node Control/Scout", value: JSON.stringify(req) }] });
    await settle();
    expect(scout).toHaveBeenCalledWith(req);

    client.emit("birth");
    await settle();
    const [[, payload]] = client.of("NBIRTH");
    const alias = payload.metrics.find((m: any) => m.name == "Node Control/Scout").alias;
    client.emit("ncmd", { metrics: [{ alias: Long.fromNumber(alias), value: JSON.stringify(req) }] });
    await settle();
    expect(scout).toHaveBeenCalledTimes(2);
});

test("NCMD Scout ignores a value that is not a JSON object", async () => {
    const { node, client } = await setup();
    const scout = jest.fn();
    node.on("scout", scout);
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
        for (const value of ["{bad", "[1]", "\"text\"", "null", ""])
            client.emit("ncmd", { metrics: [{ name: "Node Control/Scout", value }] });
        await settle();
        expect(scout).not.toHaveBeenCalled();
        expect(err).toHaveBeenCalledTimes(5);
    }
    finally {
        err.mockRestore();
    }
});
