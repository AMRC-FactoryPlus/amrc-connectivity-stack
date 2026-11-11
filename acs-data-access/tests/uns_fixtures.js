/*
 * ACS Data Access Service
 * Shared fakes for the unit tests of the UNS device dataset kinds.
 *
 * Not a test file itself: vitest only collects *.test.js.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../lib/api-v1.js";
import { DataAccess as Constants } from "../lib/constants.js";

export const App = Constants.App;

export const DEVICE = "55555555-5555-5555-5555-555555555555";
export const OTHER_DEVICE = "44444444-4444-4444-4444-444444444444";
export const NODE = "66666666-6666-4666-8666-666666666666";
export const UNPLACED = "77777777-7777-4777-8777-777777777777";
export const CREATED = "88888888-8888-4888-8888-888888888888";
export const OWNER = "99999999-9999-4999-8999-999999999999";
export const AXIS = "a1a1a1a1-0000-4000-8000-000000000001";
export const PLACE = "c0c0c0c0-0000-4000-8000-000000000001";

export const OLD_DS = "10000000-0000-4000-8000-000000000001";
export const UNS_DS = "10000000-0000-4000-8000-000000000002";
export const UNS_SUB = "10000000-0000-4000-8000-000000000003";
export const MIXED = "10000000-0000-4000-8000-000000000004";
export const SESSION = "10000000-0000-4000-8000-000000000005";

export const FROM = "2026-01-01T00:00:00.000Z";
export const TO = "2026-01-02T00:00:00.000Z";

export const debug = { bound: () => () => {} };

export const ORIGIN_MAP = {
    Instance_UUID: DEVICE,
    Switch_Closed: { Sparkplug_Type: "Boolean", Record_To_Historian: true },
    Axes: {
        X: {
            Instance_UUID: AXIS,
            Position: {
                Actual: { Sparkplug_Type: "Double", Record_To_Historian: true },
            },
        },
    },
};

export const DATASETS = {
    [OLD_DS]: { structure: App.SparkplugSrc, config: { source: DEVICE } },
    [UNS_DS]: { structure: App.UNSDevice, config: { source: OTHER_DEVICE } },
    [UNS_SUB]: { structure: App.UNSDeviceMetrics, config: {
        source: DEVICE,
        metrics: [
            { instance: AXIS, metric: "Position/Actual" },
            { instance: DEVICE, metric: "Switch_Closed" },
        ],
    }},
    [MIXED]: { structure: App.UnionComponents, config: [OLD_DS, UNS_DS] },
    [SESSION]: { structure: App.SessionLimits,
        config: { source: MIXED, from: FROM, to: TO } },
};

/* Builds an APIv1 wired to fakes. DEVICE and OTHER_DEVICE are placed
 * devices; UNPLACED is a device with no placement; NODE is not a
 * device at all. Every ConfigDB read and write is recorded. */
export function make_api ({ allowed = true, buckets = { sparkplug: "default", uns: "uns" },
        placements = { [DEVICE]: { node: PLACE }, [OTHER_DEVICE]: { node: PLACE } } } = {}) {
    const calls = { acl: [], members: [], placements: [], created: [], put: [] };

    const api = new APIv1({
        data: {
            datasets: rx.of(IMap(DATASETS)),
            /* No index to wait for. */
            caught_up: async () => true,
        },
        auth: {
            root_principal: "root@EXAMPLE.ORG",
            async check_acl (principal, perm, target) {
                calls.acl.push([perm, target]);
                return allowed;
            },
            async resolve_principal () { return OWNER; },
        },
        cdb: {
            async class_has_member (klass, obj) {
                calls.members.push([klass, obj]);
                return klass == UUIDs.Class.Device && obj != NODE;
            },
            async get_config (app, obj) {
                if (app == Constants.External.ISA95Placement) {
                    calls.placements.push(obj);
                    return placements[obj];
                }
                if (app == UUIDs.App.DeviceInformation && obj == DEVICE)
                    return { originMap: ORIGIN_MAP };
                return undefined;
            },
            async create_object (klass) {
                calls.created.push(klass);
                return CREATED;
            },
            async put_config (app, obj, config) {
                calls.put.push({ app, obj, config });
            },
        },
        debug,
        influxReader: {},
        buckets,
    });

    return { api, calls };
}

export function make_res () {
    return {
        code: null,
        body: null,
        status (code) { this.code = code; return this; },
        json (body) { this.body = body; return this; },
    };
}

export async function create (api, structure, config) {
    const res = make_res();
    await api.structure_create({ body: { structure, config }, auth: "tester" }, res);
    return res;
}
