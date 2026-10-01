/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

/* reHashConf shares one properties object between metrics with
 * identical properties. These tests check that sharing changes nothing
 * a reader can see, and that nothing writes to a shared object. The
 * shared objects are deep-frozen and the load, DBIRTH and data paths
 * run on them. Modules are strict, so a write to a frozen object
 * throws. */

import { EventEmitter } from "events";
import util from "util";
import { reHashConf } from "../../utils/FormatConfig";
import { Device } from "../../lib/device";
import { SparkplugNode } from "../../lib/sparkplugNode";
import { serialisationType, sparkplugDataType } from "../../lib/helpers/typeHandler";

const sp = require("sparkplug-payload").get("spBv1.0");

function tags () {
    const base = {
        method: "GET", address: "a", path: "p", engUnit: "C",
        engLow: 0, engHigh: 100, deadBand: "1", tooltip: "t", docs: "d",
        recordToDB: true,
    };
    return [
        { ...base, Name: "one", type: "Int16" },
        { ...base, Name: "two", type: "Int16BE", address: "b" },
        { ...base, Name: "three", type: "FloatLE", address: "b", path: "q" },
        { ...base, Name: "four", type: "Int16", address: "a" },
        { ...base, Name: "neg-low", type: "Int16", address: "c", engLow: -0 },
        { ...base, Name: "neg-high", type: "Int16", address: "d", engHigh: -0 },
        { ...base, Name: "neg-both", type: "Int16", address: "e", engLow: -0, engHigh: -0 },
        { ...base, Name: "pos-zero", type: "Int16", address: "f", engLow: 0 },
        { ...base, Name: "bare", type: "Int16", method: undefined, address: undefined },
        { Name: "empty", type: "Boolean" },
    ];
}

function config () {
    return {
        deviceConnections: [{
            name: "c", pollInt: 100, payloadFormat: serialisationType.JSON,
            delimiter: "",
            devices: [
                { deviceId: "d1", tags: tags() },
                { deviceId: "d2", tags: tags(), recordToHistorian: false },
            ],
        }],
    };
}

/* The properties object as built before sharing: fresh for each metric. */
function fresh_properties (tag: any, endianness: number | null) {
    return {
        method: { value: tag.method, type: sparkplugDataType.string },
        address: { value: tag.address, type: sparkplugDataType.string },
        path: { value: tag.path, type: sparkplugDataType.string },
        engUnit: { value: tag.engUnit, type: sparkplugDataType.string },
        engLow: { value: tag.engLow, type: sparkplugDataType.float },
        engHigh: { value: tag.engHigh, type: sparkplugDataType.float },
        deadband: { value: tag.deadBand, type: sparkplugDataType.string },
        tooltip: { value: tag.tooltip, type: sparkplugDataType.string },
        documentation: { value: tag.docs, type: sparkplugDataType.string },
        endianness: { value: endianness, type: sparkplugDataType.uInt16 },
    };
}

function expected_metrics (suppress: boolean) {
    return tags().map((tag: any) => ({
        name: tag.Name,
        value: tag.value,
        type: tag.type.replace(/[BL]E/g, ""),
        isTransient: suppress || !tag.recordToDB,
        properties: fresh_properties(tag,
            tag.type.endsWith("BE") ? 4321
                : tag.type.endsWith("LE") ? 1234 : null),
    }));
}

function deep_freeze (o: any, seen = new Set()) {
    if (o === null || typeof o != "object" || seen.has(o)) return o;
    seen.add(o);
    Object.values(o).forEach(v => deep_freeze(v, seen));
    return Object.freeze(o);
}

function encode (metrics: any[]) {
    return Buffer.from(sp.encodePayload({
        timestamp: 1,
        metrics: metrics.map((m, i) => ({
            name: m.name, type: m.type, value: m.value ?? null,
            timestamp: 1, alias: i, isTransient: m.isTransient,
            properties: m.properties,
        })),
    } as any));
}

describe("reHashConf property sharing", () => {
    test("output is deeply equal to unshared output", () => {
        const conf = reHashConf(config());
        const devs = conf.deviceConnections[0].devices;
        expect(devs[0].tags).toBeUndefined();
        expect(util.isDeepStrictEqual(devs[0].metrics, expected_metrics(false)))
            .toBe(true);
        expect(util.isDeepStrictEqual(devs[1].metrics, expected_metrics(true)))
            .toBe(true);
    });

    test("encoded metrics are byte-identical to unshared output", () => {
        const devs = reHashConf(config()).deviceConnections[0].devices;
        expect(encode(devs[0].metrics).equals(encode(expected_metrics(false))))
            .toBe(true);
        expect(encode(devs[1].metrics).equals(encode(expected_metrics(true))))
            .toBe(true);
    });

    test("identical property sets are one object", () => {
        const devs = reHashConf(config()).deviceConnections[0].devices;
        const [a, b] = [devs[0].metrics, devs[1].metrics];
        /* one and four have the same properties, in both devices */
        expect(a[0].properties).toBe(a[3].properties);
        expect(a[0].properties).toBe(b[0].properties);
        expect(a[0].properties).not.toBe(a[1].properties);
        expect(a[1].properties.address).toBe(a[2].properties.address);
        /* Metrics themselves are not shared */
        expect(a[0]).not.toBe(b[0]);
    });

    test("negative zero is never shared with positive zero", () => {
        const m = reHashConf(config()).deviceConnections[0].devices[0].metrics;
        const by = (n: string) => m.find((x: any) => x.name == n).properties;
        expect(Object.is(by("neg-low").engLow.value, -0)).toBe(true);
        expect(Object.is(by("neg-high").engHigh.value, -0)).toBe(true);
        expect(Object.is(by("neg-both").engLow.value, -0)).toBe(true);
        expect(Object.is(by("neg-both").engHigh.value, -0)).toBe(true);
        expect(Object.is(by("pos-zero").engLow.value, 0)).toBe(true);
        expect(Object.is(by("one").engLow.value, 0)).toBe(true);
        /* Different property sets do not collapse into each other */
        expect(by("neg-low")).not.toBe(by("neg-high"));
        expect(by("neg-low")).not.toBe(by("neg-both"));
        expect(by("neg-low")).not.toBe(by("one"));
        expect(by("neg-high").engLow.value).toBe(0);
        expect(Object.is(by("neg-low").engHigh.value, -0)).toBe(false);
    });

    test("object values are shared only by identity", () => {
        const shared = { x: 1 };
        const conf = config();
        conf.deviceConnections[0].devices[0].tags.push(
            { ...tags()[0], Name: "o1", tooltip: shared } as any,
            { ...tags()[0], Name: "o2", tooltip: shared } as any,
            { ...tags()[0], Name: "o3", tooltip: { x: 1 } } as any);
        const m = reHashConf(conf).deviceConnections[0].devices[0].metrics;
        const by = (n: string) => m.find((x: any) => x.name == n).properties;
        expect(by("o1")).toBe(by("o2"));
        expect(by("o1")).not.toBe(by("o3"));
        expect(by("o3").tooltip.value).toEqual({ x: 1 });
    });

    test("separate calls share nothing", () => {
        const a = reHashConf(config()).deviceConnections[0].devices[0].metrics;
        const b = reHashConf(config()).deviceConnections[0].devices[0].metrics;
        expect(a[0].properties).not.toBe(b[0].properties);
    });
});

describe("shared property sets are never written", () => {
    class Conn extends EventEmitter {
        _type = "stub";
        startSubscription () {}
        readMetrics () {}
        writeMetrics () {}
        stopSubscription () {}
    }

    function stub_node () {
        const births: any[] = [];
        const datas: any[] = [];
        const client: any = new EventEmitter();
        client.connect = () => {};
        client.publishDeviceDeath = () => {};
        client.publishDeviceBirth = (id: string, p: any) => births.push([id, p]);
        client.publishDeviceData = (id: string, p: any) => datas.push([id, p]);
        const fplus: any = { MQTT: { basic_sparkplug_node: async () => client } };
        const node = new SparkplugNode(fplus, {
            address: { group: "G", node: "N", toString: () => "G/N" },
            uuid: "11111111-1111-4111-8111-111111111111",
        } as any);
        return { node, births, datas };
    }

    test("load, DBIRTH and data run on frozen shared properties", async () => {
        /* Load */
        const conf = reHashConf(config());
        const devs = conf.deviceConnections[0].devices;
        const shared = new Set(devs.flatMap((d: any) =>
            d.metrics.map((m: any) => m.properties)));
        expect(shared.size).toBeLessThan(devs[0].metrics.length * 2);
        shared.forEach(p => deep_freeze(p));
        expect([...shared].every(p => Object.isFrozen(p))).toBe(true);
        /* A write really does throw in this file */
        expect(() => { (devs[0].metrics[0].properties as any).method = 1; })
            .toThrow(TypeError);

        const { node, births, datas } = stub_node();
        await node.init();
        node.isOnline = true;

        /* The metrics are the ones Translator hands to Device */
        const device = new Device(node, new Conn() as any, {
            deviceId: "d1",
            pollInt: 100,
            pubInterval: 0,
            templates: [],
            metrics: devs[0].metrics,
            payloadFormat: serialisationType.JSON,
        });

        /* DBIRTH */
        device._deviceConnected();
        await new Promise(r => setImmediate(r));
        expect(births.length).toBe(1);
        const birth = births[0][1];
        expect(birth.metrics.length).toBeGreaterThan(devs[0].metrics.length);
        expect(() => encode(birth.metrics.map((m: any) => ({
            ...m, value: m.value ?? null })))).not.toThrow();

        /* Data, plain and with simulated-data markers (which copy
         * the properties) */
        device._handleData({ a: 5 }, false);
        device._handleData({
            b: JSON.stringify({ value: 7, simulated: true, run_id: "r" }),
        }, true);
        device._handleData({ a: 6 }, false);
        await new Promise(r => setImmediate(r));
        expect(datas.length).toBeGreaterThan(0);
        datas.forEach(([, p]) => expect(() => sp.encodePayload(p)).not.toThrow());

        /* Still intact afterwards */
        expect(util.isDeepStrictEqual(devs[0].metrics.slice(0, 10).map(
            (m: any) => m.properties),
            expected_metrics(false).map((m: any) => m.properties))).toBe(true);
        /* Let the device's ready timer fire and stop itself */
        await new Promise(r => setTimeout(r, 150));
    });
});
