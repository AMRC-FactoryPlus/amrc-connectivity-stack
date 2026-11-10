/*
 * ACS Data Access Service
 * Baselines: what the code costs and gets wrong before the per-change work
 * Copyright 2026 University of Sheffield
 */

/* Each test here states a fact about the code as it was before the
 * per-change index, keyed notify views and one-pass maker. Most of the
 * facts are faults. They pass today so that the stage that fixes each
 * one has to change the assertion, which puts the fix in that stage's
 * diff. Each test names the stage that flips it. Do not relax one to
 * make it pass: flip it in its stage, to the value the plan gives.
 *
 * Every test of the old code stays under 150 visible datasets: its
 * SEARCH stops delivering at a few hundred.
 *
 * They run against fakes, so they need no cluster. */

import * as rx from "rxjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DefaultDatasets, default_dataset_uuid } from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { make_client, search, watch } from "../support/notify-client.js";
import { PRINCIPALS, build_site } from "../support/site-builder.js";

const { App, Perm, Class } = Constants;
const { Info } = UUIDs.App;

const debug = { bound: () => () => {} };

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
    vi.useRealTimers();
});

/* A built site with a DataFlow and a notify client over it. */
function fixture (opts, site_opts) {
    const site = make_site(site_opts);
    const built = build_site(site, opts);
    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const client = make_client({ data, site });
    cleanup.push(async () => {
        await client.stop();
        data.stop?.();
        site.close();
    });
    return { site, built, data, client };
}

/* Make a device's default dataset the way the maker does: the object,
 * the UNS device entry, then the name. */
function make_default (fx, device) {
    return new DefaultDatasets({ data: fx.data, cdb: fx.site.cdb, debug })
        .make(device, default_dataset_uuid(device));
}

describe("known defects", () => {
    /* D1. Flips in stage 6: no message follows a snapshot until
     * something changes. */
    test.each([
        ["v2/metadata/", "metadata"],
        ["v2/structure/", "structure"],
    ])("D1: a SEARCH %s snapshot of 20 children is followed by 20 updates that repeat it",
    async (parent, list) => {
        const fx = fixture({ datasets: 20, seed: 11 });
        const visible = fx.built.expected[ROOT][list];
        expect(visible).toHaveLength(20);

        const rec = fx.client.open(ROOT, search(parent));
        await fx.site.settle();

        const [snapshot, ...repeats] = rec.messages;
        expect(Object.keys(snapshot.children).sort()).toEqual(visible);
        expect(repeats).toHaveLength(20);
        expect(repeats.map(m => m.child).sort()).toEqual(visible);
        for (const m of repeats)
            expect([m.status, m.response.status]).toEqual([200, 201]);
    });

    /* D2. Flips in stage 6: the search answers, and the invalid
     * dataset is a child with the invalid marker. */
    test("D2: SEARCH v2/structure/ sends nothing while an invalid dataset is visible", async () => {
        const fx = fixture({ datasets: 20, seed: 12 });
        const broken = fx.built.kinds.sparkplug[1];
        /* A second definition makes it invalid. */
        fx.site.put(App.UnionComponents, broken, []);

        const rec = fx.client.open(ROOT, search("v2/structure/"));
        const list = fx.client.open(ROOT, watch("v2/structure/"));
        await fx.site.settle();

        expect(list.state().body).toContain(broken);
        expect(rec.messages).toEqual([]);

        /* It is the invalid dataset that stops it. */
        fx.site.del(App.UnionComponents, broken);
        await fx.site.settle();
        expect(Object.keys(rec.state().children)).toHaveLength(20);
    });

    /* D3. Flipped in stage 2. Before it, the maker queued every list
     * of missing datasets and made each list in turn, so this site got
     * more than 40 create_object calls. Now a pass reads the newest
     * inputs and each dataset is created once. */
    test("D3: the maker creates 40 datasets exactly 40 times when a pass outlasts the settle time", async () => {
        vi.useFakeTimers();

        /* A dataset takes 2.5 s to make, so the 2 s debounce gives a
         * new list of missing datasets after each one, and a pass of
         * 40 takes longer than the 60 s the maker waits before it
         * makes a dataset again. One at a time, as the maker worked
         * when this was captured, so the pass still takes 100 s.
         * default_datasets_burst.test.js covers 4 at a time with
         * slower calls. */
        const site = make_site({ latency: 500 });
        const built = build_site(site, { datasets: 0, devices: 40, placed: 40, seed: 13 });
        const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
        data.run();
        const maker = new DefaultDatasets({
            data, cdb: site.cdb, debug, concurrency: 1 });
        cleanup.push(() => {
            maker.stop();
            data.stop?.();
            site.close();
        });

        maker.run();
        /* An hour, in steps a pending call can finish in. */
        for (let minute = 0; minute < 60; minute++)
            await vi.advanceTimersByTimeAsync(60 * 1000);
        maker.stop();

        const datasets = await rx.firstValueFrom(data.datasets);
        for (const device of built.placed)
            expect(datasets.has(default_dataset_uuid(device))).toBe(true);

        expect(site.counters.calls.get("create_object")).toBe(40);
    });

    /* D4. Flipped in stage 4. Before it, reading this config threw,
     * which errored the dataset map for every route and every notify
     * subscription. Now the one dataset is invalid, with the datasets
     * that read it, and every other dataset resolves. */
    test("D4: a null Session limits config makes that one dataset invalid, and the rest resolve", async () => {
        const fx = fixture({ datasets: 20, seed: 14 });
        const session = fx.built.kinds.sessions[0];
        const before = await rx.firstValueFrom(fx.data.datasets);
        expect(before.size).toBe(20);

        fx.site.put(App.SessionLimits, session, null);
        await fx.site.settle();

        /* The session, and every dataset that reads it through any
         * number of others. */
        const broken = new Set([session]);
        for (let grew = true; grew;) {
            grew = false;
            const reads = [
                ...[...fx.site.app(App.SessionLimits)]
                    .map(([id, config]) => [id, [config?.source]]),
                ...[...fx.site.app(App.UnionComponents)],
            ];
            for (const [id, sources] of reads) {
                if (broken.has(id) || !sources.some(s => broken.has(s))) continue;
                broken.add(id);
                grew = true;
            }
        }

        const datasets = await rx.firstValueFrom(fx.data.datasets);
        const valid = await rx.firstValueFrom(fx.data.valid_datasets);
        const invalid = await rx.firstValueFrom(fx.data.invalid_datasets);

        expect(datasets.size).toBe(20);
        expect([...invalid.keys()].sort()).toEqual([...broken].sort());
        expect(invalid.get(session)).toEqual({
            structure: Constants.Special.InvalidDataset,
            config: null, from: null, to: null,
        });
        expect(valid.size).toBe(20 - broken.size);
        /* Nothing else was touched. */
        for (const [uuid, entry] of valid)
            expect(entry).toBe(before.get(uuid));

        /* A config that can be read makes it valid again. */
        fx.site.put(App.SessionLimits, session, before.get(session).config);
        await fx.site.settle();
        expect((await rx.firstValueFrom(fx.data.invalid_datasets)).size).toBe(0);
        expect(await rx.firstValueFrom(fx.data.valid_datasets))
            .toEqual(before);
    });
});

describe("baselines", () => {
    /* The grant checks one new default dataset costs a principal that
     * holds both searches, on a site of `n` datasets. The principal has
     * a grant on every dataset by name, so each check is a has() call. */
    async function grant_checks_for_one_dataset (n) {
        const explicit = "explicit@EXAMPLE.ORG";
        const fx = fixture({ datasets: n, devices: n, placed: n, seed: 21 });
        const device = fx.built.spare_devices[0];
        const dataset = default_dataset_uuid(device);
        expect(fx.built.datasets).toHaveLength(n);

        /* The grant on the new dataset is there before it is made, so
         * nothing but the dataset changes. */
        fx.site.set_acl(explicit, [...fx.built.datasets, dataset].flatMap(target => [
            { permission: Perm.ReadDataset, target },
            { permission: Perm.EditDataset, target },
        ]));

        const metadata = fx.client.open(explicit, search("v2/metadata/"));
        const structure = fx.client.open(explicit, search("v2/structure/"));
        await fx.site.settle();
        expect(Object.keys(metadata.state().children)).toHaveLength(n);
        expect(Object.keys(structure.state().children)).toHaveLength(n);

        const before = fx.site.counters.grant_has;
        await make_default(fx, device);
        await fx.site.settle();
        expect(metadata.state().children).toHaveProperty(dataset);
        expect(structure.state().children).toHaveProperty(dataset);

        return fx.site.counters.grant_has - before;
    }

    /* B1. Flips in stage 6: the same count at both sizes. */
    test("B1: grant checks for one new dataset grow more than 3 times when the site doubles", async () => {
        const small = await grant_checks_for_one_dataset(60);
        const large = await grant_checks_for_one_dataset(120);

        expect(small).toBeGreaterThan(0);
        expect(large).toBeGreaterThan(3 * small);
    }, 120000);

    /* B3. Flipped in stage 4. Before it, every structure change built
     * the whole dataset map again, so no entry was the same object
     * after one put. Now only the entry that changed is new. */
    test("B3: after one structure put, every untouched dataset entry is the same object", async () => {
        const fx = fixture({ datasets: 60, seed: 23 });
        let latest;
        const sub = fx.data.datasets.subscribe(v => { latest = v; });
        cleanup.push(() => sub.unsubscribe());
        await fx.site.settle();
        const before = latest;
        expect(before.size).toBe(60);

        /* A session nothing else reads, so only its entry changes. */
        const session = fx.built.kinds.sessions.at(-1);
        fx.site.put(App.SessionLimits, session, {
            ...fx.site.app(App.SessionLimits).get(session),
            to: "2027-06-01T00:00:00.000Z",
        });
        await fx.site.settle();
        const after = latest;
        expect(after).not.toBe(before);
        expect(after.get(session)).not.toBe(before.get(session));

        const untouched = [...before.keys()].filter(uuid => uuid != session);
        const same = untouched.filter(uuid => after.get(uuid) === before.get(uuid));
        expect(untouched).toHaveLength(59);
        expect(same).toHaveLength(59);
    });

    /* B4. Flips in stage 6: at most 1, across general_infos and
     * info_changes. */
    test("B4: one metadata SEARCH holds one General information subscriber per child", async () => {
        const fx = fixture({ datasets: 60, seed: 24 });
        const visible = fx.built.expected[ROOT].metadata.length;
        expect(visible).toBe(60);

        let subscribers = 0;
        const infos = fx.data.general_infos;
        fx.data.general_infos = rx.defer(() => {
            subscribers++;
            return infos;
        });

        const rec = fx.client.open(ROOT, search("v2/metadata/"));
        await fx.site.settle();
        expect(Object.keys(rec.state().children)).toHaveLength(60);
        expect(subscribers).toBe(60);
    });

    /* B5. Flipped in stage 5. Before it, the parts of one dataset came
     * from the parts of all of them, so this request opened one
     * subclass watch per Dataset member: 58 on the site of 60. Now it
     * opens the watch of the dataset asked for, on a site of any
     * size. */
    test.each([60, 1000])("B5: a cold GET /v1/metadata/:uuid on a site of %i opens exactly one subclass watch", async n => {
        const fx = fixture({ datasets: n, seed: 25 });
        const members = fx.site.members(Class.Dataset).size;
        expect(members).toBeGreaterThan(n - 10);

        const api = new APIv1({
            data: fx.data, debug, auth: fx.site.auth, cdb: fx.site.cdb,
        });
        const res = {
            status (code) { this.code = code; return this; },
            json (body) { this.body = body; return this; },
        };
        /* A dataset with parts, so the answer needs the watch. */
        const dataset = fx.built.named.part_parent;
        expect(fx.site.counters.watch.subclass.total()).toBe(0);
        await api.metadata_uuid({ auth: ROOT, params: { uuid: dataset } }, res);

        expect(res.code).toBe(200);
        expect([...res.body.parts]).toEqual([fx.built.kinds.subset[0]]);
        expect([...fx.site.counters.watch.subclass]).toEqual([[dataset, 1]]);
        expect([...fx.site.counters.opened.subclass]).toEqual([[dataset, 1]]);
    });
});

describe("the scale harness", () => {
    /* B2 */
    test("B2: holds 1,000 datasets and 2,000 names, every stream answers, and an idle site does no work", async () => {
        const fx = fixture({ datasets: 1000, infos: 2000, seed: 31 });
        const { site, data, built } = fx;

        const streams = [
            "datasets", "valid_datasets", "invalid_datasets", "default_devices",
            "general_infos", "metadata", "functional_types", "parts",
        ];
        const latest = {};
        for (const name of streams) {
            const sub = data[name].subscribe(v => { latest[name] = v; });
            cleanup.push(() => sub.unsubscribe());
        }
        await site.settle();

        for (const name of streams)
            expect([name, latest[name] === undefined]).toEqual([name, false]);
        expect(latest.datasets.size).toBe(1000);
        expect(latest.valid_datasets.size).toBe(1000);
        expect(latest.invalid_datasets.size).toBe(0);
        expect(latest.default_devices.size).toBe(built.defaults.length);
        expect(latest.general_infos.size).toBe(2000);
        expect(built.expected[ROOT].metadata).toHaveLength(1000);
        expect(built.expected[PRINCIPALS.none].metadata).toHaveLength(0);

        /* What it took to get there. */
        const opened = site.report();
        expect(opened.search_subscribes).toBeGreaterThanOrEqual(12);
        expect(opened.subclass_watches).toBe(site.members(Class.Dataset).size);
        expect(opened.member_elements).toBeGreaterThanOrEqual(1000);

        /* Nothing changes, so nothing is counted. */
        site.reset_counters();
        await site.settle();
        expect(site.report()).toEqual({
            search_subscribes: 0, member_subscribes: 0, subclass_subscribes: 0,
            member_watches: 0, subclass_watches: 0, acl_subscribes: 0,
            calls: 0, grant_checks: 0, acl_scanned: 0, member_elements: 0,
            list_elements: 0, messages: 0, notifications: 0,
            blocks: 0, longest_block_ms: 0, total_block_ms: 0,
        });
    });

    test("counts subscribes, grant checks, messages and the block of each notification", async () => {
        const fx = fixture({ datasets: 1000, infos: 2000, seed: 31 });
        const { site, built } = fx;
        const { some } = PRINCIPALS;

        /* A list WATCH is linear, so the old code can hold one here. */
        const rec = fx.client.open(some, watch("v2/metadata/"));
        await site.settle();
        const expected = built.expected[some].metadata;
        expect(rec.state().body).toEqual(expected);

        const opened = site.report();
        expect(opened.acl_subscribes).toBeGreaterThan(0);
        expect(opened.acl_scanned).toBe(opened.acl_subscribes * site.acl(some).length);
        expect(opened.grant_checks).toBeGreaterThan(0);
        expect(opened.messages).toBe(1);
        expect(opened.list_elements).toBe(expected.length);

        /* One change: one notification, timed. */
        site.reset_counters();
        const target = built.datasets.find(uuid => !expected.includes(uuid));
        const took = site.timed(() => site.grant(some, Perm.ReadDataset, target));
        await site.settle();

        const changed = site.report();
        expect(changed.blocks).toBe(1);
        expect(changed.longest_block_ms).toBeGreaterThan(0);
        expect(changed.longest_block_ms).toBeLessThanOrEqual(took);
        expect(changed.total_block_ms).toBe(changed.longest_block_ms);
        expect(changed.messages).toBe(1);
        expect(changed.list_elements).toBe(expected.length + 1);
        expect(changed.grant_checks).toBeGreaterThan(0);
        expect(changed.acl_scanned).toBe(opened.acl_subscribes * site.acl(some).length);
        expect(rec.state().body).toContain(target);
    });

    test("a held source withholds its first answer until it is released", async () => {
        const site = make_site();
        cleanup.push(() => site.close());
        site.put(Info, "a", { name: "A" });
        site.hold("app", Info);

        const seen = [];
        const sub = site.cdb.search_app(Info).subscribe(m => seen.push(m.toJS()));
        cleanup.push(() => sub.unsubscribe());
        site.put(Info, "b", { name: "B" });
        expect(seen).toEqual([]);

        site.release("app", Info);
        expect(seen).toEqual([{ a: { name: "A" }, b: { name: "B" } }]);

        site.put(Info, "a", { name: "A2" });
        site.put(Info, "a", { name: "A2" });
        site.del(Info, "b");
        expect(seen.slice(1)).toEqual([
            { a: { name: "A2" }, b: { name: "B" } },
            { a: { name: "A2" } },
        ]);
    });

    test("search_app_changes says which entry changed, and a resync is a new snapshot", async () => {
        const site = make_site();
        cleanup.push(() => site.close());
        site.put(Info, "a", { name: "A" });

        const seen = [];
        const sub = site.cdb.search_app_changes(Info).subscribe(c => seen.push(c));
        cleanup.push(() => sub.unsubscribe());
        site.put(Info, "b", { name: "B" });
        site.resync(Info);

        expect(seen.map(c => [c.child, c.previous === null, c.map.toJS()])).toEqual([
            [null, true, { a: { name: "A" } }],
            ["b", false, { a: { name: "A" }, b: { name: "B" } }],
            [null, true, { a: { name: "A" }, b: { name: "B" } }],
        ]);
        /* A resync gives new objects with equal content. */
        expect(seen[2].map.get("a")).not.toBe(seen[1].map.get("a"));
        expect(site.counters.search.get(Info)).toBe(1);
    });

    test("ConfigDB calls take the latency, and settle waits for them", async () => {
        const site = make_site({ latency: 5 });
        cleanup.push(() => site.close());

        const pending = site.cdb.create_object(Class.Dataset, undefined, false);
        expect(site.pending).toBe(1);
        await site.settle();
        expect(site.pending).toBe(0);

        const uuid = await pending;
        expect(site.members(Class.Dataset).has(uuid)).toBe(true);
        expect(site.counters.calls.get("create_object")).toBe(1);
    });

    test("a notify lag delivers each change later, in order, and settle waits for it", async () => {
        const site = make_site({ notify_lag: 5 });
        cleanup.push(() => site.close());

        const seen = [];
        const sub = site.cdb.watch_members(Class.Dataset)
            .subscribe(set => seen.push(set.toArray()));
        cleanup.push(() => sub.unsubscribe());
        expect(seen).toEqual([[]]);

        site.add_member(Class.Dataset, "a");
        site.add_member(Class.Dataset, "b");
        expect(seen).toEqual([[]]);
        expect(site.pending).toBe(2);

        await site.settle();
        expect(seen).toEqual([[], ["a"], ["a", "b"]]);
        expect(site.counters.blocks.count).toBe(2);
    });

    test("deleting an object sends what a ConfigDB sends: its entries and its class links go", async () => {
        const site = make_site();
        cleanup.push(() => site.close());
        site.add_member(Class.Dataset, "a");
        site.add_member(Class.Dataset, "b");
        site.put(Info, "a", { name: "A" });
        site.put(App.SparkplugSrc, "a", { source: "d" });
        site.set_subclasses("b", ["a"]);

        const seen = { infos: [], members: [], parts: [] };
        const subs = [
            site.cdb.search_app(Info).subscribe(m => seen.infos.push(m.toJS())),
            site.cdb.watch_members(Class.Dataset)
                .subscribe(s => seen.members.push(s.toArray())),
            site.cdb.watch_members_subclasses(Class.Dataset)
                .subscribe(m => seen.parts.push(m.toJS())),
        ];
        cleanup.push(() => subs.forEach(s => s.unsubscribe()));

        await site.cdb.delete_object("a");
        expect(seen.infos.at(-1)).toEqual({});
        expect(seen.members.at(-1)).toEqual(["b"]);
        expect(seen.parts.at(-1)).toEqual({ b: [] });
        expect(await site.cdb.get_config(App.SparkplugSrc, "a")).toBeUndefined();
    });

    test("grant_on_create adds one target to a principal's ACL for each new object", async () => {
        const owner = "owner@EXAMPLE.ORG";
        const site = make_site({
            grant_on_create: { principal: owner, permission: Perm.ReadDataset },
        });
        cleanup.push(() => site.close());
        site.set_acl(owner, []);

        const seen = [];
        const sub = site.auth.watch_acl_with_perm(owner, Perm.ReadDataset)
            .subscribe(set => seen.push([...set]));
        cleanup.push(() => sub.unsubscribe());

        await site.cdb.create_object(Class.Dataset, "a", false);
        await site.cdb.create_object(Class.Dataset, "b", false);
        /* Creating an object that exists changes nothing. */
        await site.cdb.create_object(Class.Dataset, "a", false);

        expect(seen).toEqual([[], ["a"], ["a", "b"]]);
        expect(site.counters.acl_scanned).toBe(0 + 1 + 2);
        await expect(site.cdb.create_object(Class.Dataset, "a", true)).rejects.toThrow();
    });

    test("a source error reaches every subscriber, and a failing call rejects", async () => {
        const site = make_site();
        cleanup.push(() => site.close());

        const errors = [];
        const sub = site.cdb.search_app(Info).subscribe({ error: e => errors.push(e.message) });
        cleanup.push(() => sub.unsubscribe());
        site.error("app", Info, new Error("gone"));
        expect(errors).toEqual(["gone"]);
        expect(site.open_subscriptions()).toBe(0);

        site.failing = method => method == "put_config" ? new Error("down") : undefined;
        await expect(site.cdb.put_config(Info, "a", {})).rejects.toThrow("down");
        expect(await site.cdb.get_config(Info, "a")).toBeUndefined();
    });

    test("a principal Auth does not know gets no ACL until it has one", async () => {
        const site = make_site();
        cleanup.push(() => site.close());
        const stranger = "stranger@EXAMPLE.ORG";

        const seen = [];
        const sub = site.auth.watch_acl_with_perm(stranger, Perm.ReadDataset)
            .subscribe(set => seen.push([...set]));
        cleanup.push(() => sub.unsubscribe());
        expect(seen).toEqual([]);
        expect(await site.auth.check_acl(stranger, Perm.ReadDataset, "x", true)).toBe(false);
        expect(await site.auth.check_acl(ROOT, Perm.ReadDataset, "x", true)).toBe(true);

        site.set_acl(stranger, [{ permission: Perm.ReadDataset, target: "x" }]);
        site.repush_acl(stranger);
        expect(seen).toEqual([["x"], ["x"]]);
        expect(await site.auth.check_acl(stranger, Perm.ReadDataset, "x", true)).toBe(true);
        expect(await site.auth.check_acl(stranger, Perm.ReadDataset, "y", true)).toBe(false);
    });

    test("the same options build the same site", () => {
        const a = make_site();
        const b = make_site();
        cleanup.push(() => { a.close(); b.close(); });
        const built_a = build_site(a, { datasets: 80, infos: 150, seed: 5 });
        const built_b = build_site(b, { datasets: 80, infos: 150, seed: 5 });

        expect(built_b.datasets).toEqual(built_a.datasets);
        expect(built_b.expected).toEqual(built_a.expected);
        expect([...b.app(App.SessionLimits)]).toEqual([...a.app(App.SessionLimits)]);
        expect(b.acl(PRINCIPALS.some)).toEqual(a.acl(PRINCIPALS.some));

        /* Every kind of dataset is there, and all of them are valid. */
        for (const kind of ["defaults", "sparkplug", "subset", "metrics",
                "own_uns", "sessions", "unions"])
            expect([kind, built_a.kinds[kind].length > 0]).toEqual([kind, true]);
        expect(built_a.named.chain).toHaveLength(4);
        expect(built_a.expected[ROOT].structure).toHaveLength(80);
        expect(built_a.expected[ROOT].metadata).toHaveLength(80);
    });
});
