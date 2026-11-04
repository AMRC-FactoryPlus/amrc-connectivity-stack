/*
 * ACS Data Access Service
 * Unit tests for GET /v1/metadata/:uuid/contents.
 *
 * Read access to a dataset includes seeing which devices and metrics a
 * download of it reads. These run against fakes, so they need no
 * cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";

const DEV_A = "55555555-5555-5555-5555-555555555555";
const DEV_B = "44444444-4444-4444-4444-444444444444";
const CHARS = "1e74e2b2-44a3-44ff-8b2c-8c14a5f15c0b";

const WHOLE_A = "11111111-1111-1111-1111-111111111111";
const SUB_A = "22222222-2222-2222-2222-222222222222";
const SUB_B = "33333333-3333-3333-3333-333333333333";
const UNION = "66666666-6666-6666-6666-666666666666";
const DUP_UNION = "77777777-7777-7777-7777-777777777777";
const SUB_UNION = "88888888-8888-4888-8888-888888888888";
const SESSION = "99999999-9999-4999-8999-999999999999";
const INVALID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNS_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNS_SUB_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIXED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const FROM = "2026-01-01T00:00:00.000Z";
const TO = "2026-02-01T00:00:00.000Z";

const ORIGIN_A = {
    Schema_UUID: "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49",
    Instance_UUID: DEV_A,
    Switch_Closed: { Sparkplug_Type: "Boolean", Record_To_Historian: true },
    Characteristics: {
        Instance_UUID: CHARS,
        Current_AC: {
            Sparkplug_Type: "FloatLE",
            Record_To_Historian: true,
            Eng_Unit: "A",
            Documentation: "True RMS current",
        },
        Voltage: { Sparkplug_Type: "FloatLE", Record_To_Historian: true, Eng_Unit: "V" },
        Debug: { Sparkplug_Type: "String", Record_To_Historian: false },
    },
};

const ORIGIN_B = {
    Instance_UUID: DEV_B,
    Temperature: { Sparkplug_Type: "Double", Record_To_Historian: true, Eng_Unit: "degC" },
    Pressure: { Sparkplug_Type: "Double", Record_To_Historian: true, Eng_Unit: "bar" },
};

const App = Constants.App;

/* Shaped like DataFlow's dataset map: structure, config, and the time
 * bounds DataFlow derives. */
const DATASETS = {
    [WHOLE_A]: { structure: App.SparkplugSrc, config: { source: DEV_A }, from: null, to: null },
    [SUB_A]: { structure: App.SparkplugSubset, from: null, to: null, config: {
        source: DEV_A,
        metrics: [{ instance: CHARS, metric: "Current_AC" }],
    }},
    [SUB_B]: { structure: App.SparkplugSubset, from: null, to: null, config: {
        source: DEV_B,
        metrics: [{ instance: DEV_B, metric: "Pressure" }],
    }},
    [UNION]: { structure: App.UnionComponents, config: [WHOLE_A, SUB_B], from: null, to: null },
    [DUP_UNION]: { structure: App.UnionComponents, config: [SUB_A, WHOLE_A], from: null, to: null },
    [SESSION]: { structure: App.SessionLimits, from: FROM, to: TO,
        config: { source: UNION, from: FROM, to: TO } },
    [SUB_UNION]: { structure: App.UnionComponents, config: [SUB_A, SUB_A], from: null, to: null },
    [INVALID]: { structure: Constants.Special.InvalidDataset, config: null, from: null, to: null },
    [UNS_A]: { structure: App.UNSDevice, config: { source: DEV_A }, from: null, to: null },
    [UNS_SUB_B]: { structure: App.UNSDeviceMetrics, from: null, to: null, config: {
        source: DEV_B,
        metrics: [{ instance: DEV_B, metric: "Pressure" }],
    }},
    /* Device A through both stores, and device B through the UNS. */
    [MIXED]: { structure: App.UnionComponents, config: [WHOLE_A, UNS_A, UNS_SUB_B], from: null, to: null },
};

const INFOS = IMap({
    [DEV_A]: { name: "Press_1" },
    [DEV_B]: { name: "Oven_2" },
});

/* Builds an APIv1 wired to fakes. `allowed` is the set of datasets the
 * caller holds READ_DATASET on. Every ACL check is recorded. */
function make_api ({ allowed = Object.keys(DATASETS) } = {}) {
    const acl_checks = [];
    const all = IMap(DATASETS);
    const valid = all.filter(d => d.structure != Constants.Special.InvalidDataset);

    const api = new APIv1({
        data: {
            datasets: rx.of(all),
            allowed_valid_datasets: () =>
                rx.of(valid.filter((_, id) => allowed.includes(id))),
            general_infos: rx.of(INFOS),
        },
        auth: {
            async check_acl (principal, perm, target) {
                acl_checks.push([perm, target]);
                return perm == Constants.Perm.ReadDataset && allowed.includes(target);
            },
        },
        cdb: {
            async get_config (app, obj) {
                if (app != UUIDs.App.DeviceInformation) return undefined;
                if (obj == DEV_A) return { originMap: ORIGIN_A };
                if (obj == DEV_B) return { originMap: ORIGIN_B };
                return undefined;
            },
        },
        debug: { bound: () => () => {} },
        influxReader: {},
    });

    return { api, acl_checks };
}

function make_res () {
    return {
        code: null,
        body: null,
        status (code) { this.code = code; return this; },
        json (body) { this.body = body; return this; },
    };
}

async function contents (uuid, opts) {
    const { api, acl_checks } = make_api(opts);
    const res = make_res();
    await api.metadata_contents({ params: { uuid }, auth: "tester" }, res);
    return { res, acl_checks };
}

const paths = device => device.metrics.map(m => m.path);

describe("GET /metadata/:uuid/contents", () => {
    test("a Sparkplug source lists every metric recorded to the historian", async () => {
        const { res } = await contents(WHOLE_A);

        expect(res.code).toBe(200);
        expect(res.body).toEqual({
            uuid: WHOLE_A,
            from: undefined,
            to: undefined,
            devices: [{
                uuid: DEV_A,
                name: "Press_1",
                store: "sparkplug",
                metrics: [
                    {
                        instance: DEV_A, metric: "Switch_Closed", path: "Switch_Closed",
                        type: "Boolean", unit: undefined, documentation: undefined,
                    },
                    {
                        instance: CHARS, metric: "Current_AC", path: "Characteristics/Current_AC",
                        type: "FloatLE", unit: "A", documentation: "True RMS current",
                    },
                    {
                        instance: CHARS, metric: "Voltage", path: "Characteristics/Voltage",
                        type: "FloatLE", unit: "V", documentation: undefined,
                    },
                ],
            }],
        });
    });

    test("a Sub-device lists only its selected metrics", async () => {
        const { res } = await contents(SUB_A);

        expect(res.body.devices).toEqual([{
            uuid: DEV_A,
            name: "Press_1",
            store: "sparkplug",
            metrics: [{
                instance: CHARS, metric: "Current_AC", path: "Characteristics/Current_AC",
                type: "FloatLE", unit: "A", documentation: "True RMS current",
            }],
        }]);
    });

    test("a UNS device lists every metric recorded to the historian, from the UNS", async () => {
        const { res } = await contents(UNS_A);

        expect(res.body.devices).toHaveLength(1);
        expect(res.body.devices[0]).toMatchObject({ uuid: DEV_A, name: "Press_1", store: "uns" });
        expect(paths(res.body.devices[0])).toEqual([
            "Switch_Closed", "Characteristics/Current_AC", "Characteristics/Voltage",
        ]);
    });

    test("UNS device metrics list their selected metrics with device-relative paths", async () => {
        const { res } = await contents(UNS_SUB_B);

        expect(res.body.devices.map(d => [d.uuid, d.store])).toEqual([[DEV_B, "uns"]]);
        expect(paths(res.body.devices[0])).toEqual(["Pressure"]);
    });

    test("a device reached through both stores appears once per store", async () => {
        const { res } = await contents(MIXED);

        expect(res.body.devices.map(d => [d.uuid, d.store])).toEqual([
            [DEV_A, "sparkplug"],
            [DEV_A, "uns"],
            [DEV_B, "uns"],
        ]);
        expect(paths(res.body.devices[1])).toEqual([
            "Switch_Closed", "Characteristics/Current_AC", "Characteristics/Voltage",
        ]);
    });

    test("a Union lists each component's device", async () => {
        const { res } = await contents(UNION);

        expect(res.body.devices.map(d => [d.uuid, d.name])).toEqual([
            [DEV_A, "Press_1"],
            [DEV_B, "Oven_2"],
        ]);
        expect(paths(res.body.devices[0])).toEqual([
            "Switch_Closed", "Characteristics/Current_AC", "Characteristics/Voltage",
        ]);
        expect(paths(res.body.devices[1])).toEqual(["Pressure"]);
    });

    test("a Session over a Union lists its source's devices, with its bounds", async () => {
        const { res } = await contents(SESSION);

        expect(res.body.uuid).toBe(SESSION);
        expect(res.body.from).toBe(FROM);
        expect(res.body.to).toBe(TO);
        expect(res.body.devices.map(d => d.uuid)).toEqual([DEV_A, DEV_B]);
        expect(paths(res.body.devices[1])).toEqual(["Pressure"]);
    });

    test("a device reached twice appears once, and a Sparkplug source covers all its metrics", async () => {
        const { res } = await contents(DUP_UNION);

        expect(res.body.devices).toHaveLength(1);
        expect(paths(res.body.devices[0])).toEqual([
            "Switch_Closed", "Characteristics/Current_AC", "Characteristics/Voltage",
        ]);
    });

    test("a device reached twice through Sub-devices lists each metric once", async () => {
        const { res } = await contents(SUB_UNION);

        expect(res.body.devices).toHaveLength(1);
        expect(paths(res.body.devices[0])).toEqual(["Characteristics/Current_AC"]);
    });

    test("needs only READ_DATASET on the dataset", async () => {
        const { res, acl_checks } = await contents(UNION, { allowed: [UNION] });

        expect(res.code).toBe(200);
        expect(acl_checks).toEqual([[Constants.Perm.ReadDataset, UNION]]);
    });

    test("refuses without READ_DATASET", async () => {
        await expect(contents(UNION, { allowed: [] }))
            .rejects.toMatchObject({ status: 403 });
    });

    test("an invalid dataset is not found", async () => {
        await expect(contents(INVALID))
            .rejects.toMatchObject({ status: 404 });
    });

    test("a dataset that does not exist is not found", async () => {
        await expect(contents(MISSING, { allowed: [MISSING] }))
            .rejects.toMatchObject({ status: 404 });
    });

    test("rejects an invalid UUID", async () => {
        await expect(contents("nope"))
            .rejects.toMatchObject({ status: 422 });
    });
});
