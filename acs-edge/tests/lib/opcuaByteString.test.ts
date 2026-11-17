/*
 * ACS Edge Agent
 * An OPC UA ByteString publishes the same through the split driver as
 * it did through the built-in OPC UA connection
 * Copyright 2026 University of Sheffield
 *
 * The built-in connection handed the Edge Agent the Buffer node-opcua
 * decoded, with parseVals false. edge-opcua sends
 * {"value": {"type": "Buffer", "data": [...]}, "timestamp": ms} to a
 * device whose payload format is JSON with an empty path. The expected
 * values below were recorded from the built-in route (OPCUA.ts emits
 * {nodeId: Buffer} with parseVals false) on feature/split-drivers at
 * 00c08fe6, because that connection is being removed.
 */

import { EventEmitter } from "events";
import Long from "long";
import { Device } from "../../lib/device";
import { SparkplugNode } from "../../lib/sparkplugNode";

const ADDR = "ns=2;s=Blob";
const BYTES = [0x41, 0x42, 0x00, 0xff, 0x7f];
const RECEIVED_MS = 1763380800123;

/* What the built-in route published for each metric type, as
 * [value, isNull]: Bytes kept the Buffer (shown as hex), the string
 * types got the Buffer's UTF-8 text, and a number type got the Buffer
 * as it was. */
const BUILT_IN: { [type: string]: { value: any, isNull: boolean } } = {
    Bytes:  { value: { hex: "414200ff7f" }, isNull: false },
    String: { value: "AB\u0000�\u007f", isNull: false },
    Text:   { value: { hex: "414200ff7f" }, isNull: false },
    UInt32: { value: { hex: "414200ff7f" }, isNull: false },
    Double: { value: { hex: "414200ff7f" }, isNull: false },
};

function show (v: any) {
    if (Buffer.isBuffer(v)) return { hex: v.toString("hex") };
    if (v instanceof Uint8Array) return { hex: Buffer.from(v).toString("hex") };
    if (Long.isLong(v)) return { long: v.toString() };
    return v;
}

/* A real SparkplugNode, with the MQTT client replaced by one that
 * records each DDATA payload as the node built it. */
async function node () {
    const datas: any[] = [];
    const client: any = new EventEmitter();
    client.connect = () => {};
    client.publishDeviceDeath = () => {};
    client.publishDeviceBirth = () => {};
    client.publishDeviceData = (_id: string, p: any) => datas.push(p);
    const fplus: any = { MQTT: { basic_sparkplug_node: async () => client } };
    const sp = new SparkplugNode(fplus, {
        address: { group: "G", node: "N", toString: () => "G/N" },
        uuid: "11111111-1111-4111-8111-111111111111",
    } as any);
    await sp.init();
    sp.isOnline = true;
    return { sp, datas };
}

const idle_conn = () => ({ stopSubscription: (_d: string, cb: Function) => cb() }) as any;

/* Publish one value through a device of the given format, and return
 * the metric as it went into the DDATA. */
async function publish (type: string, format: string, obj: any, parseVals: boolean) {
    const { sp, datas } = await node();
    const dev = new Device(sp, idle_conn(), {
        deviceId: "D", pollInt: 1e9, pubInterval: 0, templates: [],
        payloadFormat: format,
        metrics: [{ name: "blob", type, value: null, properties: {
            method:  { type: "String", value: "GET" },
            address: { type: "String", value: ADDR },
            path:    { type: "String", value: "" },
        } }],
    } as any);
    dev._deviceConnected();
    await new Promise(r => setImmediate(r));
    dev._handleData(obj, parseVals);
    await new Promise(r => setImmediate(r));
    dev.stop();
    const ms = datas.flatMap(d => d.metrics);
    expect(ms).toHaveLength(1);
    return { value: show(ms[0].value), isNull: !!ms[0].isNull };
}

beforeAll(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterAll(() => jest.restoreAllMocks());

describe("an OPC UA ByteString", () => {
    const packet = Buffer.from(JSON.stringify({
        value: { type: "Buffer", data: BYTES }, timestamp: RECEIVED_MS }));

    test.each(Object.keys(BUILT_IN))("%s: the built-in route publishes the recorded value", async (type) => {
        const got = await publish(type, "Defined by Protocol",
            { [ADDR]: Buffer.from(BYTES) }, false);
        expect(got).toEqual(BUILT_IN[type]);
    });

    test.each(Object.keys(BUILT_IN))("%s: the split driver's packet publishes the same", async (type) => {
        const got = await publish(type, "JSON", { [ADDR]: packet }, true);
        expect(got).toEqual(BUILT_IN[type]);
    });
});

/* Only the exact shape JSON.stringify gives a Buffer is revived. Other
 * objects a driver sends as a value, such as a BACnet value with a
 * numeric type, pass through unchanged. */
describe("a no-path value that is not a Buffer", () => {
    test.each([
        { type: 2, value: 5 },
        { type: "buffer", data: [1, 2] },
        { type: "Foo", data: [1, 2] },
        { data: [1, 2] },
    ])("%j is published as it was", async (v) => {
        const packet = Buffer.from(JSON.stringify({ value: v, timestamp: RECEIVED_MS }));
        const got = await publish("Double", "JSON", { [ADDR]: packet }, true);
        expect(got).toEqual({ value: v, isNull: false });
    });
});
