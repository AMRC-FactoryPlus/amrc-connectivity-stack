/*
 * ACS Data Access Service
 * Unit tests for the UNS device dataset kinds: creating them, and
 * the store each resolved source carries.
 *
 * These run against fakes, so they need no cluster and no InfluxDB.
 */

import { Map as IMap, Set as ISet } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { DataFlow } from "../../lib/dataflow.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";
import {
    App, DEVICE, OTHER_DEVICE, NODE, UNPLACED, CREATED, AXIS,
    UNS_DS, UNS_SUB, SESSION, FROM, TO, DATASETS, debug,
    make_api, make_res, create,
} from "../uns_fixtures.js";

/*
 * ---------------------------------------------------------------
 * Creating datasets
 * ---------------------------------------------------------------
 */

describe("creating device datasets", () => {
    test.each([
        ["Sparkplug source", App.SparkplugSrc, { source: DEVICE }],
        ["Sub-device", App.SparkplugSubset,
            { source: DEVICE, metrics: [{ instance: DEVICE, metric: "Switch_Closed" }] }],
    ])("a new %s is refused with structure_retired", async (_, structure, config) => {
        const { api, calls } = make_api();
        const res = await create(api, structure, config);

        expect(res.code).toBe(422);
        expect(res.body).toEqual({
            error: "structure_retired",
            message: expect.any(String),
            use: [App.UNSDevice, App.UNSDeviceMetrics],
        });
        /* Refused straight after parsing: nothing is checked or written. */
        expect(calls.acl).toEqual([]);
        expect(calls.created).toEqual([]);
        expect(calls.put).toEqual([]);
    });

    /* A placed device has a default dataset, so nobody makes another. */
    test("a UNS device over a placed device is refused, naming the default dataset", async () => {
        const { api, calls } = make_api();
        const res = await create(api, App.UNSDevice, { source: DEVICE });

        expect(res.code).toBe(409);
        expect(res.body.error).toBe("use_default_dataset");
        expect(res.body.device).toBe(DEVICE);
        expect(res.body.dataset).toBe(default_dataset_uuid(DEVICE));
        expect(calls.created).toEqual([]);
        expect(calls.put).toEqual([]);
        expect(calls.acl).toContainEqual([Constants.Perm.UseDevice, DEVICE]);
    });

    test("UNS device metrics normalise path entries", async () => {
        const { api, calls } = make_api();
        const res = await create(api, App.UNSDeviceMetrics,
            { source: DEVICE, metrics: [{ path: "Axes/X/Position/Actual" }] });

        expect(res.code).toBe(200);
        expect(calls.put).toEqual([{ app: App.UNSDeviceMetrics, obj: CREATED, config: {
            source: DEVICE, metrics: [{ instance: AXIS, metric: "Position/Actual" }],
        }}]);
    });

    test.each([
        ["UNS device", App.UNSDevice, { source: NODE }],
        ["UNS device metrics", App.UNSDeviceMetrics,
            { source: NODE, metrics: [{ instance: NODE, metric: "Load" }] }],
    ])("a %s over something that is not a device is refused", async (_, structure, config) => {
        const { api, calls } = make_api();
        const res = await create(api, structure, config);

        expect(res.code).toBe(422);
        expect(res.body).toMatchObject({ error: "device_required", device: NODE });
        /* The device check comes first: no placement is read. */
        expect(calls.placements).toEqual([]);
        expect(calls.created).toEqual([]);
    });

    test.each([
        ["no placement", undefined],
        ["a placement with no node", {}],
    ])("a UNS device over a device with %s is refused", async (_, placement) => {
        const { api, calls } = make_api({ placements: { [UNPLACED]: placement } });
        const res = await create(api, App.UNSDevice, { source: UNPLACED });

        expect(res.code).toBe(422);
        expect(res.body).toMatchObject({ error: "placement_required", device: UNPLACED });
        expect(calls.placements).toEqual([UNPLACED]);
        expect(calls.created).toEqual([]);
    });

    test("UNS device metrics over an unplaced device are refused", async () => {
        const { api } = make_api({ placements: {} });
        const res = await create(api, App.UNSDeviceMetrics,
            { source: DEVICE, metrics: [{ instance: DEVICE, metric: "Switch_Closed" }] });

        expect(res.code).toBe(422);
        expect(res.body.error).toBe("placement_required");
    });

    test("without UseDevice a caller learns nothing about the source", async () => {
        const { api, calls } = make_api({ allowed: false });

        await expect(create(api, App.UNSDevice, { source: NODE }))
            .rejects.toMatchObject({ status: 403 });
        expect(calls.members).toEqual([]);
        expect(calls.placements).toEqual([]);
    });

    test("a site with no UNS bucket answers uns_unavailable", async () => {
        const { api, calls } = make_api({ buckets: { sparkplug: "default" } });
        const res = await create(api, App.UNSDevice, { source: DEVICE });

        expect(res.code).toBe(503);
        expect(res.body.error).toBe("uns_unavailable");
        expect(calls.created).toEqual([]);
    });
});

describe("editing a UNS device dataset", () => {
    test("a new source must be a placed device too", async () => {
        const { api, calls } = make_api({ placements: {} });
        api.data.allowed_all_datasets = () => rx.of(IMap(DATASETS));
        const res = make_res();
        await api.structure_update({ params: { uuid: UNS_DS }, auth: "tester",
            body: { structure: App.UNSDevice, config: { source: DEVICE } } }, res);

        expect(res.code).toBe(422);
        expect(res.body.error).toBe("placement_required");
        expect(calls.put).toEqual([]);
    });
});

/*
 * ---------------------------------------------------------------
 * Resolution: a store on every source
 * ---------------------------------------------------------------
 */

describe("resolved sources carry their store", () => {
    test("a UNS device reads the uns store", async () => {
        const { api } = make_api();
        expect(await api.resolve_dataset(UNS_DS)).toEqual([{
            dataset_uuid: UNS_DS, device_uuid: OTHER_DEVICE, store: "uns",
            from: null, to: null,
        }]);
    });

    test("UNS device metrics keep device-relative metric paths", async () => {
        const { api } = make_api();
        expect(await api.resolve_dataset(UNS_SUB)).toEqual([{
            dataset_uuid: UNS_SUB, device_uuid: DEVICE, store: "uns",
            from: null, to: null,
            metrics: [
                { path: "Axes/X/Position", name: "Actual" },
                { path: null, name: "Switch_Closed" },
            ],
        }]);
    });

    test("a session over a union of both kinds passes each store through", async () => {
        const { api } = make_api();
        const sources = await api.resolve_dataset(SESSION);

        expect(sources.map(s => [s.device_uuid, s.store, s.from, s.to])).toEqual([
            [DEVICE, "sparkplug", FROM, TO],
            [OTHER_DEVICE, "uns", FROM, TO],
        ]);
    });

    test("the UNS handlers keep the device handlers' links and references", async () => {
        const { api } = make_api();
        for (const app of [App.UNSDevice, App.UNSDeviceMetrics]) {
            const handler = api.handlers[app];
            expect(handler.structure).toBe(app);
            expect(handler.sourcePermission).toBe(Constants.Perm.UseDevice);
            expect(handler.replaced_by).toBeNull();
            expect(handler.references({ source: DEVICE }, DEVICE)).toBe(false);
        }
    });

    test("the new kinds are structure apps, so an invalid dataset's rewrite clears them", () => {
        expect(Object.values(App)).toEqual(
            expect.arrayContaining([App.UNSDevice, App.UNSDeviceMetrics]));
    });
});

describe("DataFlow", () => {
    test("treats both UNS kinds as valid datasets", async () => {
        const configs = {
            [App.UNSDevice]: IMap([[UNS_DS, { source: OTHER_DEVICE }]]),
            [App.UNSDeviceMetrics]: IMap([[UNS_SUB, DATASETS[UNS_SUB].config]]),
        };
        const cdb = {
            watch_member_members: () => rx.of(IMap()),
            watch_members_subclasses: () => rx.of(IMap()),
            watch_members: () => rx.of(ISet(Object.keys(configs))),
            search_app: app => rx.of(configs[app] ?? IMap()),
        };
        const data = new DataFlow({ debug, cdb, auth: {} });

        const datasets = await rx.firstValueFrom(data.valid_datasets);
        expect(datasets.get(UNS_DS)).toMatchObject({
            structure: App.UNSDevice, from: null, to: null });
        expect(datasets.get(UNS_SUB)).toMatchObject({
            structure: App.UNSDeviceMetrics, from: null, to: null });
    });
});
