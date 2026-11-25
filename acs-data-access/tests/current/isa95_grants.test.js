/*
 * ACS Data Access Service
 * Unit tests: Build datasets from device, granted on an ISA-95 node
 * Copyright 2026 University of Sheffield
 */

/* A UseDevice grant on an ISA-95 node covers every device placed at or
 * under it, as Read i3X objects does in i3X. These tests run the real
 * DataFlow and APIv1 on a fake site, with DeviceAuth standing in for
 * Auth as it does in bin/api.js. */

import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DeviceAuth } from "../../lib/device-auth.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";
import {
    Isa95Hierarchy, NO_HIERARCHY, build_hierarchy,
} from "../../lib/isa95-hierarchy.js";
import { make_site } from "../support/fake-site.js";
import { STRUCTURE_APPS } from "../support/site-builder.js";

const { App, Class, External, Perm } = Constants;

const debug = { bound: () => () => {} };

const uuid = n => `15a95000-0aaa-4000-8000-${n.toString(16).padStart(12, "0")}`;

/* Enterprise > Site > Area, and a second Site. */
const ENTERPRISE = uuid(1);
const SITE = uuid(2);
const AREA = uuid(3);
const OTHER_SITE = uuid(4);

/* IN_AREA sits in the Area, ON_SITE on the Site itself, ELSEWHERE on
 * the other Site, and UNPLACED nowhere. */
const IN_AREA = uuid(0x10);
const ON_SITE = uuid(0x11);
const ELSEWHERE = uuid(0x12);
const UNPLACED = uuid(0x13);

const VOCABULARY = [
    [ENTERPRISE, { children: [SITE, OTHER_SITE] }],
    [SITE, { children: [AREA] }],
    [AREA, { children: [] }],
    [OTHER_SITE, {}],
];
const PLACEMENTS = [
    [IN_AREA, { node: AREA }],
    [ON_SITE, { node: SITE }],
    [ELSEWHERE, { node: OTHER_SITE }],
];

const SITE_USER = "site-user@EXAMPLE.ORG";
const AREA_USER = "area-user@EXAMPLE.ORG";
const READ_ON_SITE = "read-on-site@EXAMPLE.ORG";

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

describe("build_hierarchy", () => {
    const h = build_hierarchy(PLACEMENTS, VOCABULARY);

    test("lists a device's node and every node above it, nearest first", () => {
        expect(h.nodes_of(IN_AREA)).toEqual([AREA, SITE, ENTERPRISE]);
        expect(h.nodes_of(ON_SITE)).toEqual([SITE, ENTERPRISE]);
        expect(h.nodes_of(UNPLACED)).toEqual([]);
    });

    test("lists the devices at or under a node", () => {
        expect([...h.devices_under(SITE)].sort()).toEqual([IN_AREA, ON_SITE].sort());
        expect([...h.devices_under(AREA)]).toEqual([IN_AREA]);
        expect(h.devices_under(ENTERPRISE).size).toBe(3);
        expect(h.devices_under(uuid(0x99)).size).toBe(0);
    });

    test("survives a vocabulary with a loop", () => {
        const loop = build_hierarchy(
            [[IN_AREA, { node: AREA }]],
            [[AREA, { children: [SITE] }], [SITE, { children: [AREA] }]]);
        expect(loop.nodes_of(IN_AREA)).toEqual([AREA, SITE]);
    });

    test("covers nothing before ConfigDB answers", () => {
        expect(NO_HIERARCHY.nodes_of(IN_AREA)).toEqual([]);
        expect(NO_HIERARCHY.devices_under(SITE).size).toBe(0);
    });
});

function build () {
    const site = make_site();
    for (const app of STRUCTURE_APPS)
        site.add_member(App.DatasetDefinition, app);

    for (const [node, config] of VOCABULARY)
        site.put(External.ISA95Vocabulary, node, config);
    for (const [device, config] of PLACEMENTS)
        site.put(External.ISA95Placement, device, config);

    for (const device of [IN_AREA, ON_SITE, ELSEWHERE, UNPLACED]) {
        const dataset = default_dataset_uuid(device);
        site.put(App.UNSDevice, dataset, { source: device });
        site.add_member(Class.Dataset, dataset);
    }

    const grant = (permission, target) => ({ permission, target });
    site.set_acl(SITE_USER, [grant(Perm.UseDevice, SITE)]);
    site.set_acl(AREA_USER, [grant(Perm.UseDevice, AREA)]);
    site.set_acl(READ_ON_SITE, [grant(Perm.ReadDataset, SITE)]);

    const isa95 = new Isa95Hierarchy({ debug, cdb: site.cdb });
    isa95.run();
    const auth = new DeviceAuth({ auth: site.auth, isa95 });

    const data = new DataFlow({ debug, cdb: site.cdb, auth });
    data.run();
    const api = new APIv1({ data, debug, auth, cdb: site.cdb });
    cleanup.push(() => {
        data.stop();
        site.close();
    });
    return { site, data, api, auth, isa95 };
}

/* Wait until the hierarchy has read the placements. */
async function ready (isa95) {
    await rx.firstValueFrom(isa95.hierarchy.pipe(
        rx.filter(h => h.nodes_of(IN_AREA).length > 0)));
}

/* The single check and the list predicate for one default dataset. */
async function answers ({ data, api }, principal, device) {
    const dataset = default_dataset_uuid(device);
    const predicate = await rx.firstValueFrom(
        data.watch_allowed(principal, Perm.ReadDataset));
    return {
        single: await api.check_dataset_acl(principal, Perm.ReadDataset, dataset),
        list:   predicate(dataset),
    };
}

describe("UseDevice on an ISA-95 node", () => {
    test("covers devices at and under the node, and no others", async () => {
        const env = build();
        await ready(env.isa95);

        for (const device of [IN_AREA, ON_SITE])
            expect(await answers(env, SITE_USER, device))
                .toEqual({ single: true, list: true });
        for (const device of [ELSEWHERE, UNPLACED])
            expect(await answers(env, SITE_USER, device))
                .toEqual({ single: false, list: false });

        expect(await answers(env, AREA_USER, IN_AREA))
            .toEqual({ single: true, list: true });
        expect(await answers(env, AREA_USER, ON_SITE))
            .toEqual({ single: false, list: false });
    });

    test("answers UseDevice on the device itself", async () => {
        const env = build();
        await ready(env.isa95);
        const acl = await env.auth.fetch_acl(SITE_USER);

        expect(acl(Perm.UseDevice, IN_AREA, true)).toBe(true);
        expect(acl(Perm.UseDevice, ELSEWHERE, true)).toBe(false);
        expect(await env.auth.check_acl(AREA_USER, Perm.UseDevice, IN_AREA, true))
            .toBe(true);
    });

    test("follows a device that moves", async () => {
        const env = build();
        await ready(env.isa95);
        expect((await answers(env, SITE_USER, ELSEWHERE)).list).toBe(false);

        env.site.put(External.ISA95Placement, ELSEWHERE, { node: AREA });
        await rx.firstValueFrom(env.isa95.hierarchy.pipe(
            rx.filter(h => h.nodes_of(ELSEWHERE)[0] == AREA)));

        expect(await answers(env, SITE_USER, ELSEWHERE))
            .toEqual({ single: true, list: true });
    });

    test("does not spread other permissions down the tree", async () => {
        const env = build();
        await ready(env.isa95);

        expect(await answers(env, READ_ON_SITE, IN_AREA))
            .toEqual({ single: false, list: false });
        const acl = await env.auth.fetch_acl(READ_ON_SITE);
        expect(acl(Perm.ReadDataset, default_dataset_uuid(IN_AREA), true)).toBe(false);
    });
});
