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
    /* D1. Flipped in stage 6. Before it, each SEARCH sent its snapshot
     * and then one child update per child that repeated it: 20 here.
     * The notify library queued them behind the snapshot, and on a
     * site of a few hundred datasets that queue overflowed the stack
     * and the search went quiet. Now nothing follows a snapshot until
     * something changes. */
    test.each([
        ["v2/metadata/", "metadata"],
        ["v2/structure/", "structure"],
    ])("D1: a SEARCH %s snapshot of 20 children is followed by nothing until a dataset changes",
    async (parent, list) => {
        const fx = fixture({ datasets: 20, seed: 11 });
        const visible = fx.built.expected[ROOT][list];
        expect(visible).toHaveLength(20);

        const rec = fx.client.open(ROOT, search(parent));
        await fx.site.settle();

        const [snapshot, ...repeats] = rec.messages;
        expect(Object.keys(snapshot.children).sort()).toEqual(visible);
        expect(repeats).toEqual([]);

        /* One change to one dataset: one message. A new name changes
         * a metadata body, and a new window a structure body. */
        const session = fx.built.kinds.sessions.at(-1);
        if (list == "metadata") {
            fx.site.put(Info, session, { name: "Renamed" });
        }
        else {
            const config = fx.site.app(App.SessionLimits).get(session);
            fx.site.put(App.SessionLimits, session,
                { ...config, to: "2027-06-01T00:00:00.000Z" });
        }
        await fx.site.settle();

        expect(rec.messages).toHaveLength(2);
        expect(rec.messages[1].child).toBe(session);
        expect([rec.messages[1].status, rec.messages[1].response.status])
            .toEqual([200, 200]);
    });

    /* D2. Flipped in stage 6. Before it, this search sent nothing at
     * all while the principal could see one invalid dataset. Now it
     * answers, and the invalid dataset is a child with the invalid
     * marker, which is what GET /v1/structure/:uuid gives for it. */
    test("D2: SEARCH v2/structure/ answers while an invalid dataset is visible, and shows it as invalid", async () => {
        const fx = fixture({ datasets: 20, seed: 12 });
        const broken = fx.built.kinds.sparkplug[1];
        const config = fx.site.app(App.SparkplugSrc).get(broken);
        /* A second definition makes it invalid. */
        fx.site.put(App.UnionComponents, broken, []);

        const rec = fx.client.open(ROOT, search("v2/structure/"));
        const list = fx.client.open(ROOT, watch("v2/structure/"));
        await fx.site.settle();

        expect(list.state().body).toContain(broken);
        expect(rec.messages).toHaveLength(1);
        const [snapshot] = rec.messages;
        expect(Object.keys(snapshot.children)).toHaveLength(20);
        expect(snapshot.children[broken]).toEqual({
            status: 200,
            body: { structure: Constants.Special.InvalidDataset, config: null },
        });
        expect(JSON.stringify(snapshot.children[broken].body)).toBe(JSON.stringify(
            { structure: Constants.Special.InvalidDataset, config: null }));

        /* Mended, it is a changed child with its structure back. */
        fx.site.del(App.UnionComponents, broken);
        await fx.site.settle();
        expect(rec.messages.slice(1)).toEqual([{
            status: 200,
            child: broken,
            response: {
                status: 200,
                body: { structure: App.SparkplugSrc, config },
            },
        }]);
        expect(Object.keys(rec.state().children)).toHaveLength(20);

        /* A dataset that turns invalid while the search is open is a
         * changed child too, not a child that goes away. */
        fx.site.put(App.UnionComponents, broken, []);
        await fx.site.settle();
        expect(rec.messages.slice(2)).toEqual([{
            status: 200,
            child: broken,
            response: {
                status: 200,
                body: { structure: Constants.Special.InvalidDataset, config: null },
            },
        }]);
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

    /* B1. Flipped in stage 6. Before it, every dataset change made
     * each search check every dataset again, once per child, so the
     * checks for one new dataset grew more than 3 times when the site
     * doubled. Now a search checks the dataset that changed: once for
     * the structure search, and once each for the two metadata bodies
     * (the dataset, then its name). */
    test("B1: grant checks for one new dataset are the same when the site doubles", async () => {
        const small = await grant_checks_for_one_dataset(60);
        const large = await grant_checks_for_one_dataset(120);

        expect(small).toBe(3);
        expect(large).toBe(small);
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

    /* B4. Flipped in stage 6. Before it, a metadata SEARCH held one
     * General information subscriber per child: 60 here. So one name
     * written anywhere on the site woke every child of every open
     * search. Now the search holds one subscriber, whatever the number
     * of children. */
    test("B4: one metadata SEARCH holds one General information subscriber", async () => {
        const fx = fixture({ datasets: 60, seed: 24 });
        const visible = fx.built.expected[ROOT].metadata.length;
        expect(visible).toBe(60);

        let subscribers = 0;
        for (const name of ["general_infos", "info_changes"]) {
            const source = fx.data[name];
            fx.data[name] = rx.defer(() => {
                subscribers++;
                return source;
            });
        }

        const rec = fx.client.open(ROOT, search("v2/metadata/"));
        await fx.site.settle();
        expect(Object.keys(rec.state().children)).toHaveLength(60);
        expect(subscribers).toBe(1);
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

    /* A real ConfigDB never sends a subscriber a change older than
     * its snapshot. The fake once chose who got a lagged change when
     * the lag ended, so a subscriber that arrived in between got its
     * snapshot and then the older changes after it. */
    test("under a notify lag, a subscriber gets no change older than its snapshot", async () => {
        const site = make_site({ notify_lag: 5 });
        cleanup.push(() => site.close());
        site.put(Info, "x", { name: "X" });

        const early = [];
        const late = [];
        const subs = [site.cdb.search_app(Info).subscribe(m => early.push(m.toJS()))];
        cleanup.push(() => subs.forEach(s => s.unsubscribe()));

        site.put(Info, "a", { v: 1 });
        site.put(Info, "a", { v: 2 });
        site.del(Info, "a");
        site.put(Info, "a", { v: 3 });
        expect(site.pending).toBe(4);
        subs.push(site.cdb.search_app(Info).subscribe(m => late.push(m.toJS())));

        const x = { name: "X" };
        expect(late).toEqual([{ x, a: { v: 3 } }]);
        await site.settle();
        /* The snapshot held all four changes, so none follows it. */
        expect(late).toEqual([{ x, a: { v: 3 } }]);
        /* The subscriber that was there gets each one, in order. */
        expect(early).toEqual([
            { x }, { x, a: { v: 1 } }, { x, a: { v: 2 } }, { x }, { x, a: { v: 3 } },
        ]);

        /* From here both get every change, once. */
        site.put(Info, "a", { v: 4 });
        await site.settle();
        expect(late).toEqual([{ x, a: { v: 3 } }, { x, a: { v: 4 } }]);
        expect(early).toHaveLength(6);
    });

    test("under a notify lag, a late subscriber to a class or an ACL gets only what is true now", async () => {
        const owner = "owner@EXAMPLE.ORG";
        const site = make_site({ notify_lag: 5 });
        cleanup.push(() => site.close());

        /* Something must be subscribed for a change to be sent at all.
         * The class is read from the fake ConfigDB itself here: the
         * library shares one WATCH per class and replays its last list
         * to a new caller, which is a different thing. */
        const first = [
            site._source("member", Class.Dataset).subscribe(),
            site.auth.watch_acl_with_perm(owner, Perm.ReadDataset).subscribe(),
        ];
        cleanup.push(() => first.forEach(s => s.unsubscribe()));

        site.add_member(Class.Dataset, "a");
        site.add_member(Class.Dataset, "b");
        site.remove_member(Class.Dataset, "a");
        site.set_acl(owner, []);
        site.grant(owner, Perm.ReadDataset, "x");
        site.grant(owner, Perm.ReadDataset, "y");
        site.revoke(owner, Perm.ReadDataset, "x");
        expect(site.pending).toBe(7);

        const seen = { members: [], acl: [] };
        const subs = [
            site.cdb.watch_members(Class.Dataset)
                .subscribe(set => seen.members.push(set.toArray())),
            site.auth.watch_acl_with_perm(owner, Perm.ReadDataset)
                .subscribe(set => seen.acl.push([...set])),
        ];
        cleanup.push(() => subs.forEach(s => s.unsubscribe()));

        await site.settle();
        expect(seen).toEqual({ members: [["b"]], acl: [["y"]] });
    });

    test("under a notify lag, a source released from a hold gets no change made while it was held", async () => {
        const site = make_site({ notify_lag: 5 });
        cleanup.push(() => site.close());
        site.hold("app", Info);

        const seen = [];
        const subs = [
            site.cdb.search_app_changes(Info).subscribe(c => seen.push([c.child, c.map.toJS()])),
            /* A subscriber that goes before the lag ends gets nothing. */
            site.cdb.search_app_changes(Info).subscribe(() => seen.push("gone")),
        ];
        cleanup.push(() => subs.forEach(s => s.unsubscribe()));

        site.put(Info, "a", { v: 1 });
        site.release("app", Info);
        expect(seen).toEqual([[null, { a: { v: 1 } }], "gone"]);
        site.put(Info, "a", { v: 2 });
        subs[1].unsubscribe();

        await site.settle();
        expect(seen).toEqual([
            [null, { a: { v: 1 } }], "gone", ["a", { a: { v: 2 } }],
        ]);
    });

    test("under a notify lag, a resync holds the entries as they were when it was asked for", async () => {
        const site = make_site({ notify_lag: 5 });
        cleanup.push(() => site.close());
        site.put(Info, "a", { v: 1 });

        const seen = [];
        const sub = site.cdb.search_app_changes(Info)
            .subscribe(c => seen.push([c.child, c.map.toJS()]));
        cleanup.push(() => sub.unsubscribe());

        site.resync(Info);
        site.put(Info, "b", { v: 2 });
        await site.settle();
        expect(seen).toEqual([
            [null, { a: { v: 1 } }],
            [null, { a: { v: 1 } }],
            ["b", { a: { v: 1 }, b: { v: 2 } }],
        ]);
    });

    /* A real client parses each message from its own WebSocket. */
    test.each([0, 5])("with a notify lag of %i ms, each SEARCH subscriber gets config bodies of its own",
    async notify_lag => {
        const site = make_site({ notify_lag });
        cleanup.push(() => site.close());
        site.put(Info, "a", { name: "A", tags: ["one"] });

        const latest = [null, null];
        const subs = latest.map((_, i) =>
            site.cdb.search_app_changes(Info).subscribe(c => { latest[i] = c.map; }));
        cleanup.push(() => subs.forEach(s => s.unsubscribe()));

        const check = key => {
            const stored = site.app(Info).get(key);
            const [one, two] = latest.map(map => map.get(key));
            expect(one).toEqual(stored);
            expect(two).toEqual(stored);
            expect(one).not.toBe(two);
            expect(one).not.toBe(stored);
            expect(two).not.toBe(stored);
            expect(one.tags).not.toBe(two.tags);

            /* What one subscriber does to its copy, no other sees. */
            one.tags.push("scribble");
            one.name = "Changed";
            expect(two).toEqual(stored);
            expect(site.app(Info).get(key)).toEqual(stored);
        };

        /* In the snapshot. */
        check("a");
        /* In a new entry and in a changed one. */
        site.put(Info, "b", { name: "B", tags: ["two"] });
        await site.settle();
        check("b");
        site.put(Info, "a", { name: "A2", tags: ["three"] });
        await site.settle();
        check("a");
        expect(site.app(Info).get("a")).toEqual({ name: "A2", tags: ["three"] });

        /* And in a snapshot sent again. */
        site.resync(Info);
        await site.settle();
        check("a");
        check("b");

        /* A third subscriber's snapshot is its own too. */
        let third = null;
        subs.push(site.cdb.search_app_changes(Info).subscribe(c => { third = c.map; }));
        expect(third.get("b")).toEqual({ name: "B", tags: ["two"] });
        expect(third.get("b")).not.toBe(site.app(Info).get("b"));
        expect(third.get("b")).not.toBe(latest[1].get("b"));
    });

    /* counters.grant_has is not only the per-dataset checks. A test
     * that counts checks across an ACL push counts these too. */
    test("grant checks count the comparison of a pushed ACL with the one before", async () => {
        const fx = fixture({ datasets: 20, seed: 33 });
        const { site, built, data } = fx;
        const who = "counted@EXAMPLE.ORG";
        const targets = built.datasets.slice(0, 10);
        site.set_acl(who, targets.map(target =>
            ({ permission: Perm.ReadDataset, target })));

        const states = [];
        const sub = data.watch_grant_state(who, Perm.ReadDataset)
            .subscribe(state => states.push(state));
        cleanup.push(() => sub.unsubscribe());
        expect(states).toHaveLength(1);

        /* The same ACL again: one check for the Null UUID, and one
         * for each target to find that nothing changed. No dataset
         * was checked. */
        const before = site.counters.grant_has;
        site.repush_acl(who);
        expect(states).toHaveLength(1);
        expect(site.counters.grant_has - before).toBe(1 + targets.length);

        /* One more target: the sizes differ, so the Null UUID check
         * is the only one. */
        const then = site.counters.grant_has;
        site.grant(who, Perm.ReadDataset, built.datasets[10]);
        expect(states).toHaveLength(2);
        expect(site.counters.grant_has - then).toBe(1);
    });

    test("open_watches counts the class watches callers hold, and a shared WATCH counts once", () => {
        const site = make_site();
        cleanup.push(() => site.close());
        site.add_member(Class.Dataset, "a");
        expect(site.open_watches()).toEqual({ member: 0, subclass: 0 });

        const subs = [
            site.cdb.watch_members(Class.Dataset).subscribe(),
            site.cdb.watch_members(Class.Dataset).subscribe(),
            site.cdb.watch_subclasses("a").subscribe(),
        ];
        expect(site.open_watches()).toEqual({ member: 2, subclass: 1 });
        /* The library shares one WATCH between the two callers. */
        expect(site.counters.opened.member.get(Class.Dataset)).toBe(1);
        expect(site.open_subscriptions()).toBe(2);

        subs[0].unsubscribe();
        expect(site.open_watches()).toEqual({ member: 1, subclass: 1 });
        subs[1].unsubscribe();
        subs[2].unsubscribe();
        expect(site.open_watches()).toEqual({ member: 0, subclass: 0 });
    });

    test("a class WATCH with no caller is dropped after 5 s, and the next caller opens a new one", async () => {
        vi.useFakeTimers();
        const site = make_site();
        cleanup.push(() => site.close());
        site.add_member(Class.Dataset, "a");
        const read = () => {
            let value;
            site.cdb.watch_members(Class.Dataset)
                .subscribe(v => { value = v; }).unsubscribe();
            return [...value];
        };

        expect(read()).toEqual(["a"]);
        expect(site.open_subscriptions()).toBe(1);

        /* A caller within the 5 s shares the WATCH that is open. */
        await vi.advanceTimersByTimeAsync(4000);
        site.add_member(Class.Dataset, "b");
        expect(read()).toEqual(["a", "b"]);
        expect(site.counters.opened.member.get(Class.Dataset)).toBe(1);

        await vi.advanceTimersByTimeAsync(4000);
        expect(site.open_subscriptions()).toBe(1);
        await vi.advanceTimersByTimeAsync(1100);
        expect(site.open_subscriptions()).toBe(0);

        expect(read()).toEqual(["a", "b"]);
        expect(site.counters.opened.member.get(Class.Dataset)).toBe(2);
        expect(site.counters.watch.member.get(Class.Dataset)).toBe(3);
    });

    test("close ends a class WATCH that is waiting to be dropped, and its timer", async () => {
        vi.useFakeTimers();
        const site = make_site();
        site.cdb.watch_members(Class.Dataset).subscribe().unsubscribe();
        expect(vi.getTimerCount()).toBe(1);

        site.close();
        expect(vi.getTimerCount()).toBe(0);
        expect(site.open_subscriptions()).toBe(0);
    });

    test("set_members sends the new list in one message", () => {
        const site = make_site();
        cleanup.push(() => site.close());
        const seen = [];
        const sub = site.cdb.watch_members(Class.Dataset)
            .subscribe(v => seen.push([...v].sort()));
        cleanup.push(() => sub.unsubscribe());

        expect(site.set_members(Class.Dataset, ["a", "b", "c"])).toBe(true);
        expect(site.set_members(Class.Dataset, ["c", "d"])).toBe(true);
        expect(site.set_members(Class.Dataset, ["c", "d"])).toBe(false);
        expect(site.set_members(Class.Dataset, [])).toBe(true);
        expect(seen).toEqual([[], ["a", "b", "c"], ["c", "d"], []]);
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
