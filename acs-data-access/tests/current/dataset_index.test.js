/*
 * ACS Data Access Service
 * Unit tests for the per-change dataset map
 * Copyright 2026 University of Sheffield
 */

/* These are pure: no cluster, no rxjs, no timer. The first half pins
 * each rule of the dataset map with exact values. The second half
 * counts the work one change costs, at three site sizes. */

import * as imm from "immutable";
import { describe, expect, test } from "vitest";

import { AppConfigs } from "../../lib/app-configs.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import {
    DatasetIndex, dataset_refs, resolve_window,
} from "../../lib/dataset-index.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";

import { reference_datasets } from "../support/reference-datasets.js";

const { App, Special } = Constants;

const UNKNOWN_APP = "f0000000-0000-4000-8000-00000000000f";

const INVALID = {
    structure:  Special.InvalidDataset,
    config:     null,
    from:       null,
    to:         null,
};

const hex = n => n.toString(16).padStart(12, "0");
const ds = n => `d5000000-0000-4000-8000-${hex(n)}`;
const device = n => `de000000-0000-4000-8000-${hex(n)}`;

const clone = value => JSON.parse(JSON.stringify(value));

/** The grouped structure entries of a site, and an index over them.
 * Each write tells the index which dataset changed. */
class Site {
    constructor () {
        this.defs = imm.Map();
        this.index = new DatasetIndex();
    }

    /* Fill the site from { uuid: { app: config } } and index all of it. */
    load (datasets) {
        for (const [id, defs] of Object.entries(datasets))
            this.defs = this.defs.set(id, imm.Map(defs));
        return this.index.apply(this.defs, null);
    }

    put (id, app, config) {
        const inner = this.defs.get(id, imm.Map());
        this.defs = this.defs.set(id, inner.set(app, config));
        return this.index.apply(this.defs, new Set([id]));
    }

    del (id, app) {
        const inner = this.defs.get(id, imm.Map()).delete(app);
        this.defs = inner.size
            ? this.defs.set(id, inner)
            : this.defs.delete(id);
        return this.index.apply(this.defs, new Set([id]));
    }

    entry (id) { return this.index.entries.get(id); }
    is_valid (id) { return this.index.valid.has(id); }
    is_invalid (id) { return this.index.invalid.has(id); }
}

const sorted = set => [...set].sort();

describe("resolve_window", () => {
    const none = () => { throw new Error("No lookup expected"); };

    test("the four device kinds have no window", () => {
        for (const app of [
            App.SparkplugSrc, App.SparkplugSubset,
            App.UNSDevice, App.UNSDeviceMetrics,
        ])
            expect(resolve_window(app, { any: "config" }, none))
                .toStrictEqual({ from: null, to: null });
    });

    test("an unknown structure is invalid", () => {
        expect(resolve_window(UNKNOWN_APP, {}, none)).toBe(null);
        expect(resolve_window(App.MESIdentifiers, {}, none)).toBe(null);
    });

    test("a session asks for its source and clamps to it", () => {
        const asked = [];
        const win = resolve_window(App.SessionLimits, {
            source: ds(1),
            from:   "2026-01-01T00:00:00.000Z",
            to:     "2026-01-31T00:00:00.000Z",
        }, id => {
            asked.push(id);
            return {
                from:   new Date("2026-01-10T00:00:00.000Z"),
                to:     new Date("2026-02-10T00:00:00.000Z"),
            };
        });
        expect(asked).toEqual([ds(1)]);
        expect(win).toStrictEqual({
            from:   new Date("2026-01-10T00:00:00.000Z"),
            to:     new Date("2026-01-31T00:00:00.000Z"),
        });
    });

    test("a session with an invalid source is invalid", () => {
        expect(resolve_window(App.SessionLimits, { source: ds(1) }, () => null))
            .toBe(null);
    });

    test("a union asks for every component, also after an invalid one", () => {
        const asked = [];
        const win = resolve_window(App.UnionComponents, [ds(1), ds(2), ds(3)],
            id => {
                asked.push(id);
                return id == ds(1) ? null : { from: null, to: null };
            });
        expect(win).toBe(null);
        expect(asked).toEqual([ds(1), ds(2), ds(3)]);
    });

    test("a config it cannot read throws", () => {
        expect(() => resolve_window(App.SessionLimits, null, none)).toThrow();
        expect(() => resolve_window(App.UnionComponents, {}, none)).toThrow();
        expect(() => resolve_window(App.UnionComponents, null, none)).toThrow();
    });
});

describe("dataset_refs", () => {
    test("a session refers to its source", () => {
        expect(dataset_refs(App.SessionLimits, { source: ds(1), from: null }))
            .toEqual([ds(1)]);
    });

    test("a union refers to each component", () => {
        expect(dataset_refs(App.UnionComponents, [ds(1), ds(2)]))
            .toEqual([ds(1), ds(2)]);
        expect(dataset_refs(App.UnionComponents, [])).toEqual([]);
    });

    test("other kinds refer to nothing, whatever their config holds", () => {
        for (const app of [
            App.SparkplugSrc, App.SparkplugSubset, App.UNSDevice,
            App.UNSDeviceMetrics, UNKNOWN_APP,
        ]) {
            expect(dataset_refs(app, { source: ds(1) })).toEqual([]);
            expect(dataset_refs(app, [ds(1)])).toEqual([]);
        }
    });

    test("a config that cannot be read refers to nothing and does not throw", () => {
        expect(dataset_refs(App.SessionLimits, null)).toEqual([]);
        expect(dataset_refs(App.SessionLimits, {})).toEqual([]);
        expect(dataset_refs(App.SessionLimits, { source: 7 })).toEqual([]);
        expect(dataset_refs(App.SessionLimits, "text")).toEqual([]);
        expect(dataset_refs(App.UnionComponents, null)).toEqual([]);
        expect(dataset_refs(App.UnionComponents, { 0: ds(1) })).toEqual([]);
        expect(dataset_refs(App.UnionComponents, "text")).toEqual([]);
        expect(dataset_refs(App.UnionComponents, [ds(1), 7, null, ds(2)]))
            .toEqual([ds(1), ds(2)]);
    });
});

describe("DatasetIndex rules", () => {
    test("the first apply returns a value for an empty site, and the next returns null", () => {
        const index = new DatasetIndex();
        const first = index.apply(imm.Map(), null);

        expect(first).not.toBe(null);
        expect(Object.keys(first))
            .toEqual(["datasets", "valid", "invalid", "defaults", "changed"]);
        for (const key of ["datasets", "valid", "invalid", "defaults"]) {
            expect(imm.Map.isMap(first[key])).toBe(true);
            expect(first[key].size).toBe(0);
        }
        expect(first.changed).toBeInstanceOf(Set);
        expect(first.changed.size).toBe(0);

        expect(index.apply(imm.Map(), null)).toBe(null);
        expect(index.apply(imm.Map(), new Set())).toBe(null);
    });

    test("the first apply marks every dataset as changed", () => {
        const site = new Site();
        const first = site.load({
            [ds(1)]: { [App.SparkplugSrc]: { a: 1 } },
            [ds(2)]: { [App.UnionComponents]: [ds(1)] },
        });
        expect(sorted(first.changed)).toEqual([ds(1), ds(2)]);
        expect(first.datasets).toBe(site.index.entries);
        expect(first.valid).toBe(site.index.valid);
        expect(first.invalid).toBe(site.index.invalid);
        expect(first.defaults).toBe(site.index.defaults);
    });

    /* An index that starts on a sequence already under way reads a
     * replay of the latest value first. That value's `changed` names
     * the last change, not the datasets a new index has yet to see. */
    test.each([
        ["a Set of one", () => new Set([ds(2)])],
        ["an array of one", () => [ds(2)]],
        ["an empty Set", () => new Set()],
    ])("the first apply looks at every dataset when changed is %s", (_, changed) => {
        const grouped = imm.Map({
            [ds(1)]: imm.Map({ [App.SparkplugSrc]: { a: 1 } }),
            [ds(2)]: imm.Map({ [App.SparkplugSrc]: { a: 2 } }),
            [ds(3)]: imm.Map({ [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-01-01T00:00:00.000Z",
                to:     "2026-01-10T00:00:00.000Z",
            } }),
        });
        const index = new DatasetIndex();
        const first = index.apply(grouped, changed());

        expect(index.entries.size).toBe(3);
        expect(sorted(first.changed)).toEqual([ds(1), ds(2), ds(3)]);
        expect(first.datasets).toBe(index.entries);
        expect(Object.fromEntries(first.datasets))
            .toStrictEqual(Object.fromEntries(reference_datasets(grouped)));
        expect(sorted(first.valid.keys())).toEqual([ds(1), ds(2), ds(3)]);
        expect(sorted(index.referrers_of(ds(1)))).toEqual([ds(3)]);
        expect(index.stats).toEqual({ applies: 1, resolved: 3 });
    });

    test("only the first apply ignores changed", () => {
        const before = imm.Map({
            [ds(1)]: imm.Map({ [App.SparkplugSrc]: { a: 1 } }),
            [ds(2)]: imm.Map({ [App.SparkplugSrc]: { a: 2 } }),
        });
        const index = new DatasetIndex();
        index.apply(before, new Set([ds(2)]));
        const held = index.entries.get(ds(1));

        const after = before
            .set(ds(2), imm.Map({ [App.SparkplugSrc]: { a: 3 } }));
        const second = index.apply(after, new Set([ds(2)]));

        expect([...second.changed]).toEqual([ds(2)]);
        expect(index.stats).toEqual({ applies: 2, resolved: 3 });
        expect(index.entries.get(ds(1))).toBe(held);
    });

    test("the entry key order and the stored config object", () => {
        const config = { node: "n", device: "d" };
        const site = new Site();
        site.load({ [ds(1)]: { [App.SparkplugSrc]: config } });

        const entry = site.entry(ds(1));
        expect(Object.keys(entry)).toEqual(["structure", "config", "from", "to"]);
        expect(entry).toStrictEqual({
            structure: App.SparkplugSrc, config, from: null, to: null });
        expect(entry.config).toBe(config);
        expect(site.index.valid.get(ds(1))).toBe(entry);
        expect(site.is_invalid(ds(1))).toBe(false);
    });

    test("the exact invalid marker", () => {
        const site = new Site();
        site.load({ [ds(1)]: { [UNKNOWN_APP]: { some: "config" } } });

        const entry = site.entry(ds(1));
        expect(Object.keys(entry)).toEqual(["structure", "config", "from", "to"]);
        expect(entry).toStrictEqual(INVALID);
        expect(entry.structure).toBe("696396a0-2831-11f1-9b12-33d63b8c5115");
        expect(site.index.invalid.get(ds(1))).toBe(entry);
        expect(site.is_valid(ds(1))).toBe(false);
    });

    test("each of the four device kinds is valid with no window", () => {
        const site = new Site();
        const apps = [
            App.SparkplugSrc, App.SparkplugSubset,
            App.UNSDevice, App.UNSDeviceMetrics,
        ];
        site.load(Object.fromEntries(
            apps.map((app, i) => [ds(i), { [app]: { n: i } }])));

        apps.forEach((app, i) => {
            expect(site.entry(ds(i))).toStrictEqual({
                structure: app, config: { n: i }, from: null, to: null });
        });
        expect(site.index.valid.size).toBe(4);
        expect(site.index.invalid.size).toBe(0);
    });

    test("a duplicate definition is invalid until one entry goes", () => {
        const config = { a: 1 };
        const site = new Site();
        site.load({ [ds(1)]: { [App.SparkplugSrc]: config } });

        const dup = site.put(ds(1), App.UNSDeviceMetrics, { b: 2 });
        expect(sorted(dup.changed)).toEqual([ds(1)]);
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.is_valid(ds(1))).toBe(false);
        expect(site.is_invalid(ds(1))).toBe(true);

        const healed = site.del(ds(1), App.UNSDeviceMetrics);
        expect(sorted(healed.changed)).toEqual([ds(1)]);
        expect(site.entry(ds(1))).toStrictEqual({
            structure: App.SparkplugSrc, config, from: null, to: null });
        expect(site.is_valid(ds(1))).toBe(true);
        expect(site.is_invalid(ds(1))).toBe(false);
    });

    test("a duplicate definition makes its referrers invalid", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: { source: ds(1) } },
        });
        expect(site.is_valid(ds(2))).toBe(true);

        const dup = site.put(ds(1), App.SparkplugSubset, {});
        expect(sorted(dup.changed)).toEqual([ds(1), ds(2)]);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
    });

    test("a duplicate union and session definition refers to nothing", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: {
                [App.UnionComponents]: [ds(1)],
                [App.SessionLimits]: { source: ds(1) },
            },
        });
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.index.referrers_of(ds(1)).size).toBe(0);
    });

    test("an unknown structure is invalid", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [UNKNOWN_APP]: {} },
            [ds(2)]: { [App.MESIdentifiers]: {} },
            [ds(3)]: { [App.SparkplugSrc]: {} },
        });
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(sorted(site.index.invalid.keys())).toEqual([ds(1), ds(2)]);
        expect(sorted(site.index.valid.keys())).toEqual([ds(3)]);
    });

    test("an object with no structure entry is not in the map", () => {
        const site = new Site();
        site.load({ [ds(1)]: { [App.SparkplugSrc]: {} } });

        const gone = site.del(ds(1), App.SparkplugSrc);
        expect(sorted(gone.changed)).toEqual([ds(1)]);
        expect(site.index.entries.has(ds(1))).toBe(false);
        expect(site.index.entries.size).toBe(0);
        expect(site.index.valid.size).toBe(0);
        expect(site.index.invalid.size).toBe(0);
    });

    test("a missing reference is invalid", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SessionLimits]: { source: ds(9) } },
            [ds(2)]: { [App.UnionComponents]: [ds(3), ds(9)] },
            [ds(3)]: { [App.SparkplugSrc]: {} },
            [ds(4)]: { [App.SessionLimits]: {} },
        });
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        /* A session with no source at all. */
        expect(site.entry(ds(4))).toStrictEqual(INVALID);
        expect(site.is_valid(ds(3))).toBe(true);
        expect(site.index.entries.has(ds(9))).toBe(false);
    });

    test("a dangling reference becomes valid when its target appears", () => {
        const session = {
            source: ds(9),
            from:   "2026-02-01T00:00:00.000Z",
            to:     "2026-02-02T12:30:00.000Z",
        };
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SessionLimits]: session },
            [ds(2)]: { [App.UnionComponents]: [ds(1)] },
        });
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(sorted(site.index.referrers_of(ds(9)))).toEqual([ds(1)]);

        const appeared = site.put(ds(9), App.SparkplugSrc, { n: 9 });
        expect(sorted(appeared.changed)).toEqual([ds(1), ds(2), ds(9)]);
        expect(site.entry(ds(1))).toStrictEqual({
            structure:  App.SessionLimits,
            config:     session,
            from:       new Date("2026-02-01T00:00:00.000Z"),
            to:         new Date("2026-02-02T12:30:00.000Z"),
        });
        expect(site.entry(ds(2))).toStrictEqual({
            structure:  App.UnionComponents,
            config:     [ds(1)],
            from:       new Date("2026-02-01T00:00:00.000Z"),
            to:         new Date("2026-02-02T12:30:00.000Z"),
        });
        expect(site.index.invalid.size).toBe(0);

        /* And invalid again when the target goes. */
        const vanished = site.del(ds(9), App.SparkplugSrc);
        expect(sorted(vanished.changed)).toEqual([ds(1), ds(2), ds(9)]);
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.index.entries.has(ds(9))).toBe(false);
    });

    test("a dataset that refers to itself is invalid", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.UnionComponents]: [ds(1)] },
            [ds(2)]: { [App.SessionLimits]: { source: ds(2) } },
        });
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
    });

    test("a cycle of 2 is invalid, and valid again when it is broken", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SessionLimits]: { source: ds(2) } },
            [ds(2)]: { [App.UnionComponents]: [ds(1), ds(3)] },
            [ds(3)]: { [App.SparkplugSrc]: {} },
        });
        expect(site.entry(ds(1))).toStrictEqual(INVALID);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.is_valid(ds(3))).toBe(true);

        const broken = site.put(ds(2), App.UnionComponents, [ds(3)]);
        expect(sorted(broken.changed)).toEqual([ds(1), ds(2)]);
        expect(site.entry(ds(1))).toStrictEqual({
            structure:  App.SessionLimits,
            config:     { source: ds(2) },
            from:       null,
            to:         null,
        });
        expect(site.entry(ds(2))).toStrictEqual({
            structure:  App.UnionComponents,
            config:     [ds(3)],
            from:       null,
            to:         null,
        });
    });

    test("a cycle of 3 is invalid, and so is a dataset that reaches it", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SessionLimits]: { source: ds(2) } },
            [ds(2)]: { [App.UnionComponents]: [ds(3)] },
            [ds(3)]: { [App.SessionLimits]: { source: ds(1) } },
            /* Not on the cycle, but it reaches it. */
            [ds(4)]: { [App.SessionLimits]: { source: ds(1) } },
            [ds(5)]: { [App.UnionComponents]: [ds(6), ds(4)] },
            [ds(6)]: { [App.SparkplugSrc]: {} },
        });
        for (const n of [1, 2, 3, 4, 5])
            expect(site.entry(ds(n))).toStrictEqual(INVALID);
        expect(site.is_valid(ds(6))).toBe(true);
        expect(sorted(site.index.invalid.keys()))
            .toEqual([ds(1), ds(2), ds(3), ds(4), ds(5)]);

        const broken = site.put(ds(3), App.SessionLimits, { source: ds(6) });
        expect(sorted(broken.changed))
            .toEqual([ds(1), ds(2), ds(3), ds(4), ds(5)]);
        expect(site.index.invalid.size).toBe(0);
        expect(site.index.valid.size).toBe(6);
    });

    test("a cycle made between valid datasets makes each of them invalid", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.UnionComponents]: [ds(1)] },
            [ds(3)]: { [App.UnionComponents]: [ds(2)] },
        });
        expect(site.index.invalid.size).toBe(0);

        const cyclic = site.put(ds(2), App.UnionComponents, [ds(1), ds(3)]);
        expect(sorted(cyclic.changed)).toEqual([ds(2), ds(3)]);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.entry(ds(3))).toStrictEqual(INVALID);
        expect(site.is_valid(ds(1))).toBe(true);
    });

    test("a session clamps to its source: the later from and the earlier to", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-01-05T00:00:00.000Z",
                to:     "2026-01-20T00:00:00.000Z",
            } },
            /* Wider than its source on both sides. */
            [ds(3)]: { [App.SessionLimits]: {
                source: ds(2),
                from:   "2026-01-01T00:00:00.000Z",
                to:     "2026-01-31T00:00:00.000Z",
            } },
            /* Narrower than its source on both sides. */
            [ds(4)]: { [App.SessionLimits]: {
                source: ds(2),
                from:   "2026-01-10T00:00:00.000Z",
                to:     "2026-01-15T00:00:00.000Z",
            } },
            /* No limits of its own. */
            [ds(5)]: { [App.SessionLimits]: { source: ds(2) } },
            /* Only a from, later than the source's. */
            [ds(6)]: { [App.SessionLimits]: {
                source: ds(2), from: "2026-01-12T00:00:00.000Z", to: null } },
            /* No limits over a source with no window. */
            [ds(7)]: { [App.SessionLimits]: { source: ds(1) } },
        });

        const window = n => ({
            from: site.entry(ds(n)).from, to: site.entry(ds(n)).to });
        expect(window(2)).toStrictEqual({
            from:   new Date("2026-01-05T00:00:00.000Z"),
            to:     new Date("2026-01-20T00:00:00.000Z"),
        });
        expect(window(3)).toStrictEqual({
            from:   new Date("2026-01-05T00:00:00.000Z"),
            to:     new Date("2026-01-20T00:00:00.000Z"),
        });
        expect(window(4)).toStrictEqual({
            from:   new Date("2026-01-10T00:00:00.000Z"),
            to:     new Date("2026-01-15T00:00:00.000Z"),
        });
        expect(window(5)).toStrictEqual({
            from:   new Date("2026-01-05T00:00:00.000Z"),
            to:     new Date("2026-01-20T00:00:00.000Z"),
        });
        expect(window(6)).toStrictEqual({
            from:   new Date("2026-01-12T00:00:00.000Z"),
            to:     new Date("2026-01-20T00:00:00.000Z"),
        });
        expect(window(7)).toStrictEqual({ from: null, to: null });
        expect(site.index.invalid.size).toBe(0);
    });

    test("a union takes the earliest from and the latest to", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-01-05T00:00:00.000Z",
                to:     "2026-01-10T00:00:00.000Z",
            } },
            [ds(3)]: { [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-01-08T00:00:00.000Z",
                to:     "2026-01-25T06:00:00.000Z",
            } },
            /* A session with a from and no to. */
            [ds(4)]: { [App.SessionLimits]: {
                source: ds(1), from: "2026-01-02T00:00:00.000Z" } },
            [ds(5)]: { [App.UnionComponents]: [ds(2), ds(3)] },
            [ds(6)]: { [App.UnionComponents]: [ds(2), ds(3), ds(4)] },
        });
        expect(site.entry(ds(5))).toStrictEqual({
            structure:  App.UnionComponents,
            config:     [ds(2), ds(3)],
            from:       new Date("2026-01-05T00:00:00.000Z"),
            to:         new Date("2026-01-25T06:00:00.000Z"),
        });
        /* The component with no `to` does not make the union open. */
        expect(site.entry(ds(6))).toStrictEqual({
            structure:  App.UnionComponents,
            config:     [ds(2), ds(3), ds(4)],
            from:       new Date("2026-01-02T00:00:00.000Z"),
            to:         new Date("2026-01-25T06:00:00.000Z"),
        });
    });

    test("a union of an unbounded dataset and a session takes the session window", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-03-01T08:00:00.000Z",
                to:     "2026-03-01T16:00:00.000Z",
            } },
            [ds(3)]: { [App.UnionComponents]: [ds(1), ds(2)] },
        });
        expect(site.entry(ds(3))).toStrictEqual({
            structure:  App.UnionComponents,
            config:     [ds(1), ds(2)],
            from:       new Date("2026-03-01T08:00:00.000Z"),
            to:         new Date("2026-03-01T16:00:00.000Z"),
        });
    });

    test("an empty union is valid, and so is a union of unbounded datasets", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.UnionComponents]: [] },
            [ds(2)]: { [App.SparkplugSrc]: {} },
            [ds(3)]: { [App.UNSDeviceMetrics]: {} },
            [ds(4)]: { [App.UnionComponents]: [ds(2), ds(3), ds(1)] },
        });
        expect(site.entry(ds(1))).toStrictEqual({
            structure: App.UnionComponents, config: [], from: null, to: null });
        expect(site.entry(ds(4))).toStrictEqual({
            structure:  App.UnionComponents,
            config:     [ds(2), ds(3), ds(1)],
            from:       null,
            to:         null,
        });
        expect(site.index.invalid.size).toBe(0);
    });

    test("from and to are Dates that serialise as ISO strings with milliseconds", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-03-04T05:06:07.089Z",
                /* Stored without milliseconds, and with an offset. */
                to:     "2026-03-04T07:06:07+01:00",
            } },
            [ds(3)]: { [App.UnionComponents]: [ds(2)] },
        });
        for (const n of [2, 3]) {
            const entry = site.entry(ds(n));
            expect(entry.from).toBeInstanceOf(Date);
            expect(entry.to).toBeInstanceOf(Date);
            expect(JSON.stringify({ from: entry.from, to: entry.to })).toBe(
                '{"from":"2026-03-04T05:06:07.089Z",'
                + '"to":"2026-03-04T06:06:07.000Z"}');
        }
        /* The stored config is passed on as it was written. */
        expect(site.entry(ds(2)).config.to).toBe("2026-03-04T07:06:07+01:00");
    });

    test("a default dataset is in defaults, and an invalid one is not", () => {
        const dev = device(1);
        const dataset = default_dataset_uuid(dev);
        const site = new Site();
        site.load({
            [dataset]: { [App.UNSDevice]: { source: dev } },
            /* A UNS device dataset under another UUID is not a default. */
            [ds(1)]: { [App.UNSDevice]: { source: device(2) } },
            [ds(2)]: { [App.UNSDevice]: { source: dev } },
            [ds(3)]: { [App.UNSDeviceMetrics]: { source: dev } },
        });
        expect(imm.Map.isMap(site.index.defaults)).toBe(true);
        expect(site.index.defaults.toJS()).toEqual({ [dataset]: dev });
        const before = site.index.defaults;

        const dup = site.put(dataset, App.SparkplugSrc, {});
        expect(sorted(dup.changed)).toEqual([dataset]);
        expect(site.entry(dataset)).toStrictEqual(INVALID);
        expect(site.index.defaults.size).toBe(0);
        expect(dup.defaults).toBe(site.index.defaults);

        site.del(dataset, App.SparkplugSrc);
        expect(site.index.defaults.toJS()).toEqual({ [dataset]: dev });

        /* A default dataset that goes is no longer listed. */
        site.del(dataset, App.UNSDevice);
        expect(site.index.defaults.size).toBe(0);
        /* An earlier map is never changed in place. */
        expect(before.toJS()).toEqual({ [dataset]: dev });
    });

    test("a change to another dataset leaves the defaults map the same object", () => {
        const dev = device(1);
        const dataset = default_dataset_uuid(dev);
        const site = new Site();
        site.load({
            [dataset]: { [App.UNSDevice]: { source: dev } },
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: { source: ds(1) } },
        });
        const { defaults, valid, invalid } = site.index;

        site.put(ds(2), App.SessionLimits, {
            source: ds(1), from: "2026-01-01T00:00:00.000Z" });
        expect(site.index.defaults).toBe(defaults);
        expect(site.index.invalid).toBe(invalid);
        expect(site.index.valid).not.toBe(valid);
    });

    test("a null Session limits config gives one invalid dataset and does not throw", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: { a: 1 } },
            [ds(2)]: { [App.SessionLimits]: null },
            [ds(3)]: { [App.UnionComponents]: [ds(1), ds(2)] },
            [ds(4)]: { [App.SessionLimits]: { source: ds(3) } },
            [ds(5)]: { [App.SessionLimits]: { source: ds(1) } },
        });
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        /* Its referrers are invalid, directly and through a union. */
        expect(site.entry(ds(3))).toStrictEqual(INVALID);
        expect(site.entry(ds(4))).toStrictEqual(INVALID);
        /* Everything else resolves. */
        expect(site.is_valid(ds(1))).toBe(true);
        expect(site.is_valid(ds(5))).toBe(true);
        expect(sorted(site.index.invalid.keys()))
            .toEqual([ds(2), ds(3), ds(4)]);

        /* A config that can be read heals all three. */
        const healed = site.put(ds(2), App.SessionLimits, { source: ds(1) });
        expect(sorted(healed.changed)).toEqual([ds(2), ds(3), ds(4)]);
        expect(site.index.invalid.size).toBe(0);

        /* And a null written later breaks them again, without a throw. */
        const broken = site.put(ds(2), App.SessionLimits, null);
        expect(sorted(broken.changed)).toEqual([ds(2), ds(3), ds(4)]);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
    });

    test.each([
        ["an object", { not: "a list" }],
        ["a string", "not a list"],
        ["a number", 7],
        ["null", null],
    ])("a Union components config that is %s gives one invalid dataset and does not throw", (_, config) => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.UnionComponents]: config },
            [ds(3)]: { [App.SessionLimits]: { source: ds(2) } },
            [ds(4)]: { [App.UnionComponents]: [ds(1)] },
        });
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.entry(ds(3))).toStrictEqual(INVALID);
        expect(site.is_valid(ds(1))).toBe(true);
        expect(site.is_valid(ds(4))).toBe(true);
        expect(sorted(site.index.invalid.keys())).toEqual([ds(2), ds(3)]);

        const healed = site.put(ds(2), App.UnionComponents, [ds(1)]);
        expect(sorted(healed.changed)).toEqual([ds(2), ds(3)]);
        expect(site.index.invalid.size).toBe(0);
    });

    /* A config that cannot be read makes one dataset invalid. The
     * stack running out is a different thing: it is no fault of the
     * config where it happens, and which config that is depends on the
     * order the datasets are asked for. */
    test("a RangeError from a resolve is thrown, not turned into an invalid dataset", () => {
        const components = [ds(1)];
        components.map = () => { throw new RangeError("too deep"); };
        const index = new DatasetIndex();

        expect(() => index.apply(imm.Map({
            [ds(1)]: imm.Map({ [App.SparkplugSrc]: {} }),
            [ds(2)]: imm.Map({ [App.UnionComponents]: components }),
        }), null)).toThrow(RangeError);
    });

    test("a chain of references too deep to follow fails, as before", () => {
        const depth = 20_000;
        const chain = new Map([[ds(0), imm.Map({ [App.SparkplugSrc]: {} })]]);
        for (let i = 1; i <= depth; i++)
            chain.set(ds(i),
                imm.Map({ [App.SessionLimits]: { source: ds(i - 1) } }));
        const grouped = imm.Map(chain);

        expect(() => reference_datasets(grouped)).toThrow(RangeError);

        /* Ask for the top of the chain first, so the whole chain is on
         * the stack at once. */
        const top_first = [];
        for (let i = depth; i >= 0; i--) top_first.push(ds(i));
        const index = new DatasetIndex();
        index.apply(imm.Map(), null);
        expect(() => index.apply(grouped, top_first)).toThrow(RangeError);
        expect(index.entries.size).toBe(0);
    });

    test("a reference that is not a string is a missing reference", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.UnionComponents]: [ds(1), 7] },
            [ds(3)]: { [App.SessionLimits]: { source: { not: "a uuid" } } },
        });
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.entry(ds(3))).toStrictEqual(INVALID);
    });

    test("a date that cannot be read does not throw, and a union ignores it", () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: {} },
            [ds(2)]: { [App.SessionLimits]: {
                source: ds(1), from: "not a date", to: "2026-01-02T00:00:00.000Z" } },
            [ds(3)]: { [App.SessionLimits]: {
                source: ds(1), from: "2026-01-01T00:00:00.000Z" } },
            [ds(4)]: { [App.UnionComponents]: [ds(2), ds(3)] },
        });
        const bad = site.entry(ds(2));
        expect(bad.structure).toBe(App.SessionLimits);
        expect(bad.from).toBeInstanceOf(Date);
        expect(Number.isNaN(bad.from.getTime())).toBe(true);
        expect(bad.to).toStrictEqual(new Date("2026-01-02T00:00:00.000Z"));
        expect(site.entry(ds(4)).from)
            .toStrictEqual(new Date("2026-01-01T00:00:00.000Z"));

        /* Working it out again gives the same entry, so it is kept. */
        const before = site.entry(ds(2));
        expect(site.index.apply(site.defs, new Set([ds(2)]))).toBe(null);
        expect(site.entry(ds(2))).toBe(before);
    });
});

describe("DatasetIndex changes", () => {
    const small_site = () => {
        const site = new Site();
        site.load({
            [ds(1)]: { [App.SparkplugSrc]: { a: 1 } },
            [ds(2)]: { [App.SessionLimits]: {
                source: ds(1),
                from:   "2026-01-01T00:00:00.000Z",
                to:     "2026-01-10T00:00:00.000Z",
            } },
            [ds(3)]: { [App.UnionComponents]: [ds(2)] },
            [ds(4)]: { [App.SparkplugSubset]: { b: 2 } },
            [ds(5)]: { [UNKNOWN_APP]: {} },
        });
        return site;
    };

    test("a change that alters no entry returns null and keeps every entry", () => {
        const site = small_site();
        const before = new Map(site.index.entries);
        const maps = { ...site.index };

        /* The same content in a new object. */
        expect(site.put(ds(1), App.SparkplugSrc, { a: 1 })).toBe(null);
        expect(site.put(ds(2), App.SessionLimits, clone(site.entry(ds(2)).config)))
            .toBe(null);
        expect(site.put(ds(5), UNKNOWN_APP, { other: true })).toBe(null);

        for (const [id, entry] of before)
            expect(site.entry(id)).toBe(entry);
        for (const key of ["entries", "valid", "invalid", "defaults"])
            expect(site.index[key]).toBe(maps[key]);
    });

    test("a changed dataset is replaced and every other entry is the same object", () => {
        const site = small_site();
        const before = new Map(site.index.entries);

        const result = site.put(ds(4), App.SparkplugSubset, { b: 3 });
        expect(sorted(result.changed)).toEqual([ds(4)]);
        expect(site.entry(ds(4))).toStrictEqual({
            structure: App.SparkplugSubset, config: { b: 3 }, from: null, to: null });
        for (const [id, entry] of before)
            if (id != ds(4)) expect(site.entry(id)).toBe(entry);
    });

    test("a window edit reaches the datasets that refer to it, and only those", () => {
        const site = small_site();
        const before = new Map(site.index.entries);

        const result = site.put(ds(2), App.SessionLimits, {
            source: ds(1),
            from:   "2026-01-03T00:00:00.000Z",
            to:     "2026-01-10T00:00:00.000Z",
        });
        expect(sorted(result.changed)).toEqual([ds(2), ds(3)]);
        expect(site.entry(ds(3)).from)
            .toStrictEqual(new Date("2026-01-03T00:00:00.000Z"));
        expect(site.entry(ds(3)).to)
            .toStrictEqual(new Date("2026-01-10T00:00:00.000Z"));
        for (const id of [ds(1), ds(4), ds(5)])
            expect(site.entry(id)).toBe(before.get(id));
    });

    test("an edit below a session that does not move its window changes one entry", () => {
        const site = small_site();
        const before = new Map(site.index.entries);
        const resolved = site.index.stats.resolved;

        const result = site.put(ds(1), App.SparkplugSrc, { a: "edited" });
        expect(sorted(result.changed)).toEqual([ds(1)]);
        /* The session and the union were worked out again, and came
         * out the same. */
        expect(site.index.stats.resolved - resolved).toBe(3);
        expect(site.entry(ds(2))).toBe(before.get(ds(2)));
        expect(site.entry(ds(3))).toBe(before.get(ds(3)));
    });

    test("a delete of a dataset that a session refers to makes the session invalid", () => {
        const site = small_site();

        const result = site.del(ds(1), App.SparkplugSrc);
        expect(sorted(result.changed)).toEqual([ds(1), ds(2), ds(3)]);
        expect(site.index.entries.has(ds(1))).toBe(false);
        expect(site.entry(ds(2))).toStrictEqual(INVALID);
        expect(site.entry(ds(3))).toStrictEqual(INVALID);
    });

    test("apply with null looks at every dataset and keeps what did not change", () => {
        const site = small_site();
        const before = new Map(site.index.entries);
        const resolved = site.index.stats.resolved;

        expect(site.index.apply(site.defs, null)).toBe(null);
        expect(site.index.stats.resolved - resolved).toBe(5);
        for (const [id, entry] of before)
            expect(site.entry(id)).toBe(entry);

        /* A change the caller did not name is found. */
        site.defs = site.defs
            .set(ds(4), imm.Map({ [App.SparkplugSubset]: { b: "new" } }))
            .delete(ds(5))
            .set(ds(6), imm.Map({ [App.UnionComponents]: [ds(3)] }));
        const result = site.index.apply(site.defs, null);
        expect(sorted(result.changed)).toEqual([ds(4), ds(5), ds(6)]);
        expect(site.index.entries.has(ds(5))).toBe(false);
        expect(site.index.invalid.size).toBe(0);
        for (const id of [ds(1), ds(2), ds(3)])
            expect(site.entry(id)).toBe(before.get(id));
    });

    test("changed can be an array or a Set", () => {
        const site = small_site();
        site.defs = site.defs.set(ds(4), imm.Map({ [App.SparkplugSubset]: 1 }));
        expect(sorted(site.index.apply(site.defs, [ds(4)]).changed))
            .toEqual([ds(4)]);
        site.defs = site.defs.set(ds(4), imm.Map({ [App.SparkplugSubset]: 2 }));
        expect(sorted(site.index.apply(site.defs, new Set([ds(4)])).changed))
            .toEqual([ds(4)]);
    });

    test("an earlier result is never changed in place", () => {
        const site = small_site();
        const first = site.index.entries;
        const first_valid = site.index.valid;
        const snapshot = JSON.stringify([...first].sort());

        site.put(ds(4), App.SparkplugSubset, { b: 3 });
        site.del(ds(1), App.SparkplugSrc);
        site.put(ds(9), App.SparkplugSrc, {});
        expect(JSON.stringify([...first].sort())).toBe(snapshot);
        expect(first_valid.size).toBe(4);
        expect(first.get(ds(4)).config).toEqual({ b: 2 });
    });

    test("referrers_of gives the direct referrers, as a copy", () => {
        const site = small_site();
        expect(sorted(site.index.referrers_of(ds(1)))).toEqual([ds(2)]);
        expect(sorted(site.index.referrers_of(ds(2)))).toEqual([ds(3)]);
        expect(site.index.referrers_of(ds(3)).size).toBe(0);
        expect(site.index.referrers_of("no such dataset").size).toBe(0);

        const copy = site.index.referrers_of(ds(1));
        copy.add("something else");
        expect(sorted(site.index.referrers_of(ds(1)))).toEqual([ds(2)]);

        /* A dataset that stops referring to another is forgotten. */
        site.put(ds(2), App.SessionLimits, { source: ds(4) });
        expect(site.index.referrers_of(ds(1)).size).toBe(0);
        expect(sorted(site.index.referrers_of(ds(4)))).toEqual([ds(2)]);
    });

    test("nothing is held for a dataset that is gone", () => {
        const site = small_site();
        site.put(ds(6), App.SessionLimits, { source: ds(99) });
        for (const [id, defs] of [...site.defs])
            for (const app of defs.keys()) site.del(id, app);

        expect(site.index.entries.size).toBe(0);
        expect(site.index.windows.size).toBe(0);
        expect(site.index.refs.size).toBe(0);
        expect(site.index.referrers.size).toBe(0);
    });

    test("stats counts applies and resolves", () => {
        const index = new DatasetIndex();
        expect(index.stats).toEqual({ applies: 0, resolved: 0 });

        const defs = imm.Map({
            [ds(1)]: imm.Map({ [App.SparkplugSrc]: {} }),
            [ds(2)]: imm.Map({ [App.UnionComponents]: [ds(1)] }),
        });
        index.apply(defs, null);
        expect(index.stats).toEqual({ applies: 1, resolved: 2 });
        index.apply(defs, new Set());
        expect(index.stats).toEqual({ applies: 2, resolved: 2 });
        index.apply(defs, new Set([ds(2)]));
        expect(index.stats).toEqual({ applies: 3, resolved: 3 });
        index.apply(defs, new Set([ds(1)]));
        expect(index.stats).toEqual({ applies: 4, resolved: 5 });
    });
});

/*
 * The cost of one change. A site of `total` datasets is 70% default
 * UNS device datasets, 15% Sparkplug sources, 10% sessions and 5%
 * unions. Session i reads Sparkplug source i. Union j holds sessions
 * 2j and 2j+1, and unions 1 to 3 also hold the union before them, so
 * unions 0 to 3 are a chain 4 deep. The entries arrive through
 * AppConfigs, as they will from ConfigDB.
 */

const STRUCTURE_APPS = [
    App.SparkplugSrc, App.SparkplugSubset, App.UNSDevice,
    App.UNSDeviceMetrics, App.UnionComponents, App.SessionLimits,
];

const kind_uuid = (kind, n) => `c0570000-${kind}-4000-8000-${hex(n)}`;
const spark_uuid = n => kind_uuid("05a0", n);
const session_uuid = n => kind_uuid("05e0", n);
const union_uuid = n => kind_uuid("0c00", n);
const cost_device = n => kind_uuid("0de0", n);

const DAY = 24 * 60 * 60 * 1000;
const EPOCH = Date.UTC(2026, 0, 1);
const iso = ms => new Date(ms).toISOString();

class CostSite {
    constructor (total) {
        this.counts = {
            unions:     Math.floor(total * 0.05),
            sessions:   Math.floor(total * 0.10),
            sparks:     Math.floor(total * 0.15),
        };
        const { unions, sessions, sparks } = this.counts;
        this.counts.uns = total - unions - sessions - sparks;
        this.total = total;

        const apps = new Map(STRUCTURE_APPS.map(app => [app, new Map()]));
        for (let i = 0; i < this.counts.uns; i++) {
            const dev = cost_device(i);
            apps.get(App.UNSDevice)
                .set(default_dataset_uuid(dev), { source: dev });
        }
        for (let i = 0; i < sparks; i++)
            apps.get(App.SparkplugSrc)
                .set(spark_uuid(i), { node: `node-${i}`, device: `dev-${i}` });
        for (let i = 0; i < sessions; i++)
            apps.get(App.SessionLimits).set(session_uuid(i), {
                source: spark_uuid(i),
                from:   iso(EPOCH + i * DAY),
                to:     iso(EPOCH + (i + 2) * DAY),
            });
        for (let j = 0; j < unions; j++) {
            const parts = [session_uuid(2 * j), session_uuid(2 * j + 1)];
            if (j >= 1 && j <= 3) parts.push(union_uuid(j - 1));
            apps.get(App.UnionComponents).set(union_uuid(j), parts);
        }

        this.apps = new Map(
            [...apps].map(([app, entries]) => [app, imm.Map(entries)]));
        this.configs = new AppConfigs();
        this.index = new DatasetIndex();

        this.feed({
            set: imm.OrderedSet(STRUCTURE_APPS),
            added: STRUCTURE_APPS, removed: [],
        });
        for (const app of STRUCTURE_APPS)
            this.first = this.feed({ key: app, value: this.snapshot(app) });
    }

    /* Pass one event through both reducers. Null means the index was
     * not asked, or it found no difference. */
    feed (event) {
        const grouped = this.configs.apply(event);
        if (!grouped) return null;
        return this.index.apply(grouped.map, grouped.changed);
    }

    /* A full snapshot of an app with new body objects, as a resync. */
    snapshot (app) {
        const map = this.apps.get(app).map(clone);
        this.apps.set(app, map);
        return { map, child: null, previous: null };
    }

    put (app, id, config) {
        const previous = this.apps.get(app);
        const map = previous.set(id, config);
        this.apps.set(app, map);
        return this.feed({ key: app, value: { map, child: id, previous } });
    }

    /* How many of the entries held before are no longer the same
     * object, leaving out the ones named. */
    replaced (before, except) {
        let count = 0;
        for (const [id, entry] of before) {
            if (except.has(id)) continue;
            if (this.index.entries.get(id) !== entry) count++;
        }
        return count;
    }
}

describe.each([250, 1000, 4000])("DatasetIndex cost at %i datasets", total => {
    const site = new CostSite(total);
    const { index } = site;
    const { unions, sessions, sparks, uns } = site.counts;

    test("the site has the planned mix, all valid", () => {
        if (total == 1000)
            expect(site.counts).toEqual(
                { uns: 700, sparks: 150, sessions: 100, unions: 50 });
        expect(uns + sparks + sessions + unions).toBe(total);
        expect(site.first.changed.size).toBe(total);
        expect(index.entries.size).toBe(total);
        expect(index.valid.size).toBe(total);
        expect(index.invalid.size).toBe(0);
        expect(index.defaults.size).toBe(uns);
        /* The first build works out each dataset exactly once. */
        expect(index.stats).toEqual({ applies: 1, resolved: total });
        /* The top of the chain is 4 unions deep. */
        expect(sorted(index.referrers_of(union_uuid(2))))
            .toEqual([union_uuid(3)]);
    });

    test("adding one UNS device dataset resolves exactly 1", () => {
        const before = new Map(index.entries);
        const { resolved, applies } = index.stats;
        const dev = cost_device(1_000_000 + total);
        const dataset = default_dataset_uuid(dev);

        const result = site.put(App.UNSDevice, dataset, { source: dev });

        expect(index.stats.resolved - resolved).toBe(1);
        expect(index.stats.applies - applies).toBe(1);
        expect([...result.changed]).toEqual([dataset]);
        expect(index.entries.size).toBe(before.size + 1);
        expect(index.defaults.get(dataset)).toBe(dev);
        expect(site.replaced(before, new Set())).toBe(0);
    });

    test("editing a leaf under a session under a union resolves exactly 3", () => {
        const before = new Map(index.entries);
        const { resolved } = index.stats;
        /* The last union is not part of the chain. */
        const union = unions - 1;
        const session = 2 * union;
        const leaf = spark_uuid(session);
        expect(sorted(index.referrers_of(leaf))).toEqual([session_uuid(session)]);
        expect(sorted(index.referrers_of(session_uuid(session))))
            .toEqual([union_uuid(union)]);
        expect(index.referrers_of(union_uuid(union)).size).toBe(0);

        const result = site.put(App.SparkplugSrc, leaf,
            { node: "edited", device: "edited" });

        expect(index.stats.resolved - resolved).toBe(3);
        /* Only the leaf's own entry differs. */
        expect([...result.changed]).toEqual([leaf]);
        expect(site.replaced(before, new Set([leaf]))).toBe(0);
    });

    test("editing a session window resolves the session and its union", () => {
        const before = new Map(index.entries);
        const { resolved } = index.stats;
        const union = unions - 1;
        const session = session_uuid(2 * union + 1);

        const result = site.put(App.SessionLimits, session, {
            source: spark_uuid(2 * union + 1),
            from:   iso(EPOCH),
            to:     iso(EPOCH + 10_000 * DAY),
        });

        expect(index.stats.resolved - resolved).toBe(2);
        const expected = new Set([session, union_uuid(union)]);
        expect(sorted(result.changed)).toEqual(sorted(expected));
        expect(index.entries.get(union_uuid(union)).to)
            .toStrictEqual(new Date(EPOCH + 10_000 * DAY));
        expect(site.replaced(before, expected)).toBe(0);
    });

    test("editing a leaf under the 4-deep chain resolves the leaf, its session and 4 unions", () => {
        const before = new Map(index.entries);
        const { resolved } = index.stats;
        const leaf = spark_uuid(0);

        const result = site.put(App.SparkplugSrc, leaf, { node: "edited" });

        expect(index.stats.resolved - resolved).toBe(6);
        expect([...result.changed]).toEqual([leaf]);
        expect(site.replaced(before, new Set([leaf]))).toBe(0);
    });

    test("an identical resync of every app resolves 0", () => {
        const before = new Map(index.entries);
        const maps = [index.entries, index.valid, index.invalid, index.defaults];
        const stats = { ...index.stats };

        for (const app of STRUCTURE_APPS)
            expect(site.feed({ key: app, value: site.snapshot(app) }))
                .toBe(null);

        /* The index was not even asked. */
        expect(index.stats).toEqual(stats);
        expect(site.replaced(before, new Set())).toBe(0);
        expect([index.entries, index.valid, index.invalid, index.defaults]
            .every((map, i) => map === maps[i])).toBe(true);
    });

    test("a resync that differs in 2 datasets resolves only what they reach", () => {
        const before = new Map(index.entries);
        const { resolved } = index.stats;
        /* A dataset nothing refers to, and a session under the last
         * union. Both change while no notification arrives. */
        const dev = cost_device(3);
        const lone = default_dataset_uuid(dev);
        const union = unions - 1;
        const session = session_uuid(2 * union);
        site.apps.set(App.UNSDevice,
            site.apps.get(App.UNSDevice).delete(lone));
        site.apps.set(App.SessionLimits,
            site.apps.get(App.SessionLimits).set(session, {
                source: spark_uuid(2 * union),
                from:   iso(EPOCH - 5 * DAY),
                to:     iso(EPOCH + 20_000 * DAY),
            }));

        let changed = new Set();
        for (const app of STRUCTURE_APPS) {
            const result = site.feed({ key: app, value: site.snapshot(app) });
            if (result) changed = new Set([...changed, ...result.changed]);
        }

        /* The session and its union. The deleted dataset needs none. */
        expect(index.stats.resolved - resolved).toBe(2);
        const expected = new Set([lone, session, union_uuid(union)]);
        expect(sorted(changed)).toEqual(sorted(expected));
        expect(index.entries.has(lone)).toBe(false);
        expect(index.defaults.has(lone)).toBe(false);
        expect(site.replaced(before, expected)).toBe(0);
    });
});
