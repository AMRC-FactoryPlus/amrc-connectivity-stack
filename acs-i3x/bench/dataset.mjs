/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Deterministic synthetic fleet for the bulk-value benchmark and the
 * InfluxDB equivalence test.
 *
 * The shape copies a real device class on the dev cluster (a traffic
 * signal with Address, Cyber_Profile, Device_Information/ISA95_Hierarchy
 * and Location sub-objects) and the tag schema that historian-sparkplug
 * writes (historian-sparkplug/lib/mqttclient.ts, writeToInfluxDB).
 *
 * Edge cases seen on the dev cluster, or needed for equivalence, are
 * spread across the fleet by device index:
 *   i % 5  == 1  renamed device: every series exists twice, with
 *                `device` = "Traffic Signal i" and "Traffic_Signal_i".
 *                The second copy is newer and holds different values.
 *                (390 of 2,120 dev devices look like this.)
 *   i % 10 == 3  extra top-level leaf "Model" with no path, whose
 *                measurement also exists under Device_Information.
 *   i % 20 == 9  static values written only 20 to 26 days ago, so the
 *                30-day window spans several shard groups.
 *   i % 25 == 11 extra simulated series (simulated/run_id tags).
 *   i % 50 == 7  in config, no data at all.
 *   i % 50 == 8  data only 45 days old (outside range(start: -30d)).
 */

import { v5 as uuidv5 } from "uuid";

const NS = "6f1c2c6e-4a1d-4f55-9a57-3b8a0f7d2b10";
const HIERARCHY_SCHEMA_UUID = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEVICE_INFO_SCHEMA = "2dd093e9-1450-44c5-be8c-c0d78e48219b";

export const GROUP = "AMRC-Central";
export const NODE = "Bristol";

const id = (name) => uuidv5(name, NS);
const SCHEMA = {
    top: id("schema:TrafficSignal"),
    Address: id("schema:Address"),
    Cyber_Profile: id("schema:Cyber_Profile"),
    Device_Information: DEVICE_INFO_SCHEMA,
    ISA95_Hierarchy: HIERARCHY_SCHEMA_UUID,
    Location: id("schema:Location"),
    Status: id("schema:Status"),
};

/* [name, sparkplugType, kind] - kind is "static" or "live". */
const TOP = [
    ["Asset_Type", "String", "static"],
    ["Controlled_Crossings", "UInt16", "static"],
    ["Owner", "String", "static"],
    ["Pedestrian_Crossing_Type", "String", "static"],
    ["SCOOT_Nodes", "String", "static"],
    ["Site_ID", "String", "static"],
    ["Site_Type", "String", "static"],
    ["Source_ID", "String", "static"],
];
const SUBS = {
    /* "Address" is in ObjectTree.METADATA_KEYS, so these are written
     * to InfluxDB but never become i3X objects - as on the cluster. */
    Address: [
        ["Easting", "Double", "static"],
        ["Local_Authority", "String", "static"],
        ["Location_Description", "String", "static"],
        ["Northing", "Double", "static"],
    ],
    Cyber_Profile: [
        ["CPE", "String", "static"],
        ["Last_Patched", "String", "static"],
        ["Network_Connected", "Boolean", "live"],
        ["Remotely_Managed", "Boolean", "static"],
    ],
    Device_Information: [
        ["Friendly_Name", "String", "static"],
        ["Manufacturer", "String", "static"],
        ["Model", "String", "static"],
        ["Software_Version", "String", "static"],
    ],
    Location: [
        ["Altitude", "Double", "static"],
        ["Latitude", "Double", "static"],
        ["Longitude", "Double", "static"],
        ["Mast_Height", "Double", "static"],
    ],
    Status: [
        ["Fault_Count", "Int32", "live"],
        ["Lamp_Current", "Double", "live"],
        ["Temperature", "Double", "live"],
        ["Uptime", "UInt32", "live"],
    ],
};
const ISA95 = [["Enterprise", "AMRC"], ["Site", "Bristol"], ["Area", "Central"], ["Work Center", "Signals"]];

const SUFFIX = {
    Int8: "i", Int16: "i", Int32: "i", Int64: "i",
    UInt8: "u", UInt16: "u", UInt32: "u", UInt64: "u",
    Float: "d", Double: "d", Boolean: "b",
};
const suffix = (t) => SUFFIX[t] ?? "s";

/* Sparkplug_Type as written in the originMap. Doubles are given as
 * "DoubleLE" because ObjectTree's sparkplugTypeToSuffix strips a
 * trailing /(LE|BE)$/i, which turns a plain "Double" into "Doub" and
 * the ":s" measurement (a separate, pre-existing bug). */
const configType = (t) => (t === "Double" ? "DoubleLE" : t);

export function deviceUuid(i) { return id(`device:${i}`); }

/** Deterministic pseudo-random value for (device, metric, point). */
function hash(s) {
    let h = 2166136261;
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
    return h >>> 0;
}
function valueFor(type, seed) {
    const h = hash(seed);
    switch (suffix(type)) {
        case "i": return h % 1000 - 500;
        case "u": return h % 100000;
        case "d": return (h % 1000000) / 1000;
        case "b": return h % 2 === 0;
        default: return `v-${h.toString(36)}`;
    }
}

/**
 * Describe device i: its ConfigDB DeviceInformation originMap, its
 * Info name, and the series historian-sparkplug would have written.
 */
export function device(i) {
    const uuid = deviceUuid(i);
    const name = `Traffic Signal ${i}`;
    const inst = (sub) => id(`inst:${i}:${sub}`);

    const originMap = { Schema_UUID: SCHEMA.top, Instance_UUID: uuid };
    const series = []; // { measurement, path, type, kind, bottom }

    const top = [...TOP];
    if (i % 10 === 3) top.push(["Model", "String", "static"]);
    for (const [m, t, kind] of top) {
        originMap[m] = { Sparkplug_Type: configType(t) };
        series.push({ measurement: `${m}:${suffix(t)}`, path: "", type: t, kind });
    }
    series.push({ measurement: "Instance_UUID:s", path: "", type: "String", kind: "static" });
    series.push({ measurement: "Schema_UUID:s", path: "", type: "String", kind: "static" });

    for (const [sub, metrics] of Object.entries(SUBS)) {
        const obj = { Schema_UUID: SCHEMA[sub], Instance_UUID: inst(sub) };
        for (const [m, t, kind] of metrics) {
            obj[m] = { Sparkplug_Type: configType(t) };
            series.push({ measurement: `${m}:${suffix(t)}`, path: sub, type: t, kind });
        }
        series.push({ measurement: "Instance_UUID:s", path: sub, type: "String", kind: "static" });
        series.push({ measurement: "Schema_UUID:s", path: sub, type: "String", kind: "static" });
        originMap[sub] = obj;
    }

    const hier = { Schema_UUID: HIERARCHY_SCHEMA_UUID, Instance_UUID: inst("ISA95") };
    for (const [level, value] of ISA95) {
        hier[level] = { Value: value, Sparkplug_Type: "String" };
        series.push({
            measurement: `${level}:s`, path: "Device_Information/ISA95_Hierarchy",
            type: "String", kind: "static", bottom: inst("ISA95"),
        });
    }
    originMap.Device_Information.ISA95_Hierarchy = hier;

    return {
        i, uuid, name, originMap,
        info: { name },
        series,
        renamed: i % 5 === 1,
        oldOnly: i % 20 === 9,
        simulated: i % 25 === 11,
        noData: i % 50 === 7,
        outsideWindow: i % 50 === 8,
    };
}

/** PipelineSnapshot input for ObjectTree.refreshFromSnapshot(). */
export function pipelineSnapshot(n) {
    const devices = new Map();
    for (let i = 0; i < n; i++) {
        const d = device(i);
        devices.set(d.uuid, { devInfo: { schema: SCHEMA.top, sparkplugName: d.name, originMap: d.originMap }, info: d.info });
    }
    const schemas = new Map(Object.values(SCHEMA).map((s) => [s, { schema: null, info: { name: s } }]));
    return { devices, schemas };
}

/* ---- Line protocol ---- */

const escMeasurement = (s) => s.replace(/[, ]/g, (c) => `\\${c}`);
const escTag = (s) => s.replace(/[,= ]/g, (c) => `\\${c}`);
const escStr = (s) => s.replace(/["\\]/g, (c) => `\\${c}`);

function field(type, v) {
    switch (suffix(type)) {
        case "i": return `${v}i`;
        case "u": return `${v}u`;
        case "d": return Number.isInteger(v) ? `${v}.0` : String(v);
        case "b": return v ? "true" : "false";
        default: return `"${escStr(String(v))}"`;
    }
}

/**
 * Line-protocol lines for device i. `now` is ms since epoch; `points`
 * is points per series. Timestamps are ms precision.
 */
export function* lines(i, now, points) {
    const d = device(i);
    if (d.noData) return;
    const DAY = 86_400_000;

    const variants = [{ dev: d.name, extra: "", tag: "a", shift: 0 }];
    if (d.renamed) variants.push({ dev: d.name.replace(/ /g, "_"), extra: "", tag: "b", shift: 2 * 3600_000 });
    if (d.simulated) variants.push({ dev: d.name, extra: ",run_id=r1,simulated=true", tag: "sim", shift: -3600_000 });

    for (const s of d.series) {
        const bottom = s.bottom ? `,bottomLevelInstance=${s.bottom}` : "";
        const path = s.path ? `,path=${escTag(s.path)}` : "";
        const usesInst = `${d.uuid}:${s.path ? id(`inst:${i}:${s.path.split("/")[0]}`) : d.uuid}`;
        for (const v of variants) {
            const tags = `${bottom},device=${escTag(v.dev)},group=${escTag(GROUP)},node=${escTag(NODE)}${path}${v.extra}`
                + `,topLevelInstance=${d.uuid},topLevelSchema=${SCHEMA.top},usesInstances=${usesInst},usesSchemas=${SCHEMA.top}`;
            const head = `${escMeasurement(s.measurement)}${tags}`;
            for (let p = 0; p < points; p++) {
                let t;
                if (d.outsideWindow) t = now - 45 * DAY - p * 60_000;
                else if (d.oldOnly && s.kind === "static") t = now - 20 * DAY - p * (6 * DAY / points);
                else if (s.kind === "live") t = now - p * (3 * DAY / points) + v.shift;
                else t = now - 10 * 60_000 - p * (7 * DAY / points) + v.shift;
                if (t > now) t = now - 1000;
                const val = valueFor(s.type, `${i}|${s.measurement}|${s.path}|${v.tag}|${s.kind === "live" ? p : 0}`);
                yield `${head} value=${field(s.type, val)} ${Math.round(t)}`;
            }
        }
    }
}
