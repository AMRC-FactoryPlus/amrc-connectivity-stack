/*
 * ACS Data Access Service
 * Unit tests: one permission rule, and the three places that answer with it
 * Copyright 2026 University of Sheffield
 */

/* A principal's right to a dataset is answered in three places:
 *
 *  - DataFlow.watch_allowed, the predicate behind every list;
 *  - DataFlow.watch_allowed_check, the same rule with the device given
 *    by the caller, which also says which answers changed;
 *  - APIv1.check_dataset_acl, the single check of the HTTP routes.
 *
 * These tests hold the three to the same answer wherever they agree,
 * and pin by name the one case where they differ. They run against
 * fakes, so they need no cluster. */

import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import {
    DEVICE_PERMS, READ_STRUCTURE, default_dataset_uuid,
} from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { reference_watch_allowed } from "../support/reference-datasets.js";
import { STRUCTURE_APPS } from "../support/site-builder.js";

const { App, Class, Perm, Special } = Constants;
const { Null } = UUIDs.Special;

const debug = { bound: () => () => {} };

const uuid = n => `a11c0000-0aaa-4000-8000-${n.toString(16).padStart(12, "0")}`;

const DEVICE_A = uuid(1);
const DEVICE_B = uuid(2);
const DEVICE_C = uuid(3);
/* The default dataset of device A, as the maker writes it. */
const DEFAULT = default_dataset_uuid(DEVICE_A);
/* A UNS device dataset somebody made by hand for the same device. */
const OWN = uuid(0x10);
const UNION = uuid(0x11);
/* Invalid: it reads a dataset that does not exist. */
const BROKEN = uuid(0x12);
const MISSING = uuid(0x13);
/* The default dataset of device B, with a second structure entry,
 * which makes it invalid in the dataset map. */
const BROKEN_DEFAULT = default_dataset_uuid(DEVICE_B);
/* The default dataset device C would have. Nobody has made it. */
const UNMADE = default_dataset_uuid(DEVICE_C);

const VALID = [DEFAULT, OWN, UNION];
const INVALID = [BROKEN, BROKEN_DEFAULT];

const REAL_PERMS = [
    Perm.ReadDataset, Perm.IncludeInUnion, Perm.UseForSession,
    Perm.EditDataset,
];
const PERMS = [...REAL_PERMS, READ_STRUCTURE];
const PERM_NAMES = new Map([
    [Perm.ReadDataset, "ReadDataset"],
    [Perm.IncludeInUnion, "IncludeInUnion"],
    [Perm.UseForSession, "UseForSession"],
    [Perm.EditDataset, "EditDataset"],
    [Perm.UseDevice, "UseDevice"],
    [READ_STRUCTURE, "READ_STRUCTURE"],
]);
const DATASET_NAMES = new Map([
    [DEFAULT, "the default dataset"],
    [OWN, "the hand-made UNS device dataset"],
    [UNION, "the union"],
    [BROKEN, "the invalid dataset"],
    [BROKEN_DEFAULT, "the invalid default dataset"],
]);

const grants = (permission, ...targets) =>
    targets.map(target => ({ permission, target }));

/* The grant sets. Every principal but root has an ACL, so Auth knows
 * it. */
const ACLS = {
    "wild-read@EXAMPLE.ORG":    grants(Perm.ReadDataset, Null),
    "wild-union@EXAMPLE.ORG":   grants(Perm.IncludeInUnion, Null),
    "wild-session@EXAMPLE.ORG": grants(Perm.UseForSession, Null),
    "wild-edit@EXAMPLE.ORG":    grants(Perm.EditDataset, Null),
    "exact@EXAMPLE.ORG": [
        ...grants(Perm.ReadDataset, DEFAULT, UNION, BROKEN, BROKEN_DEFAULT),
        ...grants(Perm.IncludeInUnion, OWN, BROKEN_DEFAULT),
        ...grants(Perm.UseForSession, UNION, BROKEN),
        ...grants(Perm.EditDataset, OWN, BROKEN, BROKEN_DEFAULT),
    ],
    "device-a@EXAMPLE.ORG":     grants(Perm.UseDevice, DEVICE_A),
    "device-b@EXAMPLE.ORG":     grants(Perm.UseDevice, DEVICE_B),
    "device-all@EXAMPLE.ORG":   grants(Perm.UseDevice, Null),
    "edit-only@EXAMPLE.ORG":    grants(Perm.EditDataset, DEFAULT, UNION),
    "nothing@EXAMPLE.ORG":      [],
};
const PRINCIPALS = [ROOT, ...Object.keys(ACLS)];

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

function build () {
    const site = make_site();
    for (const app of STRUCTURE_APPS)
        site.add_member(App.DatasetDefinition, app);

    site.put(App.UNSDevice, DEFAULT, { source: DEVICE_A });
    site.put(App.UNSDevice, OWN, { source: DEVICE_A });
    site.put(App.UnionComponents, UNION, [DEFAULT, OWN]);
    site.put(App.SessionLimits, BROKEN, { source: MISSING });
    site.put(App.UNSDevice, BROKEN_DEFAULT, { source: DEVICE_B });
    site.put(App.SparkplugSrc, BROKEN_DEFAULT, { source: DEVICE_B });
    for (const id of [...VALID, ...INVALID])
        site.add_member(Class.Dataset, id);

    for (const [principal, acl] of Object.entries(ACLS))
        site.set_acl(principal, acl);

    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const api = new APIv1({ data, debug, auth: site.auth, cdb: site.cdb });
    cleanup.push(() => {
        data.stop();
        site.close();
    });
    return { site, data, api };
}

/* The three answers for one principal, permission and dataset. */
async function answers ({ data, api }, principal, permission, dataset) {
    const predicate = await rx.firstValueFrom(
        data.watch_allowed(principal, permission));
    const [check, defaults] = await rx.firstValueFrom(rx.combineLatest([
        data.watch_allowed_check(principal, permission),
        data.default_devices,
    ]));
    return {
        list:   predicate(dataset),
        check:  check.ok(dataset, defaults.get(dataset)),
        single: await api.check_dataset_acl(principal, permission, dataset),
    };
}

/* The rule, written out again from the ACLs alone, so the three
 * cannot all be wrong together. `device` is the device a dataset is
 * the default dataset of. */
function expected (principal, permission, dataset, device) {
    if (principal == ROOT) return true;
    const has = (perm, target) => ACLS[principal].some(e =>
        e.permission == perm && (e.target == target || e.target == Null));

    const structure = permission == READ_STRUCTURE;
    if (has(structure ? Perm.EditDataset : permission, dataset)) return true;
    if (!structure && !DEVICE_PERMS.has(permission)) return false;
    return device != null && has(Perm.UseDevice, device);
}

describe("the fixture", () => {
    test("holds a default dataset, a hand-made one, a union and two invalid datasets", async () => {
        const { data } = build();
        const valid = await rx.firstValueFrom(data.valid_datasets);
        const invalid = await rx.firstValueFrom(data.invalid_datasets);
        const defaults = await rx.firstValueFrom(data.default_devices);

        expect([...valid.keys()].sort()).toEqual([...VALID].sort());
        expect([...invalid.keys()].sort()).toEqual([...INVALID].sort());
        expect(invalid.get(BROKEN_DEFAULT).structure).toBe(Special.InvalidDataset);
        /* Only the valid default dataset has a device. */
        expect([...defaults]).toEqual([[DEFAULT, DEVICE_A]]);
    });
});

describe("the list predicate, the keyed check and the single check agree", () => {
    const table = PRINCIPALS.flatMap(principal =>
        PERMS.map(permission => [principal, PERM_NAMES.get(permission), permission]));

    test.each(table)("%s, %s: on every valid dataset", async (principal, _name, permission) => {
        const fx = build();
        for (const dataset of VALID) {
            const device = dataset == DEFAULT ? DEVICE_A : null;
            const want = expected(principal, permission, dataset, device);
            expect([DATASET_NAMES.get(dataset),
                await answers(fx, principal, permission, dataset)])
                .toEqual([DATASET_NAMES.get(dataset),
                    { list: want, check: want, single: want }]);
        }
    });

    /* An invalid dataset that is not a default dataset has no device
     * route, so the three agree for every principal. */
    test.each(table)("%s, %s: on an invalid dataset that reads no device", async (principal, _name, permission) => {
        const fx = build();
        const want = expected(principal, permission, BROKEN, null);
        expect(await answers(fx, principal, permission, BROKEN))
            .toEqual({ list: want, check: want, single: want });
    });

    /* A direct grant, a grant on every target and root all reach an
     * invalid default dataset in the three places alike. */
    const direct = table.filter(([principal, , permission]) =>
        expected(principal, permission, BROKEN_DEFAULT, null));

    test("some principal holds each permission directly on the invalid default dataset", () => {
        expect(new Set(direct.map(([, name]) => name)))
            .toEqual(new Set(PERMS.map(p => PERM_NAMES.get(p))));
    });

    test.each(direct)("%s, %s: on an invalid default dataset with a direct grant", async (principal, _name, permission) => {
        const fx = build();
        expect(await answers(fx, principal, permission, BROKEN_DEFAULT))
            .toEqual({ list: true, check: true, single: true });
    });

    test("the table holds both answers for every permission", () => {
        for (const permission of PERMS) {
            const seen = new Set(PRINCIPALS.flatMap(principal =>
                VALID.map(dataset => expected(principal, permission, dataset,
                    dataset == DEFAULT ? DEVICE_A : null))));
            expect([PERM_NAMES.get(permission), [...seen].sort()])
                .toEqual([PERM_NAMES.get(permission), [false, true]]);
        }
    });

    test("UseDevice reaches the default dataset and no other dataset of the device", async () => {
        const fx = build();
        const principal = "device-a@EXAMPLE.ORG";
        for (const permission of [...DEVICE_PERMS, READ_STRUCTURE]) {
            expect(await answers(fx, principal, permission, DEFAULT))
                .toEqual({ list: true, check: true, single: true });
            expect(await answers(fx, principal, permission, OWN))
                .toEqual({ list: false, check: false, single: false });
        }
        /* EditDataset is not a permission UseDevice gives. */
        expect(await answers(fx, principal, Perm.EditDataset, DEFAULT))
            .toEqual({ list: false, check: false, single: false });
    });

    test("EditDataset alone reads the structure and nothing else", async () => {
        const fx = build();
        const principal = "edit-only@EXAMPLE.ORG";
        expect(await answers(fx, principal, READ_STRUCTURE, UNION))
            .toEqual({ list: true, check: true, single: true });
        expect(await answers(fx, principal, Perm.ReadDataset, UNION))
            .toEqual({ list: false, check: false, single: false });
        expect(await answers(fx, principal, READ_STRUCTURE, OWN))
            .toEqual({ list: false, check: false, single: false });
    });
});

describe("the one case where the lists and the single check differ", () => {
    /* This is how the code behaved before the keyed check, and it is
     * left alone on both sides.
     *
     * A default dataset that is invalid in the dataset map, here
     * because it has a second structure entry, has no device in
     * `default_devices`. So the lists give no right through UseDevice.
     * APIv1.check_dataset_acl does not read the dataset map: it reads
     * the stored UNS device config (default_device_of in api-v1.js),
     * finds the device, and allows the dataset through UseDevice.
     *
     * Do not make this test pass by changing either side. */
    const device_perms = [...DEVICE_PERMS, READ_STRUCTURE]
        .map(permission => [PERM_NAMES.get(permission), permission]);

    test.each(device_perms)("%s on an invalid default dataset, through UseDevice on its device", async (_name, permission) => {
        const fx = build();
        expect(await answers(fx, "device-b@EXAMPLE.ORG", permission, BROKEN_DEFAULT))
            .toEqual({ list: false, check: false, single: true });
    });

    test.each(device_perms)("%s on an invalid default dataset, through UseDevice on every device", async (_name, permission) => {
        const fx = build();
        expect(await answers(fx, "device-all@EXAMPLE.ORG", permission, BROKEN_DEFAULT))
            .toEqual({ list: false, check: false, single: true });
    });

    test("EditDataset is not given by UseDevice, so there the three agree", async () => {
        const fx = build();
        expect(await answers(fx, "device-b@EXAMPLE.ORG", Perm.EditDataset, BROKEN_DEFAULT))
            .toEqual({ list: false, check: false, single: false });
    });

    test("the difference goes when the dataset is valid again", async () => {
        const fx = build();
        fx.site.del(App.SparkplugSrc, BROKEN_DEFAULT);
        await fx.site.settle();
        expect(await answers(fx, "device-b@EXAMPLE.ORG", Perm.ReadDataset, BROKEN_DEFAULT))
            .toEqual({ list: true, check: true, single: true });
    });
});

describe("the list predicate as it was before the keyed check", () => {
    /* reference_watch_allowed is the list predicate copied from the
     * code before this rule was written down in one place. It reads
     * the same Auth and the same default devices as the code under
     * test, so any answer that differs is a permission that changed.
     * The single check, APIv1.check_dataset_acl, is the same code
     * before and after, so the tests above already hold it. */
    const before = ({ site, data }, principal, permission) =>
        rx.firstValueFrom(reference_watch_allowed(
            { auth: site.auth, default_devices: data.default_devices },
            principal, permission));

    const table = PRINCIPALS.flatMap(principal =>
        PERMS.map(permission => [principal, PERM_NAMES.get(permission), permission]));

    test.each(table)("%s, %s: the same answer for every dataset, made or not", async (principal, _name, permission) => {
        const fx = build();
        const old = await before(fx, principal, permission);
        const now = await rx.firstValueFrom(
            fx.data.watch_allowed(principal, permission));
        const [check, defaults] = await rx.firstValueFrom(rx.combineLatest([
            fx.data.watch_allowed_check(principal, permission),
            fx.data.default_devices,
        ]));

        for (const dataset of [...VALID, ...INVALID, MISSING, UNMADE]) {
            const want = old(dataset);
            expect([dataset, now(dataset), check.ok(dataset, defaults.get(dataset))])
                .toEqual([dataset, want, want]);
        }
    });

    /* The pinned difference is the answer the lists gave before, too:
     * no right to an invalid default dataset through UseDevice. */
    test.each([...DEVICE_PERMS, READ_STRUCTURE]
        .map(permission => [PERM_NAMES.get(permission), permission])
    )("%s on an invalid default dataset through UseDevice was refused by the lists before, as it is now", async (_name, permission) => {
        const fx = build();
        for (const principal of ["device-b@EXAMPLE.ORG", "device-all@EXAMPLE.ORG"]) {
            const old = await before(fx, principal, permission);
            expect([principal, old(BROKEN_DEFAULT)]).toEqual([principal, false]);
            expect([principal, (await answers(fx, principal, permission, BROKEN_DEFAULT)).list])
                .toEqual([principal, false]);
            /* And it did give the right to a valid default dataset. */
            expect([principal, old(DEFAULT)])
                .toEqual([principal, principal == "device-all@EXAMPLE.ORG"]);
        }
    });

    test("the answers follow a grant and a default dataset as they change", async () => {
        const fx = build();
        const principal = "device-b@EXAMPLE.ORG";
        const both = async () => [
            (await before(fx, principal, Perm.ReadDataset))(BROKEN_DEFAULT),
            (await rx.firstValueFrom(
                fx.data.watch_allowed(principal, Perm.ReadDataset)))(BROKEN_DEFAULT),
        ];
        expect(await both()).toEqual([false, false]);

        /* Valid again: UseDevice on its device now reaches it. */
        fx.site.del(App.SparkplugSrc, BROKEN_DEFAULT);
        await fx.site.settle();
        expect(await both()).toEqual([true, true]);

        fx.site.revoke(principal, Perm.UseDevice, DEVICE_B);
        await fx.site.settle();
        expect(await both()).toEqual([false, false]);
    });
});

/* Record every value of a sequence. */
function record (seq) {
    const values = [];
    const errors = [];
    const sub = seq.subscribe({
        next:   v => values.push(v),
        error:  e => errors.push(e),
    });
    cleanup.push(() => sub.unsubscribe());
    return { values, errors };
}

const USER = "user@EXAMPLE.ORG";
const TARGET_A = uuid(0x20);
const TARGET_B = uuid(0x21);

describe("watch_grant_state", () => {
    test("gives root every target, once, without asking Auth", () => {
        const { site, data } = build();
        const seen = record(data.watch_grant_state(ROOT, Perm.ReadDataset));
        expect(seen.values).toEqual([{ all: true }]);
        expect(site.counters.acl.total()).toBe(0);
    });

    test("gives the targets of the one permission", () => {
        const { site, data } = build();
        site.set_acl(USER, [
            ...grants(Perm.ReadDataset, TARGET_A),
            ...grants(Perm.EditDataset, TARGET_B),
        ]);
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));

        expect(seen.values).toHaveLength(1);
        expect(seen.values[0].all).toBe(false);
        expect([...seen.values[0].targets]).toEqual([TARGET_A]);
    });

    test("a grant on the Null UUID allows every target", () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.ReadDataset, Null, TARGET_A));
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));
        expect(seen.values.map(v => v.all)).toEqual([true]);
    });

    test("an ACL pushed again with the same content emits nothing", () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.ReadDataset, TARGET_A));
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));

        site.repush_acl(USER);
        site.repush_acl(USER);
        expect(seen.values).toHaveLength(1);
    });

    test("a push that differs only in another permission emits nothing", () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.ReadDataset, TARGET_A));
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));

        site.grant(USER, Perm.EditDataset, TARGET_B);
        site.grant(USER, Perm.UseDevice, DEVICE_A);
        site.revoke(USER, Perm.EditDataset, TARGET_B);
        expect(seen.values).toHaveLength(1);
    });

    test("a grant gained or lost emits once each", () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.ReadDataset, TARGET_A));
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));

        site.grant(USER, Perm.ReadDataset, TARGET_B);
        site.revoke(USER, Perm.ReadDataset, TARGET_A);
        expect(seen.values.map(v => [v.all, [...v.targets]])).toEqual([
            [false, [TARGET_A]],
            [false, [TARGET_A, TARGET_B]],
            [false, [TARGET_B]],
        ]);
    });

    test("while every target is allowed, a change to the named targets emits nothing", () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.ReadDataset, Null));
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));

        site.grant(USER, Perm.ReadDataset, TARGET_A);
        expect(seen.values).toHaveLength(1);

        site.revoke(USER, Perm.ReadDataset, Null);
        expect(seen.values.map(v => v.all)).toEqual([true, false]);
        expect([...seen.values[1].targets]).toEqual([TARGET_A]);
    });

    test("a principal Auth does not know gets no value", () => {
        const { data } = build();
        const seen = record(data.watch_grant_state("stranger@EXAMPLE.ORG", Perm.ReadDataset));
        expect(seen.values).toEqual([]);
        expect(seen.errors).toEqual([]);
    });

    test("an Auth error reaches the subscriber", () => {
        const { site, data } = build();
        site.set_acl(USER, []);
        const seen = record(data.watch_grant_state(USER, Perm.ReadDataset));
        site.error("acl", USER, new Error("Auth is gone"));
        expect(seen.errors.map(e => e.message)).toEqual(["Auth is gone"]);
    });
});

describe("watch_granted", () => {
    test("is the grant state as a predicate, and emits only when the grants change", () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.ReadDataset, TARGET_A));
        const seen = record(data.watch_granted(USER, Perm.ReadDataset));

        site.repush_acl(USER);
        site.grant(USER, Perm.EditDataset, TARGET_B);
        expect(seen.values).toHaveLength(1);
        expect([TARGET_A, TARGET_B].map(seen.values[0])).toEqual([true, false]);

        site.grant(USER, Perm.ReadDataset, Null);
        expect(seen.values).toHaveLength(2);
        expect([TARGET_A, TARGET_B, "anything"].map(seen.values[1]))
            .toEqual([true, true, true]);
    });

    test("allows root everything", async () => {
        const { data } = build();
        const ok = await rx.firstValueFrom(data.watch_granted(ROOT, Perm.EditDataset));
        expect(ok(TARGET_A)).toBe(true);
    });
});

describe("watch_allowed_check says which answers changed", () => {
    /* A principal with one direct grant and UseDevice on one device,
     * and a check open on it. */
    function open (permission, acl) {
        const fx = build();
        fx.site.set_acl(USER, acl ?? [
            ...grants(Perm.ReadDataset, TARGET_A),
            ...grants(Perm.EditDataset, TARGET_A),
            ...grants(Perm.UseDevice, DEVICE_A),
        ]);
        const seen = record(fx.data.watch_allowed_check(USER, permission));
        return { ...fx, seen };
    }

    test("the first value has changed: null", () => {
        const { seen } = open(Perm.ReadDataset);
        expect(seen.values).toHaveLength(1);
        expect(seen.values[0].changed).toBeNull();
        expect(seen.values[0].ok(TARGET_A, undefined)).toBe(true);
        expect(seen.values[0].ok(TARGET_B, undefined)).toBe(false);
        expect(seen.values[0].ok(DEFAULT, DEVICE_A)).toBe(true);
        expect(seen.values[0].ok(BROKEN_DEFAULT, DEVICE_B)).toBe(false);
        /* A device is used only when the caller gives it. */
        expect(seen.values[0].ok(DEFAULT, undefined)).toBe(false);
        expect(seen.values[0].ok(DEFAULT, null)).toBe(false);
    });

    test.each([
        ["ReadDataset", Perm.ReadDataset],
        ["READ_STRUCTURE", READ_STRUCTURE],
        ["EditDataset", Perm.EditDataset],
    ])("%s: an ACL pushed again with the same content emits nothing", (_name, permission) => {
        const { site, seen } = open(permission);
        site.repush_acl(USER);
        site.repush_acl(USER);
        expect(seen.values).toHaveLength(1);
    });

    test("a push that differs only in another permission emits nothing", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.grant(USER, Perm.IncludeInUnion, TARGET_B);
        site.grant(USER, Perm.EditDataset, TARGET_B);
        site.revoke(USER, Perm.IncludeInUnion, TARGET_B);
        expect(seen.values).toHaveLength(1);
    });

    test("a grant on one new target emits once, with exactly that target", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.grant(USER, Perm.ReadDataset, TARGET_B);

        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toEqual(new Set([TARGET_B]));
        expect(seen.values[1].ok(TARGET_B, undefined)).toBe(true);
    });

    test("a grant lost emits once, with exactly that target", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.revoke(USER, Perm.ReadDataset, TARGET_A);

        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toEqual(new Set([TARGET_A]));
        expect(seen.values[1].ok(TARGET_A, undefined)).toBe(false);
    });

    test("UseDevice gained on one device names exactly that device's default dataset", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.grant(USER, Perm.UseDevice, DEVICE_C);

        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toEqual(new Set([UNMADE]));
        expect(seen.values[1].ok(UNMADE, DEVICE_C)).toBe(true);
    });

    test("UseDevice lost on one device names exactly that device's default dataset", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.revoke(USER, Perm.UseDevice, DEVICE_A);

        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toEqual(new Set([DEFAULT]));
        expect(seen.values[1].ok(DEFAULT, DEVICE_A)).toBe(false);
    });

    test("one push that changes a direct grant and a device grant names both, over two values", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.set_acl(USER, [
            ...grants(Perm.ReadDataset, TARGET_A, TARGET_B),
            ...grants(Perm.UseDevice, DEVICE_A, DEVICE_C),
        ]);

        const changed = new Set(seen.values.slice(1).flatMap(v => [...v.changed]));
        expect(seen.values).toHaveLength(3);
        expect(changed).toEqual(new Set([TARGET_B, UNMADE]));
    });

    test.each([
        ["ReadDataset", Perm.ReadDataset, Perm.ReadDataset],
        ["READ_STRUCTURE through EditDataset", READ_STRUCTURE, Perm.EditDataset],
        ["ReadDataset through UseDevice", Perm.ReadDataset, Perm.UseDevice],
    ])("%s: a grant on the Null UUID gained or lost gives changed: null", (_name, permission, granted) => {
        const { site, seen } = open(permission);

        site.grant(USER, granted, Null);
        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toBeNull();
        const device = granted == Perm.UseDevice ? DEVICE_B : undefined;
        expect(seen.values[1].ok(TARGET_B, device)).toBe(true);

        site.revoke(USER, granted, Null);
        expect(seen.values).toHaveLength(3);
        expect(seen.values[2].changed).toBeNull();
        expect(seen.values[2].ok(TARGET_B, device)).toBe(false);
    });

    test("while a direct grant covers every target, a device grant changes no answer", () => {
        const { site, seen } = open(Perm.ReadDataset, [
            ...grants(Perm.ReadDataset, Null),
            ...grants(Perm.UseDevice, DEVICE_A),
        ]);
        site.grant(USER, Perm.UseDevice, DEVICE_C);

        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toEqual(new Set());
        expect(seen.values[1].ok(TARGET_B, undefined)).toBe(true);
    });

    test("READ_STRUCTURE reads EditDataset as its direct grant, and not ReadDataset", () => {
        const { site, seen } = open(READ_STRUCTURE);
        expect(seen.values[0].ok(TARGET_A, undefined)).toBe(true);
        expect(seen.values[0].ok(DEFAULT, DEVICE_A)).toBe(true);

        site.grant(USER, Perm.ReadDataset, TARGET_B);
        expect(seen.values).toHaveLength(1);

        site.grant(USER, Perm.EditDataset, TARGET_B);
        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].changed).toEqual(new Set([TARGET_B]));
    });

    test("EditDataset takes no device route and does not watch UseDevice", () => {
        const { site, seen } = open(Perm.EditDataset);
        expect(seen.values[0].ok(TARGET_A, undefined)).toBe(true);
        /* A device given by the caller makes no difference. */
        expect(seen.values[0].ok(DEFAULT, DEVICE_A)).toBe(false);
        expect(site.counters.acl.get(`${USER} ${Perm.UseDevice}`)).toBeUndefined();

        site.grant(USER, Perm.UseDevice, DEVICE_C);
        site.grant(USER, Perm.UseDevice, Null);
        expect(seen.values).toHaveLength(1);
    });

    test("root gets one value that allows everything", () => {
        const { site, data } = build();
        const seen = record(data.watch_allowed_check(ROOT, Perm.ReadDataset));
        expect(seen.values).toHaveLength(1);
        expect(seen.values[0].changed).toBeNull();
        expect(seen.values[0].ok(TARGET_A, undefined)).toBe(true);
        expect(site.counters.acl.total()).toBe(0);
    });

    test("each subscriber starts with changed: null, whatever came before", () => {
        const { site, data, seen } = open(Perm.ReadDataset);
        site.grant(USER, Perm.ReadDataset, TARGET_B);
        expect(seen.values[1].changed).toEqual(new Set([TARGET_B]));

        const late = record(data.watch_allowed_check(USER, Perm.ReadDataset));
        expect(late.values).toHaveLength(1);
        expect(late.values[0].changed).toBeNull();

        site.grant(USER, Perm.ReadDataset, uuid(0x22));
        expect(late.values[1].changed).toEqual(new Set([uuid(0x22)]));
        expect(seen.values[2].changed).toEqual(new Set([uuid(0x22)]));
    });

    test("a principal Auth does not know gets no value", () => {
        const { data } = build();
        const seen = record(data.watch_allowed_check("stranger@EXAMPLE.ORG", Perm.ReadDataset));
        expect(seen.values).toEqual([]);
        expect(seen.errors).toEqual([]);
    });

    test("a device grant target that is not a UUID does no harm", () => {
        const { site, seen } = open(Perm.ReadDataset);
        site.grant(USER, Perm.UseDevice, "not-a-uuid");

        expect(seen.errors).toEqual([]);
        expect(seen.values).toHaveLength(2);
        /* It names the default dataset such a device would have. */
        expect(seen.values[1].changed)
            .toEqual(new Set([default_dataset_uuid("not-a-uuid")]));
        expect(seen.values[1].ok(TARGET_A, undefined)).toBe(true);
        expect(seen.values[1].ok(DEFAULT, DEVICE_A)).toBe(true);
    });
});

describe("watch_allowed", () => {
    test("for a permission with no device route, does not read default_devices", async () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.EditDataset, TARGET_A));
        let reads = 0;
        const devices = data.default_devices;
        data.default_devices = rx.defer(() => {
            reads++;
            return devices;
        });

        const ok = await rx.firstValueFrom(data.watch_allowed(USER, Perm.EditDataset));
        expect([ok(TARGET_A), ok(TARGET_B)]).toEqual([true, false]);
        expect(reads).toBe(0);

        await rx.firstValueFrom(data.watch_allowed(USER, Perm.ReadDataset));
        expect(reads).toBe(1);
    });

    test("emits once for a grant change, and not at all for a push that changes nothing", async () => {
        const { site, data } = build();
        site.set_acl(USER, grants(Perm.UseDevice, DEVICE_A));
        const seen = record(data.watch_allowed(USER, Perm.ReadDataset));
        await site.settle();
        expect(seen.values).toHaveLength(1);
        expect(seen.values[0](DEFAULT)).toBe(true);
        expect(seen.values[0](OWN)).toBe(false);

        site.repush_acl(USER);
        site.grant(USER, Perm.EditDataset, OWN);
        expect(seen.values).toHaveLength(1);

        site.grant(USER, Perm.ReadDataset, OWN);
        expect(seen.values).toHaveLength(2);
        expect(seen.values[1](OWN)).toBe(true);
    });

    test("follows a default dataset that becomes valid", async () => {
        const { site, data } = build();
        const seen = record(data.watch_allowed("device-b@EXAMPLE.ORG", Perm.ReadDataset));
        await site.settle();
        expect(seen.values.at(-1)(BROKEN_DEFAULT)).toBe(false);

        site.del(App.SparkplugSrc, BROKEN_DEFAULT);
        await site.settle();
        expect(seen.values.at(-1)(BROKEN_DEFAULT)).toBe(true);
    });
});
