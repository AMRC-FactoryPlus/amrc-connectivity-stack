/*
 * ACS Data Access Service
 * Default datasets of deleted devices: kept, and marked in their metadata
 * Copyright 2026 University of Sheffield
 */

/* A device's default dataset outlives the device, so its history can
 * still be read. Its metadata says the device is gone, so clients can
 * leave it out of their lists. These run against fakes. */

import * as imm from "immutable";
import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { METADATA_FIELDS, metadata_entry } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow, orphaned_defaults } from "../../lib/dataflow.js";
import { metadata_body } from "../../lib/dataset-view.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";

const { App } = Constants;

const debug = { bound: () => () => {} };

const KEPT = "de71ce00-0000-4000-8000-000000000001";
const GONE = "de71ce00-0000-4000-8000-000000000002";
const KEPT_DS = default_dataset_uuid(KEPT);
const GONE_DS = default_dataset_uuid(GONE);
/* A UNS device dataset that is not its device's default one. */
const OTHER_DS = "da7a0000-0000-4000-8000-00000000000a";

const cleanup = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });

describe("orphaned_defaults", () => {
    test("lists the default datasets whose device is not a device", () => {
        const defaults = imm.Map([[KEPT_DS, KEPT], [GONE_DS, GONE]]);
        expect([...orphaned_defaults(defaults, imm.Set([KEPT]))])
            .toEqual([GONE_DS]);
        expect([...orphaned_defaults(defaults, imm.Set([KEPT, GONE]))])
            .toEqual([]);
    });

    test("counts no device as deleted while the devices are not known", () => {
        const defaults = imm.Map([[KEPT_DS, KEPT], [GONE_DS, GONE]]);
        expect(orphaned_defaults(defaults, null).size).toBe(0);
    });
});

/* A DataFlow over a site with two default datasets and one other UNS
 * device dataset. `devices` is fed by the test. */
function flow () {
    const devices = new rx.ReplaySubject(1);
    const configs = imm.Map([
        [KEPT_DS, { source: KEPT }],
        [GONE_DS, { source: GONE }],
        [OTHER_DS, { source: GONE }],
    ]);
    let device_watches = 0;
    const cdb = {
        watch_members: klass => {
            if (klass == UUIDs.Class.Device) {
                device_watches++;
                return devices;
            }
            return rx.of(imm.Set(
                klass == App.DatasetDefinition ? [App.UNSDevice] : []));
        },
        watch_member_members: () => rx.of(imm.Map()),
        watch_members_subclasses: () => rx.of(imm.Map()),
        search_app_changes: app => rx.of({
            map: app == App.UNSDevice ? configs : imm.Map(),
            child: null, previous: null,
        }),
    };
    const data = new DataFlow({ debug, cdb, auth: {} });
    const values = [];
    const sub = data.orphan_changes.subscribe(v => values.push(v));
    cleanup.push(() => sub.unsubscribe());
    return { data, devices, values, watches: () => device_watches };
}

describe("DataFlow.orphan_changes", () => {
    test("answers with no deleted device before ConfigDB lists the devices", () => {
        const { values } = flow();
        expect(values).toHaveLength(1);
        expect([...values[0].set]).toEqual([]);
        expect(values[0].changed).toBeNull();
    });

    test("marks the default dataset of a deleted device, and no other dataset", () => {
        const { devices, values } = flow();
        devices.next(imm.Set([KEPT, GONE]));
        /* Nothing changed. */
        expect(values).toHaveLength(1);

        devices.next(imm.Set([KEPT]));
        expect(values).toHaveLength(2);
        expect([...values[1].set]).toEqual([GONE_DS]);
        expect([...values[1].changed]).toEqual([GONE_DS]);
    });

    test("unmarks it if the device comes back", () => {
        const { devices, values } = flow();
        devices.next(imm.Set([KEPT]));
        devices.next(imm.Set([KEPT, GONE]));
        expect([...values.at(-1).set]).toEqual([]);
        expect([...values.at(-1).changed]).toEqual([GONE_DS]);
    });

    test("sends nothing when other devices come and go", () => {
        const { devices, values } = flow();
        devices.next(imm.Set([KEPT]));
        const before = values.length;
        devices.next(imm.Set([KEPT, "de71ce00-0000-4000-8000-0000000000ff"]));
        expect(values).toHaveLength(before);
    });

    test("watches the Device members once for every reader", () => {
        const { data, watches } = flow();
        const more = data.orphans.subscribe();
        cleanup.push(() => more.unsubscribe());
        expect(watches()).toBe(1);
    });
});

describe("the metadata of a default dataset of a deleted device", () => {
    const data = {
        valid: imm.Map([
            [KEPT_DS, { from: null, to: null }],
            [GONE_DS, { from: null, to: null }],
        ]),
        defaults: imm.Map([[KEPT_DS, KEPT], [GONE_DS, GONE]]),
    };
    const check = { ok: () => true };
    const orphans = { set: new Set([GONE_DS]), changed: null };

    test("a notify body says the device is deleted, after its parts", () => {
        const body = metadata_body({ data, check, orphans }, GONE_DS);
        expect(body.device_deleted).toBe(true);
        expect(Object.keys(body).at(-1)).toBe("device_deleted");
    });

    test("a notify body leaves it out for any other dataset", () => {
        const json = JSON.parse(JSON.stringify(
            metadata_body({ data, check, orphans }, KEPT_DS)));
        expect(json).not.toHaveProperty("device_deleted");
    });

    test("a notify body leaves it out while the deleted devices are not known", () => {
        const json = JSON.parse(JSON.stringify(
            metadata_body({ data, check }, GONE_DS)));
        expect(json).not.toHaveProperty("device_deleted");
    });

    test("an HTTP entry says so too, and include= can ask for it", () => {
        const maps = {
            infos: imm.Map(), functional: imm.Map(), metadata: imm.Map(),
            orphans: new Set([GONE_DS]),
        };
        expect(metadata_entry(GONE_DS, {}, maps).device_deleted).toBe(true);
        expect(JSON.parse(JSON.stringify(metadata_entry(KEPT_DS, {}, maps))))
            .not.toHaveProperty("device_deleted");
        expect(METADATA_FIELDS).toContain("device_deleted");
    });
});
