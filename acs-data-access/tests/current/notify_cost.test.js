/*
 * ACS Data Access Service
 * Notify: what one change costs every open subscription
 * Copyright 2026 University of Sheffield
 */

/* The golden tests show a notify client holds the same state as
 * before. These show what that state costs on a large site with
 * several sessions open: the messages each session gets for one
 * change, the bodies each view works out, the grant checks, and the
 * ConfigDB watches opened. The counts are exact, and they are the same
 * on a site of 250, 1,000 and 4,000 datasets.
 *
 * Some work still grows with the site. Each such cost is named here
 * and asserted at its exact value, so it stays in view:
 *
 *  - ConfigDB sends the whole Dataset member list on each change to
 *    it, and Data Access reads it once.
 *  - A list WATCH sends its whole list on each change to it.
 *  - Auth sends a principal's whole ACL on each change to it, and each
 *    open permission watch of that principal filters it.
 *
 * They run against fakes, so they need no cluster. */

import { afterEach, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DefaultDatasets, default_dataset_uuid } from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { ENDPOINTS, make_client, search } from "../support/notify-client.js";
import { PRINCIPALS, build_site } from "../support/site-builder.js";

const { App, Perm, Class } = Constants;
const { Info } = UUIDs.App;

const debug = { bound: () => () => {} };

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

const sorted = list => [...list].sort();

const LISTS = ["metadata_list", "structure_list", "union_sources", "session_sources"];
const SINGLES = ["metadata_uuid", "structure_uuid"];

/* The view each endpoint runs, by the name notify.js gives it. */
const VIEW_OF = {
    metadata_list:      "metadata_list",
    metadata_uuid:      "metadata_uuid",
    metadata_search:    "metadata_search",
    structure_list:     "structure_list",
    structure_uuid:     "structure_uuid",
    structure_search:   "structure_search",
    union_sources:      "union_sources_list",
    session_sources:    "session_sources_list",
};

/* A site of `n` datasets, half of them default datasets, with twice
 * as many names as datasets and a few placed devices that have no
 * default dataset yet. */
function fixture (n, site_opts, build_opts) {
    const site = make_site(site_opts);
    const built = build_site(site, {
        datasets: n, devices: n / 2 + 10, infos: 2 * n, seed: 81, ...build_opts,
    });
    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const client = make_client({ data, site, tokens: { roottoken: ROOT } });
    cleanup.push(async () => {
        await client.stop();
        data.stop();
        site.close();
    });
    const maker = new DefaultDatasets({ data, cdb: site.cdb, debug });
    return { site, built, data, client, maker, sessions: new Map() };
}

/* Open what one Admin session holds: both searches, the four lists,
 * and a single WATCH of each kind on a dataset nothing here changes. */
function open_session (fx, principal) {
    const unrelated = {
        metadata_uuid:  fx.built.kinds.sessions[1],
        structure_uuid: fx.built.kinds.unions[1],
    };
    const recs = {};
    for (const [name, make] of Object.entries(ENDPOINTS))
        recs[name] = fx.client.open(principal, make(unrelated[name]));
    fx.sessions.set(principal, recs);
    return recs;
}

const view_of = (fx, principal, endpoint) => {
    const found = [...fx.client.dan.views]
        .filter(v => v.principal == principal && v.name == VIEW_OF[endpoint]);
    expect([principal, endpoint, found.length]).toEqual([principal, endpoint, 1]);
    return found[0];
};

/* What `change` costs: for each session, the messages each endpoint
 * got and the bodies each view worked out, and for the service the
 * datasets resolved, the grant checks and what was opened. */
async function cost_of (fx, change) {
    const { site } = fx;
    await site.settle();

    const marks = new Map();
    for (const [principal, recs] of fx.sessions) {
        for (const [endpoint, rec] of Object.entries(recs)) {
            marks.set(rec, {
                principal, endpoint,
                messages: rec.messages.length,
                view: view_of(fx, principal, endpoint),
            });
        }
    }
    for (const mark of marks.values())
        mark.computed = mark.view.stats.computed;
    const resolved = fx.data.index.stats.resolved;
    const scanned = fx.data.parts_stats.scanned;
    site.reset_counters();

    await change();
    await site.settle();

    const messages = {};
    const computed = {};
    const sent = {};
    let list_elements = 0;
    for (const [rec, mark] of marks) {
        const { principal, endpoint } = mark;
        const got = rec.messages.slice(mark.messages);
        (messages[principal] ??= {})[endpoint] = got.length;
        (computed[principal] ??= {})[endpoint] =
            mark.view.stats.computed - mark.computed;
        (sent[principal] ??= {})[endpoint] = got;
        if (LISTS.includes(endpoint))
            for (const m of got) list_elements += m.response.body.length;
    }
    const report = site.report();

    return {
        /* Per session. */
        messages, computed, sent,
        /* The counts that must not depend on the size of the site. */
        fixed: {
            messages, computed,
            resolved:           fx.data.index.stats.resolved - resolved,
            grant_checks:       report.grant_checks,
            search_subscribes:  report.search_subscribes,
            member_subscribes:  report.member_subscribes,
            subclass_subscribes: report.subclass_subscribes,
            subclass_watches:   report.subclass_watches,
            member_watches:     report.member_watches,
            acl_subscribes:     report.acl_subscribes,
            acl_scanned:        report.acl_scanned,
        },
        /* The counts that grow with the site, each at its stated value. */
        scanned:        fx.data.parts_stats.scanned - scanned,
        list_elements,
        list_elements_counted: report.list_elements,
        member_elements: report.member_elements,
        longest_block_ms: report.longest_block_ms,
        total_computed: Object.values(computed)
            .flatMap(by => Object.values(by)).reduce((a, b) => a + b, 0),
    };
}

const { wild, some } = PRINCIPALS;

const holds_device = (fx, device) => fx.site.acl(some)
    .some(e => e.permission == Perm.UseDevice && e.target == device);

/* Three sessions on a site of `n` datasets, and the cost of making
 * the default dataset of one device, the way the maker makes it: the
 * object, the UNS device entry, then the name. `some` holds UseDevice
 * on the device, so all three may see the new dataset. */
async function make_one_default (n) {
    const fx = fixture(n);
    for (const principal of [ROOT, wild, some]) open_session(fx, principal);

    const device = fx.built.spare_devices.find(d => holds_device(fx, d));
    const dataset = default_dataset_uuid(device);
    const members = fx.site.members(Class.Dataset).size;
    const cost = await cost_of(fx, () => fx.maker.make(device, dataset));
    return { fx, device, dataset, members, cost };
}

describe("making one default dataset, with three sessions open", () => {
    test("each session that may see it gets 2 metadata search messages, 1 structure search message and 1 on each list", async () => {
        const { fx, dataset, device, cost } = await make_one_default(1000);
        const name = fx.site.app(Info).get(device).name;

        for (const principal of [ROOT, wild, some]) {
            expect([principal, cost.messages[principal]]).toEqual([principal, {
                metadata_search: 2, structure_search: 1,
                metadata_list: 1, structure_list: 1,
                union_sources: 1, session_sources: 1,
                metadata_uuid: 0, structure_uuid: 0,
            }]);

            const got = cost.sent[principal];
            /* It appears with no name, and then gets one. */
            expect(got.metadata_search).toEqual([
                { status: 200, child: dataset, response: { status: 201, body: {
                    uuid: dataset, name: "UNKNOWN", parts: [] } } },
                { status: 200, child: dataset, response: { status: 200, body: {
                    uuid: dataset, name, parts: [] } } },
            ]);
            expect(got.structure_search).toEqual([
                { status: 200, child: dataset, response: { status: 201, body: {
                    structure: App.UNSDevice, config: { source: device } } } },
            ]);
            for (const list of LISTS) {
                expect(got[list][0].response.body).toContain(dataset);
                expect(fx.sessions.get(principal)[list].state().body)
                    .toEqual(sorted(got[list][0].response.body));
            }
        }
    });

    test("a session that may not see it gets no message", async () => {
        const fx = fixture(1000);
        for (const principal of [ROOT, some, PRINCIPALS.none])
            open_session(fx, principal);

        const device = fx.built.spare_devices.find(d => !holds_device(fx, d));
        const dataset = default_dataset_uuid(device);
        const cost = await cost_of(fx, () => fx.maker.make(device, dataset));

        const nothing = Object.fromEntries(Object.keys(ENDPOINTS).map(e => [e, 0]));
        expect(cost.messages[some]).toEqual(nothing);
        expect(cost.messages[PRINCIPALS.none]).toEqual(nothing);
        expect(cost.messages[ROOT].metadata_search).toBe(2);
        expect(fx.sessions.get(ROOT).metadata_search.state().children)
            .toHaveProperty(dataset);
        expect(fx.sessions.get(some).metadata_search.state().children)
            .not.toHaveProperty(dataset);
    });

    test("the work is for that one dataset: 1 resolve, a few bodies, 2 grant checks a body, 1 new watch", async () => {
        const { fx, dataset, cost } = await make_one_default(1000);

        expect(cost.fixed.resolved).toBe(1);
        for (const principal of [ROOT, wild, some]) {
            const computed = cost.computed[principal];
            /* The dataset, then its name. */
            expect([principal, computed.metadata_search]).toEqual([principal, 2]);
            expect(computed.metadata_search).toBeLessThanOrEqual(4);
            for (const endpoint of ["structure_search", ...LISTS])
                expect([principal, endpoint, computed[endpoint]])
                    .toEqual([principal, endpoint, 1]);
            /* The single watches are on other datasets. */
            for (const endpoint of SINGLES)
                expect([principal, endpoint, computed[endpoint]])
                    .toEqual([principal, endpoint, 0]);
        }

        /* Root and a grant on every target need no check. `some`
         * reaches the dataset through its device: one check for a
         * grant on the dataset, one for UseDevice on the device. */
        const bodies_some = Object.values(cost.computed[some]).reduce((a, b) => a + b, 0);
        expect(bodies_some).toBe(7);
        expect(cost.fixed.grant_checks).toBe(2 * bodies_some);
        expect(cost.fixed.grant_checks).toBeLessThanOrEqual(2 * cost.total_computed);

        /* The one new ConfigDB watch is for the new dataset's parts,
         * shared by every session. */
        expect([...fx.site.counters.watch.subclass]).toEqual([[dataset, 1]]);
        expect([...fx.site.counters.opened.subclass]).toEqual([[dataset, 1]]);
        expect(cost.fixed).toMatchObject({
            subclass_subscribes: 1, subclass_watches: 1,
            search_subscribes: 0, member_subscribes: 0, member_watches: 0,
            acl_subscribes: 0, acl_scanned: 0,
        });
    });

    test("the counts are the same on a site of 250, 1,000 and 4,000 datasets, and what grows is as stated", async () => {
        const runs = [];
        for (const n of [250, 1000, 4000]) {
            const { fx, members, cost } = await make_one_default(n);
            runs.push({ n, cost });

            /* ConfigDB sends the Dataset member list once, with the
             * new member on it, and Data Access reads it once. */
            expect([n, cost.scanned]).toEqual([n, members + 1]);
            expect([n, cost.member_elements]).toEqual([n, members + 1]);

            /* Each list that changed is sent whole. */
            let expected = 0;
            for (const principal of [ROOT, wild, some])
                for (const list of LISTS)
                    expected += fx.sessions.get(principal)[list].state().body.length;
            expect([n, cost.list_elements]).toEqual([n, expected]);
            expect([n, cost.list_elements_counted]).toEqual([n, expected]);
            expect(expected).toBeGreaterThan(n);

            /* Free a large site before the next one is built. */
            for (const fn of cleanup.splice(0).reverse()) await fn();
        }

        const [small, medium, large] = runs.map(run => run.cost.fixed);
        expect(medium).toEqual(small);
        expect(large).toEqual(small);
    }, 120000);

    test("no notification blocks the event loop for long", async () => {
        const { cost } = await make_one_default(1000);
        /* Three notifications: the member list, the UNS device entry
         * and the name. Before the keyed views each took seconds with
         * three sessions open. */
        expect(cost.longest_block_ms).toBeLessThan(50);
    });
});

describe("names", () => {
    test("a name for an object that is not a dataset works out no body and sends no message", async () => {
        const fx = fixture(1000);
        for (const principal of [ROOT, wild, some]) open_session(fx, principal);

        const cost = await cost_of(fx, () =>
            fx.site.put(Info, fx.built.fillers[0], { name: "Something else" }));
        expect(cost.total_computed).toBe(0);
        expect(fx.site.counters.messages).toBe(0);
        expect(cost.fixed.grant_checks).toBe(0);

        /* A new object with a name, too. */
        const again = await cost_of(fx, () =>
            fx.site.put(Info, fx.built.spare(1), { name: "Brand new" }));
        expect(again.total_computed).toBe(0);
        expect(fx.site.counters.messages).toBe(0);
    });

    test("a name for one dataset works out 1 body in each metadata search and sends 1 message to each", async () => {
        const fx = fixture(1000);
        for (const principal of [ROOT, wild, some]) open_session(fx, principal);

        /* A default dataset all three may read. */
        const { dataset } = fx.built.defaults.find(d => holds_device(fx, d.device));
        const cost = await cost_of(fx, () =>
            fx.site.put(Info, dataset, { name: "Renamed" }));

        for (const principal of [ROOT, wild, some]) {
            const messages = cost.messages[principal];
            const computed = cost.computed[principal];
            for (const endpoint of Object.keys(ENDPOINTS)) {
                const want = endpoint == "metadata_search" ? 1 : 0;
                expect([principal, endpoint, messages[endpoint]])
                    .toEqual([principal, endpoint, want]);
                expect([principal, endpoint, computed[endpoint]])
                    .toEqual([principal, endpoint, want]);
            }
            expect(cost.sent[principal].metadata_search[0]).toMatchObject({
                status: 200, child: dataset,
                response: { status: 200, body: { uuid: dataset, name: "Renamed" } },
            });
        }
    });
});

describe("a principal whose ACL lists datasets one by one", () => {
    const owner = "owner@EXAMPLE.ORG";

    /* `owner` holds a ReadDataset grant on every dataset by name. */
    function owned (n, site_opts) {
        const fx = fixture(n, site_opts);
        fx.site.set_acl(owner, fx.built.datasets.map(target =>
            ({ permission: Perm.ReadDataset, target })));
        open_session(fx, owner);
        return fx;
    }

    test("one new target works out at most 1 body in each view, and each open permission watch filters the ACL once", async () => {
        const fx = owned(1000);
        const { site, built } = fx;
        await site.settle();
        /* A permission and UseDevice, for each of the eight. */
        const watches = site.subs.acl.get(owner).size;
        expect(watches).toBe(16);

        /* A dataset that exists and `owner` cannot see yet. */
        const fresh = built.spare(1);
        site.put(App.SparkplugSrc, fresh, { source: built.devices[0] });
        site.add_member(Class.Dataset, fresh);

        const cost = await cost_of(fx, () =>
            site.grant(owner, Perm.ReadDataset, fresh));

        expect(cost.computed[owner]).toEqual({
            metadata_search: 1, metadata_list: 1,
            /* The grant is for reading: nothing else can change. */
            structure_search: 0, structure_list: 0,
            union_sources: 0, session_sources: 0,
            metadata_uuid: 0, structure_uuid: 0,
        });
        expect(cost.messages[owner]).toEqual({
            metadata_search: 1, metadata_list: 1,
            structure_search: 0, structure_list: 0,
            union_sources: 0, session_sources: 0,
            metadata_uuid: 0, structure_uuid: 0,
        });

        /* What still grows with the ACL: Auth sends all of it, and
         * each open permission watch filters all of it. */
        expect(site.acl(owner)).toHaveLength(built.datasets.length + 1);
        expect(cost.fixed.acl_scanned).toBe(site.acl(owner).length * watches);
        expect(cost.fixed.resolved).toBe(0);
    });

    test("a dataset made for a principal who is granted it on creation appears once, with one push of the ACL", async () => {
        const fx = owned(1000, {
            grant_on_create: { principal: owner, permission: Perm.ReadDataset },
        });
        const { site, built } = fx;
        const device = built.spare_devices[0];
        const dataset = default_dataset_uuid(device);
        const watches = 16;

        const cost = await cost_of(fx, () => fx.maker.make(device, dataset));

        expect(cost.messages[owner]).toMatchObject({
            metadata_search: 2, metadata_list: 1,
            structure_search: 0, structure_list: 0,
        });
        /* The dataset, then its name, where it shows. One look at the
         * dataset where it does not. */
        expect(cost.computed[owner]).toEqual({
            metadata_search: 2, metadata_list: 1,
            structure_search: 1, structure_list: 1,
            union_sources: 1, session_sources: 1,
            metadata_uuid: 0, structure_uuid: 0,
        });
        expect(site.acl(owner)).toHaveLength(built.datasets.length + 1);
        expect(cost.fixed.acl_scanned).toBe(site.acl(owner).length * watches);
        expect(fx.sessions.get(owner).metadata_search.state().children)
            .toHaveProperty(dataset);
    });
});

describe("a search stays alive on a large site", () => {
    test("2,000 visible datasets are one snapshot, and one change is then one update", async () => {
        const fx = fixture(2000);
        const { site, built } = fx;
        const visible = built.expected[ROOT].metadata;
        expect(visible).toHaveLength(2000);

        for (const parent of ["v2/metadata/", "v2/structure/"]) {
            const rec = fx.client.open(ROOT, search(parent));
            await site.settle();
            expect(rec.messages).toHaveLength(1);
            expect(sorted(Object.keys(rec.messages[0].children))).toEqual(visible);

            const session = built.kinds.sessions.at(-1);
            if (parent == "v2/metadata/") {
                site.put(Info, session, { name: "Renamed" });
            }
            else {
                site.put(App.SessionLimits, session, {
                    ...site.app(App.SessionLimits).get(session),
                    to: "2027-06-01T00:00:00.000Z",
                });
            }
            await site.settle();
            expect(rec.messages).toHaveLength(2);
            expect([rec.messages[1].child, rec.messages[1].response.status])
                .toEqual([session, 200]);
            expect(rec.error).toBeNull();
        }
    });

    test("a grant on every dataset gained after the snapshot is 2,000 updates and no error", async () => {
        const fx = fixture(2000);
        const { site, built } = fx;
        const { none } = PRINCIPALS;

        const metadata = fx.client.open(none, search("v2/metadata/"));
        const structure = fx.client.open(none, search("v2/structure/"));
        await site.settle();
        expect(metadata.messages).toEqual(
            [{ children: {}, response: { status: 204 }, status: 201 }]);
        expect(structure.messages).toHaveLength(1);

        site.grant(none, Perm.ReadDataset, UUIDs.Special.Null);
        site.grant(none, Perm.EditDataset, UUIDs.Special.Null);
        await site.settle();

        for (const rec of [metadata, structure]) {
            expect(rec.error).toBeNull();
            expect(rec.ended).toBe(false);
            const updates = rec.messages.slice(1);
            expect(updates).toHaveLength(2000);
            expect(new Set(updates.map(m => m.response.status))).toEqual(new Set([201]));
            expect(sorted(updates.map(m => m.child)))
                .toEqual(built.expected[ROOT].metadata);
        }

        /* And lost again: 2,000 children go. */
        site.revoke(none, Perm.ReadDataset, UUIDs.Special.Null);
        await site.settle();
        expect(metadata.messages).toHaveLength(4001);
        expect(metadata.state().children).toEqual({});
        expect(metadata.error).toBeNull();
    });

    test.skipIf(!globalThis.WebSocket)("over a real WebSocket, 2,000 children arrive as one frame and one change as one more", async () => {
        const fx = fixture(2000);
        const { site, built } = fx;
        await site.settle();
        const conn = await fx.client.connect_ws("roottoken");

        const found = conn.request(search("v2/metadata/"));
        const [snapshot] = await conn.wait_for_updates(found, 1, 10000);
        expect(snapshot.status).toBe(201);
        expect(Object.keys(snapshot.children)).toHaveLength(2000);

        /* A second subscription answers after the first has had every
         * message it was going to get. */
        const listed = conn.request({ method: "WATCH", request: { url: "v2/union-sources/" } });
        await conn.wait_for_updates(listed, 1, 10000);
        expect(conn.updates(found)).toHaveLength(1);

        const session = built.kinds.sessions.at(-1);
        site.put(Info, session, { name: "Renamed" });
        const updates = await conn.wait_for_updates(found, 2, 10000);
        expect(updates[1]).toMatchObject({
            status: 200, child: session,
            response: { status: 200, body: { uuid: session, name: "Renamed" } },
        });

        const again = conn.request({ method: "WATCH", request: { url: "v2/session-sources/" } });
        await conn.wait_for_updates(again, 1, 10000);
        expect(conn.updates(found)).toHaveLength(2);
        expect(conn.closed).toBe(false);
    }, 30000);
});
