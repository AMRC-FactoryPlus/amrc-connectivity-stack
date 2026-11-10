/*
 * ACS Data Access Service
 * DataFlow: what one change costs, and that the streams stay connected
 * Copyright 2026 University of Sheffield
 */

/* The golden tests show the DataFlow streams hold the same content as
 * before. These show what the content costs: which streams emit after
 * one change, how many datasets are worked out again, and which
 * ConfigDB subscriptions are opened. The counts are exact, and most of
 * them are taken on a site of 1,000 datasets.
 *
 * They run against fakes, so they need no cluster. */

import * as imm from "immutable";
import * as rx from "rxjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { golden } from "../support/scenario.js";
import {
    FUNCTIONAL_GROUPS, METADATA_APPS, STRUCTURE_APPS, build_site, prng,
    site_datasets,
} from "../support/site-builder.js";

const { App, Class, Group, Kind, Metadata, Special } = Constants;
const { Info } = UUIDs.App;

const debug = { bound: () => () => {} };

const STREAMS = [
    "datasets", "valid_datasets", "invalid_datasets", "default_devices",
    "general_infos", "metadata", "functional_types", "parts",
];

const INVALID = {
    structure: Special.InvalidDataset, config: null, from: null, to: null,
};

/* A structure application no built site has. */
const SEVENTH_APP = "5eedab1e-0aaa-4000-8000-000000000007";

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
    vi.useRealTimers();
});

/* Subscribe to every public stream. `counts` holds the emissions of
 * each since the last reset, `latest` the newest value and `errors`
 * the errors. */
function observe (data, names = STREAMS) {
    const seen = { counts: {}, latest: {}, errors: [] };
    seen.reset = () => {
        for (const name of names) seen.counts[name] = 0;
    };
    seen.reset();
    const subs = names.map(name => data[name].subscribe({
        next (value) {
            seen.counts[name]++;
            seen.latest[name] = value;
        },
        error (err) { seen.errors.push([name, err]); },
    }));
    cleanup.push(() => subs.forEach(sub => sub.unsubscribe()));
    return seen;
}

const no_emissions = Object.fromEntries(STREAMS.map(name => [name, 0]));

/* A built site, a running DataFlow over it and an observer of every
 * public stream, settled, with every count at zero. */
async function fixture (opts, { run = true, site: site_opts } = {}) {
    const site = make_site(site_opts);
    const built = build_site(site, opts);
    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    cleanup.push(() => {
        data.stop();
        site.close();
    });
    if (run) data.run();
    const seen = observe(data);
    await site.settle();
    expect(seen.errors).toEqual([]);
    seen.reset();
    site.reset_counters();
    return { site, built, data, seen };
}

/* Half the datasets are default datasets, and a few placed devices
 * have none yet. */
const LARGE = { datasets: 1000, devices: 510, infos: 2000 };

/* The datasets given and every dataset that reads one of them, through
 * any number of others, from the site's stored configs. */
function readers_closure (site, ids) {
    const reads = () => [
        ...[...site.app(App.SessionLimits)]
            .map(([id, config]) => [id, [config?.source]]),
        ...[...site.app(App.UnionComponents)]
            .map(([id, config]) => [id, Array.isArray(config) ? config : []]),
    ];
    const out = new Set(ids);
    for (let grew = true; grew;) {
        grew = false;
        for (const [id, sources] of reads()) {
            if (out.has(id) || !sources.some(s => out.has(s))) continue;
            out.add(id);
            grew = true;
        }
    }
    return out;
}

/* The keys whose value is not the same object in two maps. */
function replaced (before, after) {
    const keys = new Set([...before.keys(), ...after.keys()]);
    return [...keys].filter(key => before.get(key) !== after.get(key)).sort();
}

const sorted = list => [...list].sort();
const sorted_entries = map => [...map.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

describe("one change on a site of 1,000 datasets", () => {
    /* The same counts on a smaller and on a larger site: the cost does
     * not follow the size. */
    test.each([250, 1000, 4000])("a new default dataset on a site of %i is the only dataset worked out, and the only new entry", async n => {
        const fx = await fixture({
            datasets: n, devices: n / 2 + 10, infos: 2 * n, seed: 41 });
        const { site, data, seen } = fx;
        const before = { ...seen.latest };
        expect(before.datasets.size).toBe(n);
        const resolved = data.index.stats.resolved;

        const device = fx.built.spare_devices[0];
        const dataset = default_dataset_uuid(device);
        site.put(App.UNSDevice, dataset, { source: device });
        await site.settle();

        expect(seen.counts).toEqual({
            ...no_emissions,
            datasets: 1, valid_datasets: 1, default_devices: 1,
        });
        expect(data.index.stats.resolved - resolved).toBe(1);
        expect(seen.latest.datasets.size).toBe(n + 1);
        expect(replaced(before.datasets, seen.latest.datasets)).toEqual([dataset]);
        expect(replaced(before.valid_datasets, seen.latest.valid_datasets))
            .toEqual([dataset]);
        expect(seen.latest.default_devices.get(dataset)).toBe(device);
        expect(seen.latest.default_devices.size)
            .toBe(before.default_devices.size + 1);
        /* Nothing was subscribed again to get there. */
        expect(site.report()).toMatchObject({
            search_subscribes: 0, member_subscribes: 0, subclass_subscribes: 0,
        });
    });

    test("an edit to a session gives no default_devices and no invalid_datasets emission", async () => {
        const fx = await fixture({ ...LARGE, seed: 42 });
        const { site, data, seen } = fx;
        const before = seen.latest.datasets;
        const resolved = data.index.stats.resolved;

        /* The last session made: nothing reads it. */
        const session = fx.built.kinds.sessions.at(-1);
        expect(readers_closure(site, [session]).size).toBe(1);
        site.put(App.SessionLimits, session, {
            ...site.app(App.SessionLimits).get(session),
            to: "2027-06-01T00:00:00.000Z",
        });
        await site.settle();

        expect(seen.counts).toEqual({
            ...no_emissions, datasets: 1, valid_datasets: 1,
        });
        expect(data.index.stats.resolved - resolved).toBe(1);
        expect(replaced(before, seen.latest.datasets)).toEqual([session]);
        expect(seen.latest.datasets.get(session).to)
            .toEqual(new Date("2027-06-01T00:00:00.000Z"));
    });

    test("an edit to a dataset others read works out that dataset and its readers, and no other", async () => {
        const fx = await fixture({ ...LARGE, seed: 43 });
        const { site, data, seen } = fx;
        const before = seen.latest.datasets;
        const resolved = data.index.stats.resolved;

        /* The first session is a component of the third union of the
         * chain, which the fourth contains. */
        const session = fx.built.kinds.sessions[0];
        const closure = readers_closure(site, [session]);
        expect(closure.size).toBeGreaterThanOrEqual(3);
        expect(closure.size).toBeLessThan(100);

        site.put(App.SessionLimits, session, {
            source: site.app(App.SessionLimits).get(session).source,
            from: "2020-01-01T00:00:00.000Z",
            to: "2040-01-01T00:00:00.000Z",
        });
        await site.settle();

        expect(data.index.stats.resolved - resolved).toBe(closure.size);
        expect(seen.counts).toEqual({
            ...no_emissions, datasets: 1, valid_datasets: 1,
        });
        /* Only a reader can have a new entry, and the session has. */
        const changed = replaced(before, seen.latest.datasets);
        expect(changed).toContain(session);
        for (const uuid of changed)
            expect(closure.has(uuid)).toBe(true);
        expect(golden(seen.latest.datasets)).toEqual(golden(site_datasets(site)));
    });

    test("a put to a dataset that stays invalid gives no emission at all", async () => {
        const fx = await fixture({ ...LARGE, seed: 44 });
        const { site, seen } = fx;

        /* A second definition makes it invalid. */
        const broken = fx.built.kinds.sparkplug[1];
        site.put(App.UnionComponents, broken, []);
        await site.settle();
        expect(seen.counts.invalid_datasets).toBe(1);
        expect(seen.latest.invalid_datasets.get(broken)).toEqual(INVALID);
        const invalid = seen.latest.invalid_datasets;
        seen.reset();

        /* A change to either definition leaves it invalid. */
        site.put(App.UnionComponents, broken, [fx.built.kinds.sparkplug[2]]);
        site.put(App.SparkplugSrc, broken, { source: fx.built.devices[0] });
        await site.settle();

        expect(seen.counts).toEqual(no_emissions);
        expect(seen.latest.invalid_datasets).toBe(invalid);

        /* It is valid again when the second definition goes. */
        site.del(App.UnionComponents, broken);
        await site.settle();
        expect(seen.counts).toMatchObject({
            datasets: 1, valid_datasets: 1, invalid_datasets: 1, default_devices: 0,
        });
        expect(seen.latest.valid_datasets.get(broken)).toEqual({
            structure: App.SparkplugSrc,
            config: { source: fx.built.devices[0] },
            from: null, to: null,
        });
    });

    test("a metadata put gives one emission of metadata, and no other inner map is new", async () => {
        const fx = await fixture({ ...LARGE, seed: 45 });
        const { site, data, seen } = fx;
        const before = seen.latest.metadata;
        const resolved = data.index.stats.resolved;

        const changes = [];
        const sub = data.metadata_changes.subscribe(c => changes.push(c.changed));
        cleanup.push(() => sub.unsubscribe());

        const dataset = fx.built.kinds.sessions[0];
        site.put(Metadata.Tags, dataset, { tags: ["changed"] });
        await site.settle();

        expect(seen.counts).toEqual({ ...no_emissions, metadata: 1 });
        expect(data.index.stats.resolved - resolved).toBe(0);
        expect(replaced(before, seen.latest.metadata)).toEqual([dataset]);
        expect(seen.latest.metadata.get(dataset).get(Metadata.Tags))
            .toEqual({ tags: ["changed"] });
        /* After the value replayed to this late subscriber. */
        expect(changes.slice(1)).toEqual([new Set([dataset])]);
    });

    test("a name gives one emission of general_infos and works out no dataset", async () => {
        const fx = await fixture({ ...LARGE, seed: 46 });
        const { site, data, seen } = fx;
        const before = seen.latest.general_infos;
        const resolved = data.index.stats.resolved;

        const changes = [];
        const sub = data.info_changes.subscribe(c => changes.push(c.changed));
        cleanup.push(() => sub.unsubscribe());

        const dataset = fx.built.kinds.sparkplug[0];
        site.put(Info, dataset, { name: "Renamed" });
        /* An object that is not a dataset costs the same. */
        site.put(Info, fx.built.fillers[0], { name: "Also renamed" });
        await site.settle();

        expect(seen.counts).toEqual({ ...no_emissions, general_infos: 2 });
        expect(data.index.stats.resolved - resolved).toBe(0);
        expect(replaced(before, seen.latest.general_infos))
            .toEqual(sorted([dataset, fx.built.fillers[0]]));
        expect(changes.slice(1)).toEqual([
            new Set([dataset]), new Set([fx.built.fillers[0]]),
        ]);
    });

    test("a functional type gives one emission, and every other dataset keeps its list", async () => {
        const fx = await fixture({ ...LARGE, seed: 47 });
        const { site, data, seen } = fx;
        const before = seen.latest.functional_types;

        const changes = [];
        const sub = data.functional_changes.subscribe(c => changes.push(c.changed));
        cleanup.push(() => sub.unsubscribe());

        /* A session that is a Run already, so its list grows to two. */
        const dataset = fx.built.kinds.sessions[0];
        expect(before.get(dataset).toArray()).toEqual([Kind.Run]);
        site.add_member(Kind.Operation, dataset);
        await site.settle();

        expect(seen.counts).toEqual({ ...no_emissions, functional_types: 1 });
        expect(replaced(before, seen.latest.functional_types)).toEqual([dataset]);
        expect(sorted(seen.latest.functional_types.get(dataset)))
            .toEqual(sorted([Kind.Run, Kind.Operation]));

        const middle = seen.latest.functional_types;
        site.remove_member(Kind.Run, dataset);
        site.remove_member(Kind.Operation, dataset);
        await site.settle();
        expect(seen.latest.functional_types.has(dataset)).toBe(false);
        expect(replaced(middle, seen.latest.functional_types)).toEqual([dataset]);

        expect(changes.slice(1)).toEqual([
            new Set([dataset]), new Set([dataset]), new Set([dataset]),
        ]);
    });

    test("a reconnect that brings the same content gives no emission and works out no dataset", async () => {
        const fx = await fixture({ ...LARGE, seed: 48 });
        const { site, data, seen } = fx;
        const before = { ...seen.latest };
        const { index } = data;
        const resolved = index.stats.resolved;

        /* Every source sends its whole content again, as new objects. */
        for (const app of [...STRUCTURE_APPS, ...METADATA_APPS, Info])
            site.resync(app);
        for (const klass of [
            App.DatasetDefinition, App.DatasetMetadata,
            Group.FunctionalDatasetGroup, ...FUNCTIONAL_GROUPS, Class.Dataset,
        ])
            site.resync_relation("member", klass);
        await site.settle();

        expect(site.counters.notifications).toBeGreaterThan(12);
        expect(seen.errors).toEqual([]);
        expect(seen.counts).toEqual(no_emissions);
        expect(data.index).toBe(index);
        expect(index.stats.resolved - resolved).toBe(0);
        for (const name of STREAMS)
            expect([name, seen.latest[name] === before[name]]).toEqual([name, true]);
        expect(site.report()).toMatchObject({
            search_subscribes: 0, member_subscribes: 0, subclass_subscribes: 0,
        });
    });

    test("a reconnect where two datasets differ works out only those two and their readers", async () => {
        const fx = await fixture({ ...LARGE, seed: 49 });
        const { site, data, seen } = fx;
        const before = seen.latest.datasets;
        const resolved = data.index.stats.resolved;

        /* Two changes Data Access was not told of while it was away. */
        const session = fx.built.kinds.sessions.at(-1);
        const leaf = fx.built.kinds.sparkplug[0];
        site.app(App.SessionLimits).set(session, {
            ...site.app(App.SessionLimits).get(session),
            to: "2027-06-01T00:00:00.000Z",
        });
        site.app(App.SparkplugSrc).set(leaf, { source: fx.built.devices.at(-1) });
        const closures = readers_closure(site, [session]).size
            + readers_closure(site, [leaf]).size;

        for (const app of [...STRUCTURE_APPS, ...METADATA_APPS, Info])
            site.resync(app);
        await site.settle();

        /* One emission for each application whose content differs. */
        expect(seen.counts).toEqual({
            ...no_emissions, datasets: 2, valid_datasets: 2,
        });
        expect(data.index.stats.resolved - resolved).toBe(closures);
        expect(closures).toBeLessThan(100);
        expect(replaced(before, seen.latest.datasets))
            .toEqual(sorted([session, leaf]));
        expect(golden(seen.latest.datasets)).toEqual(golden(site_datasets(site)));
    });
});

describe("the set of structure applications", () => {
    test("a seventh application opens one SEARCH, and nothing is emitted until it answers", async () => {
        const fx = await fixture({ ...LARGE, seed: 51 });
        const { site, seen } = fx;
        const before = seen.latest.datasets;

        site.hold("app", SEVENTH_APP);
        site.put(SEVENTH_APP, fx.built.spare(1), { anything: true });
        site.add_member(App.DatasetDefinition, SEVENTH_APP);
        await site.settle();

        /* One new SEARCH. The other six are not subscribed again. */
        expect([...site.counters.search]).toEqual([[SEVENTH_APP, 1]]);
        expect(seen.counts).toEqual(no_emissions);

        /* A change to another application waits too. */
        const device = fx.built.spare_devices[0];
        const dataset = default_dataset_uuid(device);
        site.put(App.UNSDevice, dataset, { source: device });
        await site.settle();
        expect(seen.counts).toEqual(no_emissions);

        site.release("app", SEVENTH_APP);
        await site.settle();

        expect(seen.counts).toEqual({
            ...no_emissions,
            datasets: 1, valid_datasets: 1, invalid_datasets: 1, default_devices: 1,
        });
        expect([...site.counters.search]).toEqual([[SEVENTH_APP, 1]]);
        /* Data Access does not know the new structure, so its dataset
         * is invalid. Every entry that was there is the same object. */
        expect(seen.latest.datasets.get(fx.built.spare(1))).toEqual(INVALID);
        expect(seen.latest.datasets.get(dataset)).toEqual({
            structure: App.UNSDevice, config: { source: device },
            from: null, to: null,
        });
        expect(replaced(before, seen.latest.datasets))
            .toEqual(sorted([dataset, fx.built.spare(1)]));

        /* Taking it away removes its dataset and opens nothing. */
        seen.reset();
        site.remove_member(App.DatasetDefinition, SEVENTH_APP);
        await site.settle();
        expect(seen.latest.datasets.has(fx.built.spare(1))).toBe(false);
        expect(seen.latest.datasets.size).toBe(1001);
        expect(seen.counts).toEqual({
            ...no_emissions, datasets: 1, invalid_datasets: 1,
        });
        expect([...site.counters.search]).toEqual([[SEVENTH_APP, 1]]);
        expect(site.subs.app.has(SEVENTH_APP)).toBe(false);
    });

    test("the first dataset map waits until every structure application has answered", async () => {
        const site = make_site();
        build_site(site, { datasets: 60, seed: 52 });
        site.hold("app", App.SessionLimits);
        const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
        cleanup.push(() => {
            data.stop();
            site.close();
        });
        data.run();
        const seen = observe(data);
        await site.settle();

        /* Five of six have answered. A map made now would be missing
         * every session, and the maker would take the map for whole. */
        expect(site.counters.search.total()).toBe(6 + METADATA_APPS.length + 1);
        expect(seen.counts).toMatchObject({
            datasets: 0, valid_datasets: 0, invalid_datasets: 0, default_devices: 0,
        });
        expect(seen.counts.general_infos).toBe(1);

        site.release("app", App.SessionLimits);
        await site.settle();

        expect(seen.counts).toMatchObject({
            datasets: 1, valid_datasets: 1, invalid_datasets: 1, default_devices: 1,
        });
        expect(seen.latest.datasets.size).toBe(60);
        expect(seen.latest.invalid_datasets.size).toBe(0);
        expect(golden(seen.latest.datasets)).toEqual(golden(site_datasets(site)));
    });

    test("the set goes empty and comes back: the dataset map goes empty, then returns whole", async () => {
        const fx = await fixture({ datasets: 200, seed: 53 });
        const { site, seen } = fx;
        const before = golden(seen.latest.datasets);
        const defaults = golden(seen.latest.default_devices);
        expect(seen.latest.datasets.size).toBe(200);

        /* One message with an empty list, as ConfigDB sends while the
         * class cannot be read. */
        site._relate("member", App.DatasetDefinition, set => set.clear());
        await site.settle();

        expect(seen.counts).toEqual({
            ...no_emissions,
            datasets: 1, valid_datasets: 1, default_devices: 1,
        });
        expect(seen.latest.datasets.size).toBe(0);
        expect(seen.latest.valid_datasets.size).toBe(0);
        expect(seen.latest.default_devices.size).toBe(0);
        expect(site.subs.app.size).toBe(METADATA_APPS.length + 1);

        seen.reset();
        site._relate("member", App.DatasetDefinition, set => {
            for (const app of STRUCTURE_APPS) set.add(app);
        });
        await site.settle();

        expect(seen.counts).toEqual({
            ...no_emissions,
            datasets: 1, valid_datasets: 1, default_devices: 1,
        });
        expect(golden(seen.latest.datasets)).toEqual(before);
        expect(golden(seen.latest.valid_datasets)).toEqual(before);
        expect(golden(seen.latest.default_devices)).toEqual(defaults);
        expect(seen.errors).toEqual([]);
    });
});

describe("default_devices", () => {
    test("is an Immutable Map with the entries _build_default_devices gives, after every step of a random walk", async () => {
        const fx = await fixture({ datasets: 120, devices: 80, placed: 70, seed: 54 });
        const { site, data, seen, built } = fx;
        const rand = prng(540);
        const pick = list => list[Math.floor(rand() * list.length)];

        let whole;
        const sub = data._build_default_devices().subscribe(v => { whole = v; });
        cleanup.push(() => sub.unsubscribe());

        const check = () => {
            expect(imm.Map.isMap(seen.latest.default_devices)).toBe(true);
            expect(whole).toBeInstanceOf(Map);
            expect(sorted_entries(seen.latest.default_devices))
                .toEqual(sorted_entries(whole));
        };
        check();
        expect(whole.size).toBe(built.defaults.length);

        const default_of = device => default_dataset_uuid(device);
        const steps = [
            /* Make the default dataset of a placed device. */
            () => {
                const device = pick(built.placed);
                site.put(App.UNSDevice, default_of(device), { source: device });
            },
            /* Delete one. */
            () => site.del(App.UNSDevice, default_of(pick(built.placed))),
            /* Point one at another device: no longer a default. */
            () => site.put(App.UNSDevice, default_of(pick(built.placed)),
                { source: pick(built.devices) }),
            /* A second definition makes one invalid, then goes. */
            () => site.put(App.UnionComponents, default_of(pick(built.placed)), []),
            () => site.del(App.UnionComponents, default_of(pick(built.placed))),
            /* A UNS device dataset that is nobody's default. */
            () => site.put(App.UNSDevice, built.spare(Math.floor(rand() * 5)),
                { source: pick(built.devices) }),
            /* A config that is not a device at all. */
            () => site.put(App.UNSDevice, default_of(pick(built.placed)),
                { source: 7 }),
            /* A change that has nothing to do with defaults. */
            () => site.put(App.SessionLimits, pick(built.kinds.sessions), {
                source: pick(built.kinds.sparkplug),
                from: "2026-02-01T00:00:00.000Z",
            }),
        ];

        const sizes = new Set();
        for (let i = 0; i < 160; i++) {
            pick(steps)();
            await site.settle();
            check();
            sizes.add(whole.size);
        }
        /* The walk moved the map both ways. */
        expect(sizes.size).toBeGreaterThan(3);
        expect(seen.errors).toEqual([]);
    });
});

describe("a DataFlow over sources that complete", () => {
    test("every stream still answers", async () => {
        const dataset = "5eedab1e-0bbb-4000-8000-000000000001";
        const device = "5eedab1e-0bbb-4000-8000-000000000002";
        const apps = {
            [App.SparkplugSrc]: imm.Map([[dataset, { source: device }]]),
            [Metadata.Tags]: imm.Map([[dataset, { tags: ["x"] }]]),
            [Info]: imm.Map([[dataset, { name: "One" }]]),
        };
        const cdb = {
            watch_members: klass => rx.of(imm.Set(
                klass == App.DatasetDefinition ? [App.SparkplugSrc]
                : klass == App.DatasetMetadata ? [Metadata.Tags]
                : [])),
            watch_member_members: () => rx.of(
                imm.Map([[Kind.Run, imm.Set([dataset])]])),
            watch_members_subclasses: () => rx.of(imm.Map()),
            search_app_changes: app => rx.of({
                map: apps[app] ?? imm.Map(), child: null, previous: null,
            }),
        };
        const data = new DataFlow({ debug, cdb, auth: {} });
        data.run();
        cleanup.push(() => data.stop());

        const entry = {
            structure: App.SparkplugSrc, config: { source: device },
            from: null, to: null,
        };
        const read = name => rx.firstValueFrom(data[name]);
        expect((await read("datasets")).toJS()).toEqual({ [dataset]: entry });
        expect((await read("valid_datasets")).toJS()).toEqual({ [dataset]: entry });
        expect((await read("invalid_datasets")).size).toBe(0);
        expect((await read("default_devices")).size).toBe(0);
        expect((await read("general_infos")).toJS())
            .toEqual({ [dataset]: { name: "One" } });
        expect((await read("metadata")).toJS())
            .toEqual({ [dataset]: { [Metadata.Tags]: { tags: ["x"] } } });
        expect((await read("functional_types")).toJS())
            .toEqual({ [dataset]: [Kind.Run] });
    });
});

describe("a subscriber that joins late", () => {
    test("gets the latest value of each change sequence, whole", async () => {
        const fx = await fixture({ datasets: 60, seed: 55 });
        const { site, data } = fx;

        /* A change, so the value held names one changed key. */
        site.put(Info, fx.built.kinds.sparkplug[0], { name: "Renamed" });
        site.put(App.SparkplugSrc, fx.built.kinds.sparkplug[0],
            { source: fx.built.devices[0] });
        await site.settle();

        const changes = await rx.firstValueFrom(data.changes);
        expect(Object.keys(changes))
            .toEqual(["datasets", "valid", "invalid", "defaults", "changed"]);
        expect(changes.datasets.size).toBe(60);
        expect(changes.valid.size).toBe(60);
        expect(changes.datasets).toBe(await rx.firstValueFrom(data.datasets));

        for (const name of ["info_changes", "metadata_changes", "functional_changes"]) {
            const value = await rx.firstValueFrom(data[name]);
            expect([name, Object.keys(value)]).toEqual([name, ["map", "changed"]]);
            expect(imm.Map.isMap(value.map)).toBe(true);
        }
        expect((await rx.firstValueFrom(data.info_changes)).map)
            .toBe(await rx.firstValueFrom(data.general_infos));
        expect(site.counters.search.total()).toBe(0);
    });
});

describe("errors and reconnects", () => {
    const structure_searches = site => STRUCTURE_APPS
        .map(app => site.counters.search.get(app) ?? 0);

    test("a failed structure application errors the dataset streams once, and run() connects again", async () => {
        vi.useFakeTimers();
        const fx = await fixture({ datasets: 60, seed: 61 });
        const { site, data, seen } = fx;
        const first = data.index;

        site.error("app", App.SessionLimits, new Error("search failed"));
        await site.settle();

        /* Every dataset stream fails once. The others carry on. */
        expect(seen.errors.map(([name, err]) => [name, err.message]).sort()).toEqual([
            ["datasets", "search failed"],
            ["default_devices", "search failed"],
            ["invalid_datasets", "search failed"],
            ["valid_datasets", "search failed"],
        ]);
        /* The failure closed the other five searches too. Nothing has
         * asked again yet. */
        expect(structure_searches(site)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(STRUCTURE_APPS.filter(app => site.subs.app.has(app))).toEqual([]);

        /* run() asks again after its retry delay, with no client. */
        await vi.advanceTimersByTimeAsync(4900);
        expect(structure_searches(site)).toEqual([0, 0, 0, 0, 0, 0]);
        await vi.advanceTimersByTimeAsync(200);
        await site.settle();
        expect(structure_searches(site)).toEqual([1, 1, 1, 1, 1, 1]);

        /* It starts from a new index, and a read needs no new search. */
        expect(data.index).not.toBe(first);
        const datasets = await rx.firstValueFrom(data.datasets);
        expect(golden(datasets)).toEqual(golden(site_datasets(site)));
        expect(structure_searches(site)).toEqual([1, 1, 1, 1, 1, 1]);
        expect(site.counters.search.total()).toBe(6);
    });

    test("a read straight after a failure connects again itself, as it always has", async () => {
        const fx = await fixture({ datasets: 60, seed: 62 }, { run: false });
        const { site, data, seen } = fx;

        site.error("app", App.UnionComponents, new Error("search failed"));
        expect(seen.errors).toHaveLength(4);

        const datasets = await rx.firstValueFrom(data.datasets);
        expect(golden(datasets)).toEqual(golden(site_datasets(site)));
        expect(structure_searches(site)).toEqual([1, 1, 1, 1, 1, 1]);
    });

    test.each([
        ["General information", "general_infos",
            site => site.error("app", Info, new Error("gone"))],
        ["a metadata application", "metadata",
            site => site.error("app", Metadata.Tags, new Error("gone"))],
        ["the functional groups", "functional_types",
            site => site.error("member", Group.FunctionalDatasetGroup, new Error("gone"))],
    ])("a failure of %s errors only its own stream, and run() connects again", async (_, name, fail) => {
        vi.useFakeTimers();
        const fx = await fixture({ datasets: 60, seed: 63 });
        const { site, data, seen } = fx;
        const before = golden(seen.latest[name]);

        fail(site);
        await site.settle();
        expect(seen.errors.map(([stream, err]) => [stream, err.message]))
            .toEqual([[name, "gone"]]);

        await vi.advanceTimersByTimeAsync(5100);
        await site.settle();
        site.reset_counters();

        expect(golden(await rx.firstValueFrom(data[name]))).toEqual(before);
        expect(site.report()).toMatchObject({
            search_subscribes: 0, member_subscribes: 0,
        });
    });

    test("after run(), a request after two idle seconds opens no SEARCH and no WATCH", async () => {
        vi.useFakeTimers();
        const site = make_site();
        const built = build_site(site, { datasets: 60, seed: 64 });
        const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
        cleanup.push(() => {
            data.stop();
            site.close();
        });
        data.run();
        await site.settle();
        const opened = site.report();
        expect(opened.search_subscribes).toBe(6 + METADATA_APPS.length + 1);

        /* Longer than a shared stream keeps its source with nobody
         * subscribed. */
        await vi.advanceTimersByTimeAsync(2000);
        site.reset_counters();

        const api = new APIv1({ data, debug, auth: site.auth, cdb: site.cdb });
        const make_res = () => ({
            status (code) { this.code = code; return this; },
            json (body) { this.body = body; return this; },
        });
        const list = make_res();
        await api.metadata_list({ auth: ROOT }, list);
        expect(list.code).toBe(200);
        expect(list.body.toArray()).toHaveLength(60);
        const one = make_res();
        await api.structure_uuid(
            { auth: ROOT, params: { uuid: built.kinds.sessions[0] } }, one);
        expect(one.code).toBe(200);

        for (const name of STREAMS.filter(s => s != "parts")) {
            const value = await rx.firstValueFrom(data[name]);
            expect([name, imm.Map.isMap(value)]).toEqual([name, true]);
        }

        expect(site.report()).toMatchObject({
            search_subscribes: 0, member_subscribes: 0, member_watches: 0,
            subclass_subscribes: 0, notifications: 0,
        });
    });

    test("without run(), the same request connects to ConfigDB again", async () => {
        vi.useFakeTimers();
        const site = make_site();
        build_site(site, { datasets: 60, seed: 64 });
        const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
        cleanup.push(() => site.close());

        expect((await rx.firstValueFrom(data.datasets)).size).toBe(60);
        expect(site.counters.search.total()).toBe(6);
        await vi.advanceTimersByTimeAsync(2000);
        expect(site.subs.app.size).toBe(0);

        expect((await rx.firstValueFrom(data.datasets)).size).toBe(60);
        expect(site.counters.search.total()).toBe(12);
        await vi.advanceTimersByTimeAsync(2000);
    });

    test("run() twice subscribes once, and stop() lets the sources go", async () => {
        vi.useFakeTimers();
        const site = make_site();
        build_site(site, { datasets: 60, seed: 65 });
        const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
        cleanup.push(() => {
            data.stop();
            site.close();
        });

        /* Building it asks ConfigDB for nothing. */
        expect(site.open_subscriptions()).toBe(0);
        expect(site.report()).toMatchObject({
            search_subscribes: 0, member_subscribes: 0, calls: 0,
        });

        data.run();
        data.run();
        await site.settle();
        expect(site.counters.search.total()).toBe(6 + METADATA_APPS.length + 1);
        const open = site.open_subscriptions();
        expect(open).toBeGreaterThan(12);

        data.stop();
        data.stop();
        await vi.advanceTimersByTimeAsync(2000);
        expect(site.subs.app.size).toBe(0);

        data.run();
        await site.settle();
        expect(site.subs.app.size).toBe(6 + METADATA_APPS.length + 1);
        expect((await rx.firstValueFrom(data.datasets)).size).toBe(60);
    });

    test("a reference chain too deep to follow errors the dataset map, and a shorter one reads again", async () => {
        const site = make_site();
        cleanup.push(() => site.close());
        const id = n => `5eedab1e-0ccc-4000-8000-${n.toString(16).padStart(12, "0")}`;
        const depth = 20000;

        for (const app of STRUCTURE_APPS)
            site.add_member(App.DatasetDefinition, app);
        site.put(App.SparkplugSrc, id(0), { source: id(depth + 1) });
        for (let i = 1; i <= depth; i++)
            site.put(App.SessionLimits, id(i), { source: id(i - 1) });

        const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
        await expect(rx.firstValueFrom(data.datasets)).rejects.toThrow(RangeError);

        /* Cut the chain into short pieces. The next read starts from a
         * new index, because the old one stopped part of the way. */
        for (let i = 100; i <= depth; i += 100)
            site.put(App.SessionLimits, id(i), { source: id(0) });
        const datasets = await rx.firstValueFrom(data.datasets);
        expect(datasets.size).toBe(depth + 1);
        expect(datasets.filter(d => d.structure === Special.InvalidDataset).size)
            .toBe(0);
    });
});
