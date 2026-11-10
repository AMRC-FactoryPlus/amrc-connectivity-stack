/*
 * ACS Data Access Service
 * The whole service while a site's default datasets are made
 * Copyright 2026 University of Sheffield
 */

/* A site that has just had its devices placed gets one default dataset
 * for each of them, all at once. These tests run that burst through the
 * real DataFlow, the real default dataset maker, the real notify
 * handlers and the real HTTP read routes, over a fake site that sends
 * the notification a real ConfigDB or Auth sends for every write.
 *
 * Four sessions are open throughout. Each holds what an Admin session
 * holds: both searches, the four lists, and a single WATCH of each kind
 * on a dataset the burst does not touch. Between them they keep every
 * cost that still grows with the site in play: the Dataset member
 * list, the list bodies, and the ACL of a principal who is granted
 * each new dataset by name as it is created.
 *
 * The counts are exact. Every message a session gets is one a client
 * needs, every dataset is made and worked out once, and the work that
 * still grows with the site is asserted at the value its formula
 * gives, so it cannot grow unseen.
 *
 * They run against fakes, so they need no cluster. */

import { beforeAll, describe, expect, test, vi } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DefaultDatasets, default_dataset_uuid } from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { ENDPOINTS, make_client } from "../support/notify-client.js";
import {
    PRINCIPALS, build_site, expected_visible,
} from "../support/site-builder.js";

const { App, Perm, Class } = Constants;
const { Info } = UUIDs.App;

/* UseDevice on every device, and nothing else. */
const DEVICES = "devices@EXAMPLE.ORG";
/* ReadDataset on every dataset by name, and on each new object as it
 * is created, as the owner of the objects would have. */
const OWNER = "owner@EXAMPLE.ORG";

const WHO = {
    root:       ROOT,
    wild:       PRINCIPALS.wild,
    devices:    DEVICES,
    owner:      OWNER,
};

const SEARCHES = ["metadata_search", "structure_search"];
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

/* The messages one new default dataset costs a session, by endpoint.
 * A session that gains the dataset everywhere gets it on both
 * searches, and its name on the metadata search, and each list again.
 * The owner may only read it. */
const GAINS_ALL = {
    metadata_search: 2, structure_search: 1,
    metadata_list: 1, structure_list: 1, union_sources: 1, session_sources: 1,
    metadata_uuid: 0, structure_uuid: 0,
};
const MESSAGES_PER_DATASET = {
    root:       GAINS_ALL,
    wild:       GAINS_ALL,
    devices:    GAINS_ALL,
    owner: {
        metadata_search: 2, structure_search: 0,
        metadata_list: 1, structure_list: 0, union_sources: 0, session_sources: 0,
        metadata_uuid: 0, structure_uuid: 0,
    },
};

/* The bodies one new default dataset makes a session's views work
 * out, by endpoint: the dataset, and for a metadata search its name
 * as well. A view that may not show the dataset still looks at it
 * once. The single watches are on other datasets. */
const BODIES_PER_DATASET = {
    metadata_search: 2, structure_search: 1,
    metadata_list: 1, structure_list: 1, union_sources: 1, session_sources: 1,
    metadata_uuid: 0, structure_uuid: 0,
};

/* A permission and UseDevice, for each of a session's eight views. */
const ACL_WATCHES_PER_SESSION = 16;
/* A GET /v1/metadata or a GET /v1/structure/:uuid watches a permission
 * and UseDevice while it answers, for a principal that is not root. */
const ACL_WATCHES_PER_HTTP_READ = 2;

const TICK = 50;

const sorted = list => [...list].sort();
const times = (per, n) =>
    Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v * n]));

/* start+1 + start+2 + ... + start+n: what a list that starts at
 * `start` entries and is sent whole each time it gains one costs over
 * `n` gains. */
const growing = (start, n) => n * start + n * (n + 1) / 2;

/* Captured before any test installs fake timers. */
const real_immediate = globalThis.setImmediate;

const advance = ms => vi.advanceTimersByTimeAsync(ms);
/* One real turn of the event loop, which runs every promise callback
 * that is ready and moves the fake clock nowhere. */
const turn = () => new Promise(resolve => real_immediate(resolve));

/* Wait for `promise` on the fake clock: advance it a millisecond at a
 * time until the promise settles, for at most `limit` ms. A promise
 * that needs no timer takes no time. Returns its value and the time
 * it took. */
async function finish (promise, limit = 20) {
    let outcome = null;
    promise.then(
        value => { outcome = { value }; },
        error => { outcome = { error }; });
    let spent = 0;
    await turn();
    while (!outcome && spent < limit) {
        await advance(1);
        spent++;
        await turn();
    }
    if (!outcome)
        throw new Error(`A read did not answer within ${limit} ms`);
    if (outcome.error) throw outcome.error;
    return { value: outcome.value, spent };
}

/* Call a route handler as Express does. An APIError the handler throws
 * is the response WebAPI sends for it. */
async function call (api, method, req) {
    const res = {
        code: null,
        body: undefined,
        status (code) { this.code = code; return this; },
        json (body) {
            /* What the client parses from the wire. */
            this.body = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
            return this;
        },
    };
    try {
        await api[method](req, res);
    }
    catch (e) {
        if (typeof e?.status != "number") throw e;
        return { status: e.status };
    }
    return { status: res.code, body: res.body };
}

/* Count what the maker does: the objects it creates and the UNS device
 * entries it writes, how many datasets it makes at once and how many
 * passes run at once. Only the maker gets `cdb`, so the counts hold
 * the maker's calls and no others. Call this before run(). */
function watch_maker (site, make) {
    const seen = {
        creates: [], uns_puts: [],
        makes: 0, in_flight: 0, most_in_flight: 0,
        passes: [], running: 0, most_running: 0,
    };

    const cdb = {
        ...site.cdb,
        create_object: (klass, obj, ...rest) => {
            seen.creates.push(obj);
            return site.cdb.create_object(klass, obj, ...rest);
        },
        put_config: (app, obj, config) => {
            if (app == App.UNSDevice) seen.uns_puts.push(obj);
            return site.cdb.put_config(app, obj, config);
        },
    };
    const maker = make(cdb);

    const make_one = maker.make.bind(maker);
    maker.make = async (...args) => {
        seen.makes++;
        seen.in_flight++;
        seen.most_in_flight = Math.max(seen.most_in_flight, seen.in_flight);
        try {
            return await make_one(...args);
        }
        finally {
            seen.in_flight--;
        }
    };

    const make_all = maker.make_all.bind(maker);
    maker.make_all = async (missing, ...rest) => {
        const pass = { items: missing.length, result: null };
        seen.passes.push(pass);
        seen.running++;
        seen.most_running = Math.max(seen.most_running, seen.running);
        try {
            return pass.result = await make_all(missing, ...rest);
        }
        finally {
            seen.running--;
        }
    };

    return { maker, seen };
}

/** Build a site, open four sessions, and let the maker make a default
 * dataset for every placed device.
 *
 * Runs on fake timers, so the pass takes no real time and each run
 * does the same thing in the same order. Everything is closed before
 * this returns; what it returns is a record of what happened. The
 * caller restores real timers.
 *
 * @arg opts.datasets How many datasets the site starts with. None is
 * a default dataset.
 * @arg opts.devices How many devices. Every device has a name.
 * @arg opts.placed How many of the devices are placed.
 * @arg opts.infos How many General information entries the site has.
 * @arg opts.notify_lag Milliseconds between a change and its
 * notification.
 * @arg opts.http Whether to call the HTTP read routes during the
 * burst. With a notify lag the service trails the site, so there is
 * no one right answer to compare with.
 * @arg opts.duration How long to run for, in fake milliseconds.
 */
async function burst (opts) {
    vi.useFakeTimers();

    /* Every line the service logs. A failure of any kind is logged. */
    const logs = [];
    const debug = {
        bound: name => (fmt, ...args) => logs.push({ name, fmt, args }),
    };

    const site = make_site({
        latency:            1,
        notify_lag:         opts.notify_lag ?? 0,
        grant_on_create:    { principal: OWNER, permission: Perm.ReadDataset },
    });
    const built = build_site(site, {
        datasets: opts.datasets, defaults: 0, devices: opts.devices,
        placed: opts.placed, infos: opts.infos, seed: 713,
    });
    site.set_acl(DEVICES, built.devices.map(target =>
        ({ permission: Perm.UseDevice, target })));
    site.set_acl(OWNER, built.datasets.map(target =>
        ({ permission: Perm.ReadDataset, target })));

    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const client = make_client({ data, site });
    const { maker, seen } = watch_maker(site, cdb =>
        new DefaultDatasets({ data, cdb, debug }));
    const api = new APIv1({
        data,
        /* A route logs each request it refuses. That is no failure. */
        debug:      { bound: () => () => {} },
        auth:       site.auth,
        cdb:        site.cdb,
        buckets:    { sparkplug: "sparkplug-bucket", uns: "uns-bucket" },
    });

    /* An error on a DataFlow source reaches every subscriber. */
    const source_errors = [];
    const sources = ["changes", "info_changes", "metadata_changes",
        "functional_changes", "parts_changes"];
    const source_subs = sources.map(name => data[name].subscribe({
        error: e => source_errors.push(`${name}: ${e}`),
    }));

    const close = async () => {
        maker.stop();
        for (const sub of source_subs) sub.unsubscribe();
        await client.stop();
        data.stop();
        site.close();
        /* Let the timers that closing leaves behind run out. */
        await advance(10000);
    };

    try {
        /* ---- The sessions ---- */

        const unrelated = {
            metadata_uuid:  built.kinds.sessions[1],
            structure_uuid: built.kinds.unions[1],
        };
        const open_session = principal => Object.fromEntries(
            Object.entries(ENDPOINTS).map(([endpoint, make]) =>
                [endpoint, client.open(principal, make(unrelated[endpoint]))]));

        const sessions = {};
        for (const [who, principal] of Object.entries(WHO))
            sessions[who] = open_session(principal);
        /* Past the turn of the loop each search keeps updates for. */
        await advance(1);
        await site.settle();

        const each_rec = fn => {
            for (const [who, recs] of Object.entries(sessions))
                for (const [endpoint, rec] of Object.entries(recs))
                    fn(rec, who, endpoint);
        };
        const view_of = (who, endpoint) => {
            const found = [...client.dan.views].filter(v =>
                v.principal == WHO[who] && v.name == VIEW_OF[endpoint]);
            if (found.length != 1)
                throw new Error(`${found.length} views for ${who} ${endpoint}`);
            return found[0];
        };

        /* ---- Before ---- */

        const before = {
            state: {}, messages: {}, computed: {}, views: {},
            members:    site.members(Class.Dataset).size,
            infos:      site.app(Info).size,
            acl:        { owner: site.acl(OWNER).length, devices: site.acl(DEVICES).length },
            acl_watches: site.subs.acl.get(OWNER)?.size ?? 0,
            resolved:   data.index.stats.resolved,
            scanned:    data.parts_stats.scanned,
            visible:    Object.fromEntries(Object.entries(WHO)
                .map(([who, p]) => [who, expected_visible(site, p)])),
        };
        each_rec((rec, who, endpoint) => {
            (before.state[who] ??= {})[endpoint] = rec.state();
            (before.messages[who] ??= {})[endpoint] = rec.messages.length;
            const view = (before.views[who] ??= {})[endpoint] = view_of(who, endpoint);
            (before.computed[who] ??= {})[endpoint] = view.stats.computed;
        });

        const missing = built.placed.map(device =>
            ({ device, dataset: default_dataset_uuid(device) }));
        const logged = logs.length;
        site.reset_counters();

        /* ---- The burst ---- */

        /* A list WATCH sends its whole list each time, and a session
         * keeps only the newest. Keeping every one of them here would
         * hold millions of UUIDs, so each tick the lists are counted
         * and all but the newest dropped. */
        const lists = {};
        const refused = [];
        const tally_lists = () => each_rec((rec, who, endpoint) => {
            if (!LISTS.includes(endpoint)) return;
            /* `kept` is how many messages at the front of the
             * recording are counted already. */
            const tally = (lists[who] ??= {})[endpoint] ??=
                { kept: before.messages[who][endpoint], messages: 0, elements: 0 };
            const fresh = rec.messages.slice(tally.kept);
            for (const m of fresh) {
                if (m.status >= 400 || !Array.isArray(m.response?.body))
                    refused.push({ who, endpoint, message: m });
                else
                    tally.elements += m.response.body.length;
            }
            tally.messages += fresh.length;
            if (rec.messages.length > 1)
                rec.messages.splice(0, rec.messages.length - 1);
            tally.kept = rec.messages.length;
        });

        const uns = site.app(App.UNSDevice);
        const reads = [];
        const read_routes = async () => {
            const made = missing.filter(m => uns.has(m.dataset));
            const read = { made: made.length, spent: 0, answers: [] };
            const want_list = who => expected_visible(site, WHO[who]).metadata;
            const answer = (name, got, want) => read.answers.push({ name, got, want });

            /* The lists, for a principal who sees everything and one
             * who sees only the default datasets. */
            for (const who of ["root", "devices"]) {
                const want = want_list(who);
                const { value, spent } = await finish(
                    call(api, "metadata_list", { auth: WHO[who] }));
                read.spent += spent;
                answer(`GET /v1/metadata as ${who}`,
                    { status: value.status, body: sorted(value.body ?? []) },
                    { status: 200, body: want });
            }

            /* The newest dataset, as root and through UseDevice on its
             * device, and one that has not been made yet. */
            const newest = made.at(-1);
            if (newest) {
                const want = { status: 200, body: {
                    structure: App.UNSDevice, config: { source: newest.device } } };
                for (const who of ["root", "devices"]) {
                    const { value, spent } = await finish(call(api, "structure_uuid",
                        { auth: WHO[who], params: { uuid: newest.dataset } }));
                    read.spent += spent;
                    answer(`GET /v1/structure/:made as ${who}`, value, want);
                }
            }
            const waiting = missing.find(m => !uns.has(m.dataset));
            if (waiting) {
                const { value, spent } = await finish(call(api, "structure_uuid",
                    { auth: ROOT, params: { uuid: waiting.dataset } }));
                read.spent += spent;
                answer("GET /v1/structure/:unmade as root", value, { status: 404 });
            }
            reads.push(read);
            return read.spent;
        };

        maker.run();
        for (let t = 0; t < opts.duration; t += TICK) {
            const spent = opts.http ? await read_routes() : 0;
            await advance(Math.max(0, TICK - spent));
            tally_lists();
        }
        await site.settle();
        tally_lists();

        /* ---- After ---- */

        const report = site.report();
        const after = {
            state: {}, messages: {}, computed: {},
            report,
            members:    site.members(Class.Dataset).size,
            infos:      site.app(Info).size,
            resolved:   data.index.stats.resolved,
            scanned:    data.parts_stats.scanned,
            acl_subscribes: Object.fromEntries(Object.entries(WHO).map(([who, p]) =>
                [who, [...site.counters.acl]
                    .filter(([key]) => key.startsWith(`${p} `))
                    .reduce((n, [, count]) => n + count, 0)])),
            visible:    Object.fromEntries(Object.entries(WHO)
                .map(([who, p]) => [who, expected_visible(site, p)])),
            logs:       logs.slice(logged),
            ended:      [],
        };
        each_rec((rec, who, endpoint) => {
            (after.state[who] ??= {})[endpoint] = rec.state();
            (after.messages[who] ??= {})[endpoint] = LISTS.includes(endpoint)
                ? lists[who][endpoint].messages
                : rec.messages.length - before.messages[who][endpoint];
            (after.computed[who] ??= {})[endpoint] =
                before.views[who][endpoint].stats.computed - before.computed[who][endpoint];
            if (rec.error || rec.ended)
                after.ended.push({ who, endpoint, error: String(rec.error) });
        });

        /* What a client that connects now is told. */
        const fresh = {};
        for (const [who, principal] of Object.entries(WHO)) {
            const recs = open_session(principal);
            await advance(1);
            await site.settle();
            fresh[who] = Object.fromEntries(Object.entries(recs)
                .map(([endpoint, rec]) => [endpoint, rec.state()]));
            for (const rec of Object.values(recs)) rec.close();
        }

        return {
            site, built, sessions, seen, missing, reads, lists, refused,
            before, after, fresh, source_errors, unrelated,
        };
    }
    finally {
        await close();
    }
}

/* The site the plan was written for: 132 datasets, 587 devices of
 * which 581 are placed, and 1,636 General information entries. */
const PRODUCTION = {
    datasets: 132, devices: 587, placed: 581, infos: 1636,
    notify_lag: 0, http: true, duration: 6000,
};

/* A smaller site whose notifications arrive 7 ms after each write, so
 * the dataset map, the names and the ACL all trail the maker. */
const LAGGED = {
    datasets: 40, devices: 63, placed: 57, infos: 200,
    notify_lag: 7, http: false, duration: 6000,
};

describe.each([
    ["581 placed devices on a site of 132 datasets", PRODUCTION],
    ["57 placed devices, with every notification 7 ms late", LAGGED],
])("%s, with four sessions open", (_, opts) => {
    let run;
    const n = opts.placed;

    beforeAll(async () => {
        try {
            run = await burst(opts);
        }
        finally {
            vi.useRealTimers();
        }
    }, 120000);

    test("the site is the one described", () => {
        const { built, before, site } = run;
        expect(built.datasets).toHaveLength(opts.datasets);
        expect(built.defaults).toHaveLength(0);
        expect(built.devices).toHaveLength(opts.devices);
        expect(built.placed).toHaveLength(n);
        expect(before.infos).toBe(opts.infos);
        /* Every device has a name, and no placed device has a default
         * dataset. */
        for (const device of built.devices)
            expect(typeof site.app(Info).get(device).name).toBe("string");
        for (const { dataset } of run.missing)
            expect(before.visible.root.structure).not.toContain(dataset);

        expect(before.visible.root.metadata).toHaveLength(opts.datasets);
        expect(before.visible.wild.metadata).toHaveLength(opts.datasets);
        expect(before.visible.devices).toEqual({
            metadata: [], structure: [], union_sources: [], session_sources: [] });
        expect(before.visible.owner).toEqual({
            metadata: sorted(built.datasets),
            structure: [], union_sources: [], session_sources: [],
        });
        expect(before.acl).toEqual({ owner: opts.datasets, devices: opts.devices });
    });

    test("every session held all eight subscriptions, answered, before the burst", () => {
        const { before } = run;
        for (const who of Object.keys(WHO)) {
            const visible = before.visible[who];
            const state = before.state[who];
            expect([who, Object.keys(state.metadata_search.children)])
                .toEqual([who, visible.metadata]);
            expect([who, Object.keys(state.structure_search.children)])
                .toEqual([who, visible.structure]);
            expect([who, state.metadata_list.body]).toEqual([who, visible.metadata]);
            expect([who, state.structure_list.body]).toEqual([who, visible.structure]);
            expect([who, state.union_sources.body]).toEqual([who, visible.union_sources]);
            expect([who, state.session_sources.body]).toEqual([who, visible.session_sources]);
            /* One snapshot or list each, and nothing after it. */
            for (const endpoint of [...SEARCHES, ...LISTS])
                expect([who, endpoint, before.messages[who][endpoint]])
                    .toEqual([who, endpoint, 1]);
        }
        /* The single watches are on datasets that exist. */
        expect(before.state.root.metadata_uuid.body.uuid).toBe(run.unrelated.metadata_uuid);
        expect(before.state.root.structure_uuid.body.structure).toBe(App.UnionComponents);
        expect(before.acl_watches).toBe(ACL_WATCHES_PER_SESSION);
    });

    test("the maker creates each dataset once, at most 4 at a time, in one pass", () => {
        const { seen, missing, site, after } = run;
        const wanted = missing.map(m => m.dataset);

        expect(seen.creates).toHaveLength(n);
        expect(new Set(seen.creates)).toEqual(new Set(wanted));
        expect(seen.uns_puts).toHaveLength(n);
        expect(new Set(seen.uns_puts)).toEqual(new Set(wanted));
        expect(after.report.calls).toBeGreaterThanOrEqual(5 * n);
        expect(site.counters.calls.get("create_object")).toBe(n);
        expect(seen.makes).toBe(n);

        expect(seen.most_in_flight).toBe(4);
        expect(seen.most_running).toBe(1);
        /* One pass made them all. A pass after it finds nothing. */
        expect(seen.passes[0]).toEqual({ items: n, result: n });
        for (const pass of seen.passes.slice(1))
            expect(pass.result).toBe(0);

        /* Every dataset is whole: a member, with its entry and the
         * name of its device. */
        const infos = site.app(Info);
        for (const { device, dataset } of missing) {
            expect(site.app(App.UNSDevice).get(dataset)).toEqual({ source: device });
            expect(infos.get(dataset).name).toBe(infos.get(device).name);
            expect(site.members(Class.Dataset).has(dataset)).toBe(true);
        }
        expect(after.members).toBe(run.before.members + n);
        expect(after.infos).toBe(run.before.infos + n);
    });

    test("each dataset is worked out once", () => {
        expect(run.after.resolved - run.before.resolved).toBe(n);
    });

    test("each session gets exactly the messages its client needs", () => {
        const { after } = run;
        for (const who of Object.keys(WHO))
            expect([who, after.messages[who]])
                .toEqual([who, times(MESSAGES_PER_DATASET[who], n)]);

        /* In all: 3 search messages a dataset for a session that
         * gains every dataset, and 2 for the owner. */
        const search_total = who =>
            SEARCHES.reduce((sum, e) => sum + after.messages[who][e], 0);
        for (const who of ["root", "wild", "devices"])
            expect([who, search_total(who)]).toEqual([who, 3 * n]);
        expect(search_total("owner")).toBe(2 * n);
        expect(after.report.messages).toBe((3 * (3 + 4) + 2 + 1) * n);
    });

    test("a new dataset appears with no name, then gets its device's name, and never goes away", () => {
        const { sessions, site, missing, before } = run;
        const infos = site.app(Info);

        for (const who of Object.keys(WHO)) {
            const updates = sessions[who].metadata_search.messages
                .slice(before.messages[who].metadata_search);
            const by_child = new Map();
            for (const m of updates) {
                if (!by_child.has(m.child)) by_child.set(m.child, []);
                by_child.get(m.child).push(m);
            }
            expect([who, by_child.size]).toEqual([who, n]);
            for (const { device, dataset } of missing) {
                expect(by_child.get(dataset)).toEqual([
                    { status: 200, child: dataset, response: { status: 201, body: {
                        uuid: dataset, name: "UNKNOWN", parts: [] } } },
                    { status: 200, child: dataset, response: { status: 200, body: {
                        uuid: dataset, name: infos.get(device).name, parts: [] } } },
                ]);
            }
        }

        for (const who of ["root", "wild", "devices"]) {
            const updates = sessions[who].structure_search.messages
                .slice(before.messages[who].structure_search);
            const by_child = new Map(updates.map(m => [m.child, m]));
            expect([who, updates.length, by_child.size]).toEqual([who, n, n]);
            for (const { device, dataset } of missing) {
                expect(by_child.get(dataset)).toEqual({
                    status: 200, child: dataset, response: { status: 201, body: {
                        structure: App.UNSDevice, config: { source: device } } },
                });
            }
        }
    });

    test("no session gets a status of 400 or more, and no source fails", () => {
        const { sessions, after, refused, source_errors } = run;

        expect(refused).toEqual([]);
        expect(after.ended).toEqual([]);
        const bad = [];
        for (const [who, recs] of Object.entries(sessions)) {
            for (const [endpoint, rec] of Object.entries(recs)) {
                for (const m of rec.messages) {
                    if (m.status >= 400 || m.response?.status >= 400)
                        bad.push({ who, endpoint, message: m });
                }
            }
        }
        expect(bad).toEqual([]);

        expect(source_errors).toEqual([]);
        /* Every failure the service can have is logged. */
        const failures = after.logs.filter(l =>
            /fail|can't|stopped|error|retry/i.test(l.fmt));
        expect(failures).toEqual([]);
        const made = after.logs.filter(l => /^Made default dataset/.test(l.fmt));
        expect(made).toHaveLength(n);
    });

    test("each session ends with the state a client that connects afterwards is told", () => {
        const { after, fresh, built } = run;
        const total = built.datasets.length + n;

        for (const who of Object.keys(WHO)) {
            for (const endpoint of Object.keys(ENDPOINTS))
                expect([who, endpoint, after.state[who][endpoint]])
                    .toEqual([who, endpoint, fresh[who][endpoint]]);

            /* And it is what the site's own state says they may see. */
            const visible = after.visible[who];
            const state = after.state[who];
            expect([who, Object.keys(state.metadata_search.children)])
                .toEqual([who, visible.metadata]);
            expect([who, Object.keys(state.structure_search.children)])
                .toEqual([who, visible.structure]);
            expect([who, state.metadata_list.body]).toEqual([who, visible.metadata]);
            expect([who, state.structure_list.body]).toEqual([who, visible.structure]);
            expect([who, state.union_sources.body]).toEqual([who, visible.union_sources]);
            expect([who, state.session_sources.body]).toEqual([who, visible.session_sources]);
        }

        const children = (who, endpoint) =>
            Object.keys(after.state[who][endpoint].children).length;
        for (const endpoint of SEARCHES) {
            expect(children("root", endpoint)).toBe(total);
            expect(children("wild", endpoint)).toBe(total);
            expect(children("devices", endpoint)).toBe(n);
        }
        expect(children("owner", "metadata_search")).toBe(total);
        expect(children("owner", "structure_search")).toBe(0);

        /* The single watches hold what they held. */
        for (const who of Object.keys(WHO))
            for (const endpoint of SINGLES)
                expect([who, endpoint, after.state[who][endpoint]])
                    .toEqual([who, endpoint, run.before.state[who][endpoint]]);
    });

    test.runIf(opts.datasets == 132 && n == 581)(
    "the searches end with 713, 713 and 581 children, and the owner's metadata search with 713", () => {
        const children = (who, endpoint) =>
            Object.keys(run.after.state[who][endpoint].children).length;
        expect(SEARCHES.map(e => children("root", e))).toEqual([713, 713]);
        expect(SEARCHES.map(e => children("wild", e))).toEqual([713, 713]);
        expect(SEARCHES.map(e => children("devices", e))).toEqual([581, 581]);
        expect(children("owner", "metadata_search")).toBe(713);
        for (const who of ["root", "wild", "devices"])
            expect(SEARCHES.reduce((sum, e) => sum + run.after.messages[who][e], 0))
                .toBe(1743);
    });

    test("each view works out a body for the new dataset, and its name, and no other", () => {
        const { after } = run;
        for (const who of Object.keys(WHO))
            expect([who, after.computed[who]])
                .toEqual([who, times(BODIES_PER_DATASET, n)]);
    });

    test("the work that still grows with the site is what its formula gives", () => {
        const { before, after, lists, reads } = run;
        const { report } = after;

        /* ConfigDB sends the whole Dataset member list each time it
         * gains a member, and Data Access reads it once. */
        const member_elements = growing(before.members, n);
        expect(after.scanned - before.scanned).toBe(member_elements);
        /* The maker reads the Device members and the placements once,
         * as it starts. */
        expect(report.member_elements).toBe(member_elements + opts.devices);
        /* One new WATCH a dataset, for its parts. The maker's two, and
         * no other. */
        expect(report).toMatchObject({
            subclass_watches: n, subclass_subscribes: n,
            member_watches: 1, search_subscribes: 1,
        });

        /* A list WATCH sends its whole list each time it gains a
         * dataset. */
        let list_elements = 0;
        for (const who of Object.keys(WHO)) {
            for (const list of LISTS) {
                const gains = MESSAGES_PER_DATASET[who][list] * n;
                const want = gains
                    ? growing(before.state[who][list].body.length, gains) : 0;
                expect([who, list, lists[who][list].elements]).toEqual([who, list, want]);
                list_elements += want;
            }
        }
        expect(report.list_elements).toBe(list_elements);

        /* Auth sends the owner's whole ACL each time it gains a
         * target, and each of the owner's open permission watches
         * filters it. Nobody else's ACL changes. An HTTP read by a
         * principal with an ACL filters that ACL while it answers. */
        const http_reads = reads.reduce((sum, read) => sum
            + read.answers.filter(a => / as devices$/.test(a.name)).length, 0);
        expect(after.acl_subscribes).toEqual({
            root: 0, wild: 0, owner: 0,
            devices: http_reads * ACL_WATCHES_PER_HTTP_READ,
        });
        expect(report.acl_scanned).toBe(
            ACL_WATCHES_PER_SESSION * growing(before.acl.owner, n)
            + after.acl_subscribes.devices * before.acl.devices);
    });

    test.runIf(opts.http)("the HTTP read routes answer with the state of the moment, all through the burst", () => {
        const { reads } = run;
        const during = reads.filter(read => read.made > 0 && read.made < n);
        /* The pass lasts long enough to be read many times. */
        expect(during.length).toBeGreaterThanOrEqual(10);
        expect(reads[0].made).toBe(0);
        expect(reads.at(-1).made).toBe(n);
        /* Each read saw more than the one before, while it lasted. */
        for (let i = 1; i < during.length; i++)
            expect(during[i].made).toBeGreaterThan(during[i - 1].made);

        const names = new Set();
        for (const read of reads) {
            for (const { name, got, want } of read.answers) {
                names.add(name);
                expect([read.made, name, got]).toEqual([read.made, name, want]);
            }
        }
        expect(sorted(names)).toEqual([
            "GET /v1/metadata as devices",
            "GET /v1/metadata as root",
            "GET /v1/structure/:made as devices",
            "GET /v1/structure/:made as root",
            "GET /v1/structure/:unmade as root",
        ]);
        /* The lists grew with the burst. */
        const listed = during.map(read => read.answers
            .find(a => a.name == "GET /v1/metadata as devices").got.body.length);
        expect(listed).toEqual(during.map(read => read.made));
    });

    /* The exact counts above are the proof. This is a guard against a
     * large regression only, and it reads the real clock, so its
     * limits leave room for a machine that is busy with other work:
     * limits of 50 ms and 2 s failed twice beside other test suites.
     * Alone, the longest block is about 0.7 ms and the total about
     * 0.44 s. The handlers this branch replaced blocked for 2.9 s for
     * each dataset with one session open, and for more with four, so
     * they would pass neither limit: the longest block by 6 times at
     * the least, and the total by more than 80 times. */
    test.runIf(opts.notify_lag == 0)("no notification blocks the event loop for 500 ms, and all of them together block it for under 20 s", () => {
        const { report } = run.after;
        /* A member list, an ACL, a UNS device entry and a name for
         * each dataset, and the object's registration, which nobody
         * here watches. */
        expect(report.blocks).toBe(4 * n);
        expect(report.longest_block_ms).toBeLessThan(500);
        expect(report.total_block_ms).toBeLessThan(20000);
    });
});
