/*
 * ACS Data Access Service
 * DatasetView: what one notify subscription shows, one dataset at a time
 * Copyright 2026 University of Sheffield
 */

/* The first half drives a view from scripted sources, so each test
 * says exactly which value arrives when. The second half runs the
 * real notify handlers over a fake site: the statuses a client gets,
 * what an error and a reconnect do, and a random walk that compares
 * every open view with a from-scratch computation after each step.
 *
 * They run against fakes, so they need no cluster. */

import * as imm from "immutable";
import * as rx from "rxjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";
import { SearchFilter, json_equal } from "@amrc-factoryplus/service-api";

import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import {
    DatasetView, member_body, metadata_body, search_source, structure_body,
    watch_key, watch_list,
} from "../../lib/dataset-view.js";
import { READ_STRUCTURE, default_dataset_uuid } from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { ENDPOINTS, make_client, search, watch } from "../support/notify-client.js";
import {
    METADATA_APPS, PRINCIPALS, STRUCTURE_APPS, build_site, prng,
} from "../support/site-builder.js";

const { App, Perm, Class, Kind, Group, Metadata, Special } = Constants;
const { Info } = UUIDs.App;

const debug = { bound: () => () => {} };

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
    vi.useRealTimers();
});

const sorted = list => [...list].sort();

/* Let every promise callback that is ready run, and one turn of the
 * event loop go by. */
const turn = () => new Promise(resolve => setImmediate(resolve));

/* Let every promise callback that is ready run, without a turn of the
 * event loop. For tests that fake setImmediate. */
async function microtasks () {
    for (let i = 0; i < 20; i++) await null;
}

/* ---- Scripted sources ---- */

const TAGS = ["data", "check", "info", "meta", "ftypes", "parts"];

const A = "da7a0000-0000-4000-8000-00000000000a";
const B = "da7a0000-0000-4000-8000-00000000000b";
const C = "da7a0000-0000-4000-8000-00000000000c";
const DEVICE = "de71ce00-0000-4000-8000-000000000001";

const INVALID = {
    structure: Special.InvalidDataset, config: null, from: null, to: null,
};
const entry = (config = { source: DEVICE }) =>
    ({ structure: App.SparkplugSrc, config, from: null, to: null });

/* A value of the `data` source, from the entries of the dataset map.
 * `defaults` maps a default dataset to its device. */
function data_value (entries, changed = null, defaults = {}) {
    const datasets = imm.Map(entries);
    const is_valid = e => e.structure != Special.InvalidDataset;
    return {
        datasets,
        valid:      datasets.filter(is_valid),
        invalid:    datasets.filter(e => !is_valid(e)),
        defaults:   imm.Map(defaults),
        changed:    changed && new Set(changed),
    };
}

/* A value of the `check` source. `allowed` is true for everything, or
 * a list of the datasets and devices the principal holds a grant on. */
function check_value (allowed, changed = null) {
    const set = allowed === true ? null : new Set(allowed);
    return {
        ok: (id, device) => !set || set.has(id) || (device != null && set.has(device)),
        changed: changed && new Set(changed),
    };
}

const map_value = (entries, changed = null) =>
    ({ map: imm.Map(entries), changed: changed && new Set(changed) });

/* A value of the `parts` source, from dataset -> list of parts. */
function parts_value (entries, changed = null) {
    const parents = new Map();
    for (const [dataset, parts] of Object.entries(entries)) {
        for (const part of parts) {
            if (!parents.has(part)) parents.set(part, new Set());
            parents.get(part).add(dataset);
        }
    }
    return {
        map: imm.Map(Object.entries(entries).map(([k, v]) => [k, imm.Set(v)])),
        changed: changed && new Set(changed),
        parents,
    };
}

/* One source per tag that a test feeds by hand. Each replays its
 * latest value to a new subscriber, as the shared DataFlow sequences
 * do. `open` counts the subscriptions held on each. */
function scripted (tags = TAGS) {
    const feed = {};
    const sources = {};
    const open = {};
    const subscribed = {};
    for (const tag of tags) {
        const subject = new rx.ReplaySubject(1);
        feed[tag] = subject;
        open[tag] = 0;
        subscribed[tag] = 0;
        sources[tag] = new rx.Observable(subscriber => {
            open[tag]++;
            subscribed[tag]++;
            const sub = subject.subscribe(subscriber);
            return () => {
                open[tag]--;
                sub.unsubscribe();
            };
        });
    }
    return { feed, sources, open, subscribed };
}

/* A metadata view over scripted sources. */
function metadata_view (s, opts = {}) {
    return new DatasetView({
        sources:    s.sources,
        required:   ["data", "check"],
        candidates: st => st.data.valid,
        body:       metadata_body,
        ...opts,
    });
}

/* Subscribe and record every value, as the JSON a client would get. */
function record (seq) {
    const rec = { values: [], errors: [], done: false };
    rec.sub = seq.subscribe({
        next:       v => rec.values.push(JSON.parse(JSON.stringify(v))),
        error:      e => rec.errors.push(e),
        complete:   () => { rec.done = true; },
    });
    cleanup.push(() => rec.sub.unsubscribe());
    return rec;
}

/* A SEARCH over a view, as the notify library and a Session build it:
 * the snapshot handoff of SearchFilter, then the drop of a message
 * equal to the one before. */
function search_of (view) {
    const filter = new SearchFilter({ path: "v2/test/", handler: () => {} });
    return filter.build_search(search_source(view))
        .pipe(rx.distinctUntilChanged(json_equal));
}

const body_of = (uuid, more = {}) => ({ uuid, name: "UNKNOWN", parts: [], ...more });
const child = (status, uuid, body) => body
    ? { status: 200, child: uuid, response: { status, body } }
    : { status: 200, child: uuid, response: { status } };
const snapshot = children => ({
    children: Object.fromEntries(Object.entries(children)
        .map(([uuid, body]) => [uuid, { status: 200, body }])),
    response: { status: 204 },
    status: 201,
});

describe("a view over scripted sources", () => {
    test("builds once every required source has a value, and not before", () => {
        const s = scripted();
        const view = metadata_view(s);
        const rec = record(view.changes());

        expect(rec.values).toEqual([]);
        s.feed.info.next(map_value({ [A]: { name: "Ay" } }));
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }));
        expect(rec.values).toEqual([]);
        expect(view.built).toBe(false);

        s.feed.check.next(check_value([A]));
        expect(rec.values).toEqual([{ built: true, changes: [] }]);
        expect([...view.children]).toEqual([[A, {
            uuid: A, name: "Ay", from: undefined, to: undefined,
            "function": undefined, metadata: undefined, parts: [],
        }]]);
        /* One body for each candidate. */
        expect(view.stats).toEqual({ computed: 2, sent: 0 });
    });

    test("takes what the sources replay at subscribe and builds once, with every value", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }));
        s.feed.check.next(check_value(true));
        s.feed.info.next(map_value({ [A]: { name: "Ay" }, [B]: { name: "Bee" } }));
        s.feed.meta.next(map_value({ [A]: imm.Map({ tags: { x: 1 } }) }));
        s.feed.ftypes.next(map_value({ [B]: imm.List([Kind.Run]) }));
        s.feed.parts.next(parts_value({ [A]: [B, C], [B]: [] }));

        const view = metadata_view(s);
        const rec = record(view.changes());

        /* One value, and the bodies are whole: nothing was built from
         * a part of the sources and then mended. */
        expect(rec.values).toEqual([{ built: true, changes: [] }]);
        expect(view.stats.computed).toBe(2);
        expect(JSON.parse(JSON.stringify(Object.fromEntries(view.children)))).toEqual({
            [A]: { uuid: A, name: "Ay", metadata: { tags: { x: 1 } }, parts: [B, C] },
            [B]: { uuid: B, name: "Bee", "function": [Kind.Run], parts: [] },
        });
        expect(JSON.stringify(view.children.get(A))).toBe(JSON.stringify(
            { uuid: A, name: "Ay", metadata: { tags: { x: 1 } }, parts: [B, C] }));
    });

    test("ready resolves at the first build", async () => {
        const s = scripted();
        const view = metadata_view(s);
        let ready = false;
        view.ready.then(() => { ready = true; });
        record(view.changes());

        s.feed.data.next(data_value({ [A]: entry() }));
        await microtasks();
        expect(ready).toBe(false);

        s.feed.check.next(check_value(true));
        await microtasks();
        expect(ready).toBe(true);
    });

    test("a source that answers after the build has every key looked at, and reports only what differs", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry(), [C]: entry() }));
        s.feed.check.next(check_value(true));
        const view = metadata_view(s);
        const rec = record(view.changes());
        expect(view.stats.computed).toBe(3);

        /* The first value of a source says nothing about which keys
         * changed, whatever its `changed` holds. */
        s.feed.info.next(map_value({ [A]: { name: "Ay" } }, [C]));
        expect(view.stats.computed).toBe(6);
        expect(rec.values.slice(1)).toEqual([{ built: false, changes: [
            { key: A, kind: "changed", body: body_of(A, { name: "Ay" }) },
        ] }]);

        /* From the second value on, `changed` is believed. */
        s.feed.info.next(map_value(
            { [A]: { name: "Ay" }, [B]: { name: "Bee" } }, [B]));
        expect(view.stats.computed).toBe(7);
        expect(rec.values.slice(2)).toEqual([{ built: false, changes: [
            { key: B, kind: "changed", body: body_of(B, { name: "Bee" }) },
        ] }]);
        expect(view.stats.sent).toBe(2);
    });

    test.each(TAGS)("whichever source answers last, here %s, the view ends as one that had every value at subscribe", tag => {
        const values = {
            data:   data_value({ [A]: entry(), [B]: entry(), [C]: INVALID }),
            check:  check_value([A, B, C]),
            info:   map_value({ [A]: { name: "Ay" }, [B]: { name: "Bee" } }),
            meta:   map_value({ [B]: imm.Map({ tags: { x: 1 } }) }),
            ftypes: map_value({ [A]: imm.List([Kind.Run]) }),
            parts:  parts_value({ [A]: [B, C], [B]: [] }),
        };

        const whole = scripted();
        for (const t of TAGS) whole.feed[t].next(values[t]);
        const reference = metadata_view(whole);
        record(reference.changes());

        /* The late value claims nothing changed. It is the first the
         * view has from that source, so the claim is not believed. */
        const s = scripted();
        for (const t of TAGS) if (t != tag) s.feed[t].next(values[t]);
        const view = metadata_view(s);
        const rec = record(view.changes());
        s.feed[tag].next({ ...values[tag], changed: new Set() });

        expect(rec.errors).toEqual([]);
        expect(JSON.stringify([...view.children]))
            .toBe(JSON.stringify([...reference.children]));
        expect(view.children.size).toBe(2);
    });

    test("a null changed Set means every key", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }));
        s.feed.check.next(check_value([A]));
        const view = metadata_view(s);
        const rec = record(view.changes());

        /* A grant on every target came: no list of what changed. */
        s.feed.check.next(check_value(true, null));
        expect(view.stats.computed).toBe(4);
        expect(rec.values.slice(1)).toEqual([{ built: false, changes: [
            { key: B, kind: "created", body: body_of(B) },
        ] }]);
    });

    test("reports created, changed and removed, and nothing for a body that is the same", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry() }));
        s.feed.check.next(check_value(true));
        s.feed.info.next(map_value({ [A]: { name: "Ay" } }));
        const view = metadata_view(s);
        const rec = record(view.changes());

        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }, [B]));
        s.feed.info.next(map_value({ [A]: { name: "Ay2" } }, [A]));
        /* The entry is a new object with the same content. */
        s.feed.info.next(map_value({ [A]: { name: "Ay2" } }, [A]));
        s.feed.data.next(data_value({ [B]: entry() }, [A]));
        /* B turns invalid: a metadata view shows only valid datasets. */
        s.feed.data.next(data_value({ [B]: INVALID }, [B]));

        expect(rec.values.slice(1)).toEqual([
            { built: false, changes: [{ key: B, kind: "created", body: body_of(B) }] },
            { built: false, changes: [
                { key: A, kind: "changed", body: body_of(A, { name: "Ay2" }) }] },
            { built: false, changes: [{ key: A, kind: "removed" }] },
            { built: false, changes: [{ key: B, kind: "removed" }] },
        ]);
        expect(view.children.size).toBe(0);
        expect(view.stats.sent).toBe(4);
    });

    test("a key that is no candidate and no child costs nothing", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry() }));
        s.feed.check.next(check_value(true));
        s.feed.info.next(map_value({}));
        const view = metadata_view(s);
        const rec = record(view.changes());
        const before = view.stats.computed;

        /* A name for an object that is not a dataset. */
        s.feed.info.next(map_value({ [C]: { name: "Not a dataset" } }, [C]));
        expect(view.stats.computed).toBe(before);
        expect(rec.values).toHaveLength(1);
    });

    test("a permission or dataset change to a part reaches the datasets that list it", () => {
        const s = scripted();
        const part = default_dataset_uuid(DEVICE);
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry(), [part]: entry() }));
        s.feed.check.next(check_value([A, B]));
        s.feed.parts.next(parts_value({ [A]: [part], [B]: [], [part]: [] }));
        const view = metadata_view(s);
        const rec = record(view.changes());
        expect(view.children.get(A).parts.toJSON()).toEqual([]);
        const built = view.stats.computed;

        /* The principal gains the part: A's body is the one that
         * changes, and B is not looked at. */
        s.feed.check.next(check_value([A, B, part], [part]));
        expect(view.stats.computed - built).toBe(2);
        expect(rec.values.slice(1)).toEqual([{ built: false, changes: [
            { key: part, kind: "created", body: body_of(part) },
            { key: A, kind: "changed", body: body_of(A, { parts: [part] }) },
        ] }]);

        /* It loses the grant, then reaches the part through its
         * device: the dataset map now says the part is a default
         * dataset, and the principal holds the device. */
        s.feed.check.next(check_value([A, B, DEVICE], [part]));
        expect(view.children.get(A).parts.toJSON()).toEqual([]);
        s.feed.data.next(data_value(
            { [A]: entry(), [B]: entry(), [part]: entry() },
            [part], { [part]: DEVICE }));
        expect(view.children.get(A).parts.toJSON()).toEqual([part]);
        expect(rec.values.at(-1).changes.map(c => [c.key, c.kind])).toEqual([
            [part, "created"], [A, "changed"],
        ]);
    });

    test("a part is listed whether or not it is a valid dataset", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry(), [B]: INVALID }));
        s.feed.check.next(check_value(true));
        /* C has no entry in the dataset map at all. */
        s.feed.parts.next(parts_value({ [A]: [B, C] }));
        const view = metadata_view(s);
        record(view.changes());

        expect(sorted(view.children.get(A).parts)).toEqual(sorted([B, C]));
        expect([...view.children.keys()]).toEqual([A]);
    });

    test("a view of one dataset looks at that dataset only", () => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }));
        s.feed.check.next(check_value(true));
        const view = metadata_view(s, { candidates: [A], required: [] });
        const rec = record(view.changes());
        expect(view.stats.computed).toBe(1);
        expect([...view.children.keys()]).toEqual([A]);

        s.feed.data.next(data_value({ [A]: entry(), [B]: entry(), [C]: entry() }, [C]));
        s.feed.info.next(map_value({ [B]: { name: "Bee" } }));
        s.feed.info.next(map_value({ [B]: { name: "Bee2" } }, [B]));
        /* The first info value looked at A once more. */
        expect(view.stats.computed).toBe(2);
        expect(rec.values).toHaveLength(1);
    });

    test("a view that requires nothing builds at once, with no body it cannot work out", () => {
        const s = scripted();
        const view = metadata_view(s, { candidates: [A], required: [] });
        const rec = record(view.changes());

        expect(rec.values).toEqual([{ built: true, changes: [] }]);
        expect(view.children.size).toBe(0);

        s.feed.data.next(data_value({ [A]: entry() }));
        expect(rec.values).toHaveLength(1);
        s.feed.check.next(check_value(true));
        expect(rec.values.slice(1)).toEqual([{ built: false, changes: [
            { key: A, kind: "created", body: body_of(A) },
        ] }]);
    });

    test.each(TAGS)("an error on the %s source errors the view once and lets go of every source", tag => {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry() }));
        s.feed.check.next(check_value(true));
        const registry = new Set();
        const view = metadata_view(s, { registry });
        const rec = record(view.changes());
        expect(registry.has(view)).toBe(true);
        expect(Object.values(s.open)).toEqual([1, 1, 1, 1, 1, 1]);

        const err = new Error(`${tag} is gone`);
        s.feed[tag].error(err);
        expect(rec.errors).toEqual([err]);
        expect(rec.done).toBe(false);
        expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(registry.size).toBe(0);
    });

    test("a source that has already failed errors the view at subscribe", () => {
        const s = scripted();
        const err = new Error("gone before anyone asked");
        s.feed.info.error(err);
        const view = metadata_view(s);
        const rec = record(view.changes());

        expect(rec.errors).toEqual([err]);
        expect(rec.values).toEqual([]);
        expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);
        /* The sources after the one that failed were never asked. */
        expect(s.subscribed.parts).toBe(0);
    });

    test("a body function that throws errors the view, not the process", () => {
        const s = scripted(["data", "check"]);
        s.feed.data.next(data_value({ [A]: entry() }));
        s.feed.check.next(check_value(true));
        const boom = new Error("bad body");
        let fail = false;
        const view = new DatasetView({
            sources: s.sources,
            required: ["data", "check"],
            candidates: st => st.data.datasets,
            body: (st, id) => {
                if (fail) throw boom;
                return member_body(st, id);
            },
        });
        const rec = record(view.changes());
        expect(rec.values).toHaveLength(1);

        fail = true;
        s.feed.data.next(data_value({ [A]: entry() }, [A]));
        expect(rec.errors).toEqual([boom]);
        expect(Object.values(s.open)).toEqual([0, 0]);
    });

    test("a source that completes does not end the view", () => {
        const view = new DatasetView({
            sources: {
                data: rx.of(data_value({ [A]: entry() })),
                check: rx.of(check_value(true)),
            },
            required: ["data", "check"],
            candidates: st => st.data.datasets,
            body: member_body,
        });
        const rec = record(view.changes());
        expect(rec.values).toEqual([{ built: true, changes: [] }]);
        expect(rec.done).toBe(false);
        expect(rec.errors).toEqual([]);
    });

    test("unsubscribing lets go of every source, and a view runs only once", () => {
        const s = scripted();
        const registry = new Set();
        const view = metadata_view(s, { registry });
        const rec = record(view.changes());
        expect(Object.values(s.open)).toEqual([1, 1, 1, 1, 1, 1]);
        expect([...registry]).toEqual([view]);

        rec.sub.unsubscribe();
        expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(registry.size).toBe(0);

        const again = record(view.changes());
        expect(again.errors).toHaveLength(1);
        expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    test("structure_body gives the invalid marker, or nothing when only valid datasets are wanted", () => {
        const state = {
            data: data_value({ [A]: entry({ source: DEVICE }), [B]: INVALID }),
            check: check_value([A, B]),
        };
        expect(JSON.stringify(structure_body(state, A, true))).toBe(JSON.stringify(
            { structure: App.SparkplugSrc, config: { source: DEVICE } }));
        expect(structure_body(state, B, true)).toBeUndefined();
        expect(JSON.stringify(structure_body(state, B, false))).toBe(JSON.stringify(
            { structure: Special.InvalidDataset, config: null }));
        expect(structure_body(state, C, false)).toBeUndefined();
        expect(structure_body({ ...state, check: check_value([]) }, A, false))
            .toBeUndefined();
        expect(structure_body({ data: state.data }, A, false)).toBeUndefined();
    });
});

describe("a SEARCH over a view", () => {
    /* A view of A and B, built. */
    function ready_search () {
        const s = scripted();
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }));
        s.feed.check.next(check_value(true));
        s.feed.info.next(map_value({ [A]: { name: "Ay" } }));
        const view = metadata_view(s);
        return { s, view };
    }
    const rename = (s, name) =>
        s.feed.info.next(map_value({ [A]: { name } }, [A]));

    test("the first message is the snapshot, and nothing follows it", async () => {
        const { s, view } = ready_search();
        const rec = record(search_of(view));

        /* The snapshot waits for a promise. */
        expect(rec.values).toEqual([]);
        await turn();
        await turn();
        expect(rec.values).toEqual([snapshot({
            [A]: body_of(A, { name: "Ay" }),
            [B]: body_of(B),
        })]);
        expect(Object.keys(rec.values[0])).toEqual(["children", "response", "status"]);
        expect(Object.keys(rec.values[0].children[A])).toEqual(["status", "body"]);
        expect(view.stats.sent).toBe(0);
        expect(s.open.data).toBe(1);
    });

    test("a change before the snapshot is taken is in it, and is not sent again", async () => {
        const { s, view } = ready_search();
        const rec = record(search_of(view));

        /* Subscribed, and full() has not run on yet. */
        rename(s, "Early");
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry(), [C]: entry() }, [C]));
        await turn();
        await turn();

        expect(rec.values).toEqual([snapshot({
            [A]: body_of(A, { name: "Early" }),
            [B]: body_of(B),
            [C]: body_of(C),
        })]);
    });

    test("the snapshot waits for the view to build, and holds what the build found", async () => {
        const s = scripted();
        const view = metadata_view(s);
        const rec = record(search_of(view));
        await turn();
        expect(rec.values).toEqual([]);

        s.feed.data.next(data_value({ [A]: entry() }));
        s.feed.check.next(check_value(true));
        /* In the same turn as the build, before full() runs on. */
        s.feed.info.next(map_value({ [A]: { name: "Ay" } }));
        await turn();
        await turn();
        expect(rec.values).toEqual([snapshot({ [A]: body_of(A, { name: "Ay" }) })]);
    });

    test("a change after the snapshot is sent exactly once", async () => {
        const { s, view } = ready_search();
        const rec = record(search_of(view));
        await turn();
        await turn();

        rename(s, "Later");
        expect(rec.values.slice(1)).toEqual(
            [child(200, A, body_of(A, { name: "Later" }))]);
        s.feed.data.next(data_value({ [A]: entry() }, [B]));
        s.feed.data.next(data_value({ [A]: entry(), [C]: entry() }, [C]));
        await turn();
        expect(rec.values.slice(2)).toEqual([
            child(404, B),
            child(201, C, body_of(C)),
        ]);
        expect(rec.errors).toEqual([]);
    });

    test("2,000 changes that arrive as the snapshot is taken all go out once, in order, after it", async () => {
        const { s, view } = ready_search();
        const rec = record(search_of(view));

        /* full() runs on in a promise callback that is already queued.
         * This callback is queued behind it, so these changes arrive
         * after the snapshot is taken and before it has been sent:
         * exactly where a queue used to build up. */
        let injected = false;
        queueMicrotask(() => {
            injected = true;
            for (let i = 0; i < 2000; i++) rename(s, `Name ${i}`);
        });
        await microtasks();
        expect(injected).toBe(true);
        /* Held: only the snapshot has gone. */
        expect(rec.values).toHaveLength(1);

        await turn();
        await turn();

        expect(rec.errors).toEqual([]);
        expect(rec.values).toHaveLength(2001);
        expect(rec.values[0]).toEqual(snapshot({
            [A]: body_of(A, { name: "Ay" }),
            [B]: body_of(B),
        }));
        expect(rec.values.slice(1).map(m => m.response.body.name))
            .toEqual(Array.from({ length: 2000 }, (_, i) => `Name ${i}`));
        for (const m of rec.values.slice(1))
            expect([m.status, m.child, m.response.status]).toEqual([200, A, 200]);
    });

    test("2,000 children that appear at once after the snapshot are 2,000 updates and no error", async () => {
        const s = scripted(["data", "check"]);
        const ids = Array.from({ length: 2000 },
            (_, i) => `da7a0000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);
        s.feed.data.next(data_value(Object.fromEntries(ids.map(id => [id, entry()]))));
        s.feed.check.next(check_value([]));
        const view = new DatasetView({
            sources: s.sources,
            required: ["data", "check"],
            candidates: st => st.data.datasets,
            body: (st, id) => structure_body(st, id, false),
        });
        const rec = record(search_of(view));
        await turn();
        await turn();
        expect(rec.values).toEqual([snapshot({})]);

        s.feed.check.next(check_value(true, null));
        expect(rec.errors).toEqual([]);
        expect(rec.values).toHaveLength(2001);
        expect(sorted(rec.values.slice(1).map(m => m.child))).toEqual(sorted(ids));
        expect(new Set(rec.values.slice(1).map(m => m.response.status))).toEqual(new Set([201]));
    });

    test("updates held behind the snapshot go out when the next turn of the event loop comes", async () => {
        vi.useFakeTimers({ toFake: ["setImmediate", "clearImmediate"] });
        const { s, view } = ready_search();
        const rec = record(search_of(view));
        await microtasks();
        expect(rec.values).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);

        rename(s, "One");
        rename(s, "Two");
        await microtasks();
        expect(rec.values).toHaveLength(1);

        vi.runAllTimers();
        expect(rec.values.slice(1).map(m => m.response.body.name)).toEqual(["One", "Two"]);
        expect(vi.getTimerCount()).toBe(0);

        /* From here each update goes straight out. */
        rename(s, "Three");
        expect(rec.values).toHaveLength(4);
        expect(vi.getTimerCount()).toBe(0);
    });

    test("a search stopped while it holds updates sends none of them and leaves no timer", async () => {
        vi.useFakeTimers({ toFake: ["setImmediate", "clearImmediate"] });
        const { s, view } = ready_search();
        const rec = record(search_of(view));
        await microtasks();
        expect(rec.values).toHaveLength(1);
        rename(s, "Held");
        expect(vi.getTimerCount()).toBe(1);

        rec.sub.unsubscribe();
        expect(vi.getTimerCount()).toBe(0);
        expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);

        vi.runAllTimers();
        await microtasks();
        expect(rec.values).toHaveLength(1);
    });

    test("a search stopped before the view builds leaves nothing behind", async () => {
        vi.useFakeTimers({ toFake: ["setImmediate", "clearImmediate"] });
        const s = scripted();
        const view = metadata_view(s);
        const rec = record(search_of(view));
        await microtasks();

        rec.sub.unsubscribe();
        expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(vi.getTimerCount()).toBe(0);
        expect(rec.values).toEqual([]);
        expect(rec.errors).toEqual([]);
    });

    test.each(TAGS)("an error on the %s source reaches the client, before the snapshot or after", async tag => {
        const early = ready_search();
        const first = record(search_of(early.view));
        early.s.feed[tag].error(new Error("gone"));
        expect(first.errors).toHaveLength(1);
        expect(first.values).toEqual([]);
        await turn();
        await turn();
        expect(first.values).toEqual([]);

        const late = ready_search();
        const second = record(search_of(late.view));
        await turn();
        await turn();
        late.s.feed[tag].error(new Error("gone"));
        expect(second.errors).toHaveLength(1);
        expect(second.values).toHaveLength(1);
        expect(Object.values(late.s.open)).toEqual([0, 0, 0, 0, 0, 0]);
    });
});

describe("a WATCH over a view", () => {
    function one_key (always) {
        const s = scripted(["data", "check"]);
        const view = new DatasetView({
            sources: s.sources,
            required: always ? [] : ["data", "check"],
            candidates: [A],
            body: (st, id) => structure_body(st, id, true),
        });
        const rec = record(watch_key(view, A, { always }));
        return { s, view, rec };
    }
    const update = body => body === undefined
        ? { status: 200, response: { status: 200 } }
        : { status: 200, response: { status: 200, body } };
    const structure = config => ({ structure: App.SparkplugSrc, config });

    test("watch_key with always sends a 200 with no body at once, then every change", () => {
        const { s, rec } = one_key(true);
        expect(rec.values).toEqual([update()]);

        s.feed.data.next(data_value({ [A]: entry({ n: 1 }) }));
        expect(rec.values).toHaveLength(1);
        s.feed.check.next(check_value(true));
        s.feed.data.next(data_value({ [A]: entry({ n: 2 }), [B]: entry() }, [A, B]));
        /* Nothing for a change to another dataset. */
        s.feed.data.next(data_value({ [A]: entry({ n: 2 }) }, [B]));
        s.feed.data.next(data_value({}, [A]));
        s.feed.data.next(data_value({ [A]: entry({ n: 2 }) }, [A]));

        expect(rec.values.slice(1)).toEqual([
            update(structure({ n: 1 })),
            update(structure({ n: 2 })),
            update(),
            update(structure({ n: 2 })),
        ]);
    });

    test("watch_key with always sends the body first when the view can work it out at subscribe", () => {
        const s = scripted(["data", "check"]);
        s.feed.data.next(data_value({ [A]: entry({ n: 1 }) }));
        s.feed.check.next(check_value(true));
        const view = new DatasetView({
            sources: s.sources,
            candidates: [A],
            body: (st, id) => structure_body(st, id, true),
        });
        const rec = record(watch_key(view, A, { always: true }));
        expect(rec.values).toEqual([update(structure({ n: 1 }))]);
    });

    test("watch_key without always sends only a body, and only one that differs from the last sent", () => {
        const { s, rec } = one_key(false);
        s.feed.data.next(data_value({}));
        s.feed.check.next(check_value(true));
        /* Built, with nothing to show. */
        expect(rec.values).toEqual([]);

        s.feed.data.next(data_value({ [A]: entry({ n: 1 }) }, [A]));
        /* It goes away and comes back the same: nothing is sent. */
        s.feed.data.next(data_value({}, [A]));
        s.feed.data.next(data_value({ [A]: entry({ n: 1 }) }, [A]));
        /* It turns invalid: nothing. Then it comes back changed. */
        s.feed.data.next(data_value({ [A]: INVALID }, [A]));
        s.feed.data.next(data_value({ [A]: entry({ n: 2 }) }, [A]));

        expect(rec.values).toEqual([
            update(structure({ n: 1 })),
            update(structure({ n: 2 })),
        ]);
    });

    test("watch_list sends the whole list at the build and each time a dataset joins or leaves", () => {
        const s = scripted(["data", "check"]);
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry() }));
        const view = new DatasetView({
            sources: s.sources,
            required: ["data", "check"],
            candidates: st => st.data.valid,
            body: member_body,
        });
        const rec = record(watch_list(view));
        expect(rec.values).toEqual([]);

        s.feed.check.next(check_value([A]));
        expect(rec.values).toEqual([update([A])]);

        /* A change to a listed dataset is no change to the list. */
        s.feed.data.next(data_value({ [A]: entry({ n: 2 }), [B]: entry() }, [A]));
        expect(rec.values).toHaveLength(1);

        s.feed.check.next(check_value([A, B], [B]));
        s.feed.data.next(data_value({ [A]: INVALID, [B]: entry() }, [A]));
        s.feed.check.next(check_value([], null));
        expect(rec.values.slice(1).map(m => sorted(m.response.body)))
            .toEqual([sorted([A, B]), [B], []]);

        /* Two datasets join in one change: one message. */
        s.feed.data.next(data_value({ [A]: entry(), [B]: entry(), [C]: entry() }, [A, C]));
        s.feed.check.next(check_value(true, null));
        expect(rec.values.slice(4).map(m => sorted(m.response.body)))
            .toEqual([sorted([A, B, C])]);
    });

    test.each([
        ["watch_key", view => watch_key(view, A, { always: true })],
        ["watch_list", view => watch_list(view)],
    ])("an error on any source ends a %s with that error", (_, make) => {
        for (const tag of TAGS) {
            const s = scripted();
            s.feed.data.next(data_value({ [A]: entry() }));
            s.feed.check.next(check_value(true));
            const rec = record(make(metadata_view(s)));
            expect(rec.values).toHaveLength(1);

            s.feed[tag].error(new Error("gone"));
            expect([tag, rec.errors.length]).toEqual([tag, 1]);
            expect(Object.values(s.open)).toEqual([0, 0, 0, 0, 0, 0]);
        }
    });
});

/* ---- The real handlers over a fake site ---- */

/* A built site, a running DataFlow and a notify client. */
function fixture (opts, site_opts) {
    const site = make_site(site_opts);
    const built = build_site(site, opts);
    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const client = make_client({
        data, site, tokens: { roottoken: ROOT },
    });
    cleanup.push(async () => {
        await client.stop();
        data.stop();
        site.close();
    });
    return { site, built, data, client };
}

async function settled (fx, principal, sub) {
    const rec = fx.client.open(principal, sub);
    await fx.site.settle();
    return rec;
}

/* The messages `change` causes on a recording. */
async function after (fx, rec, change) {
    const seen = rec.messages.length;
    await change();
    await fx.site.settle();
    return rec.messages.slice(seen);
}

const SMALL = { datasets: 60, seed: 61 };

/* The one open view of a kind for a principal. */
function view_of (fx, name, principal) {
    const found = [...fx.client.dan.views]
        .filter(v => v.name == name && v.principal == principal);
    expect([name, principal, found.length]).toEqual([name, principal, 1]);
    return found[0];
}

describe("what a client gets", () => {
    test("201 for a dataset that becomes visible, 200 for a change, 404 when it goes or the grant does", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const { some } = PRINCIPALS;
        const fresh = built.spare(1);
        const config = { source: built.devices[0] };

        const root = await settled(fx, ROOT, search("v2/metadata/"));
        const user = await settled(fx, some, search("v2/metadata/"));
        expect(root.messages).toHaveLength(1);
        expect(user.messages).toHaveLength(1);

        expect(await after(fx, root, () => site.put(App.SparkplugSrc, fresh, config)))
            .toEqual([child(201, fresh, body_of(fresh))]);
        expect(user.messages).toHaveLength(1);

        expect(await after(fx, user, () => site.grant(some, Perm.ReadDataset, fresh)))
            .toEqual([child(201, fresh, body_of(fresh))]);
        expect(await after(fx, user, () => site.put(Info, fresh, { name: "Fresh" })))
            .toEqual([child(200, fresh, body_of(fresh, { name: "Fresh" }))]);
        expect(root.messages.at(-1))
            .toEqual(child(200, fresh, body_of(fresh, { name: "Fresh" })));

        expect(await after(fx, user, () => site.revoke(some, Perm.ReadDataset, fresh)))
            .toEqual([child(404, fresh)]);
        expect(await after(fx, root, () => site.del(App.SparkplugSrc, fresh)))
            .toEqual([child(404, fresh)]);
        expect(user.messages).toHaveLength(4);
    });

    test("a principal with no rights gets a snapshot with no children", async () => {
        const fx = fixture(SMALL);
        for (const parent of ["v2/metadata/", "v2/structure/"]) {
            const rec = await settled(fx, PRINCIPALS.none, search(parent));
            expect(rec.messages).toEqual([snapshot({})]);
        }
    });

    test("a part the principal gains appears in its parent's parts", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const { some } = PRINCIPALS;
        const parent = built.named.part_parent;
        const part = built.kinds.subset[0];
        site.revoke(some, Perm.ReadDataset, part);

        const found = await settled(fx, some, search("v2/metadata/"));
        const watched = await settled(fx, some, watch(`v2/metadata/${parent}`));
        expect(found.state().children[parent].parts).toEqual([]);
        expect(watched.state().body.parts).toEqual([]);

        const sent = await after(fx, found, () => site.grant(some, Perm.ReadDataset, part));
        /* The part becomes a child, and the parent's body changes. */
        expect(sent.map(m => [m.child, m.response.status]).sort()).toEqual(
            [[parent, 200], [part, 201]].sort());
        expect(found.state().children[parent].parts).toEqual([part]);
        expect(watched.state().body.parts).toEqual([part]);

        await after(fx, found, () => site.revoke(some, Perm.ReadDataset, part));
        expect(found.state().children[parent].parts).toEqual([]);
        expect(watched.state().body.parts).toEqual([]);
    });

    test("a part that becomes a Dataset member appears in its parent's parts, though the parent's subclasses did not change", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const parent = built.named.part_parent;
        const pending = built.named.part_pending;
        const part = built.kinds.subset[0];
        expect(site.subclasses(parent).has(pending)).toBe(true);
        expect(site.members(Class.Dataset).has(pending)).toBe(false);

        const found = await settled(fx, ROOT, search("v2/metadata/"));
        const watched = await settled(fx, ROOT, watch(`v2/metadata/${parent}`));
        expect(found.state().children[parent].parts).toEqual([part]);

        /* One update for each dataset that lists it, and no other. */
        const listing = built.parents
            .filter(id => site.subclasses(id).has(pending));
        expect(listing).toContain(parent);
        const sent = await after(fx, found, () => site.add_member(Class.Dataset, pending));
        expect(sent.map(m => [m.child, m.response.status]).sort())
            .toEqual(listing.map(id => [id, 200]).sort());
        expect(found.state().children[parent].parts).toEqual(sorted([part, pending]));
        expect(watched.state().body.parts).toEqual(sorted([part, pending]));

        await after(fx, found, () => site.remove_member(Class.Dataset, pending));
        expect(found.state().children[parent].parts).toEqual([part]);
        expect(watched.state().body.parts).toEqual([part]);
    });

    test("a kind change sends one update for each dataset whose kind changed", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const [first, second] = built.kinds.subset;

        const found = await settled(fx, ROOT, search("v2/metadata/"));
        const view = view_of(fx, "metadata_search", ROOT);
        expect(found.state().children[first]).not.toHaveProperty("function");

        let computed = view.stats.computed;
        const one = await after(fx, found, () => site.add_member(Kind.Equipment, first));
        expect(one).toHaveLength(1);
        expect([one[0].child, one[0].response.status, one[0].response.body.function])
            .toEqual([first, 200, [Kind.Equipment]]);
        expect(view.stats.computed - computed).toBe(1);

        computed = view.stats.computed;
        const two = await after(fx, found, () => site.add_member(Kind.Operation, second));
        expect(two.map(m => m.child)).toEqual([second]);
        expect(view.stats.computed - computed).toBe(1);

        const gone = await after(fx, found, () => site.remove_member(Kind.Equipment, first));
        expect(gone).toHaveLength(1);
        expect(gone[0].response.body).not.toHaveProperty("function");
    });

    test("a client that subscribes late holds what a client that saw every change holds", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const { some } = PRINCIPALS;
        const watched = built.kinds.sessions[0];
        const open_all = () => Object.entries(ENDPOINTS)
            .map(([name, make]) => [name, fx.client.open(some, make(watched))]);

        site.grant(some, Perm.ReadDataset, watched);
        site.grant(some, Perm.EditDataset, watched);
        const early = open_all();
        await site.settle();

        const fresh = built.spare(2);
        site.put(App.SessionLimits, fresh, { source: watched });
        site.add_member(Class.Dataset, fresh);
        site.put(Info, fresh, { name: "Late" });
        site.grant(some, Perm.ReadDataset, fresh);
        site.grant(some, Perm.EditDataset, fresh);
        site.put(Metadata.Tags, watched, { tags: ["late"] });
        site.add_member(Kind.Run, fresh);
        site.set_subclasses(watched, [fresh]);
        site.put(App.SessionLimits, watched, {
            ...site.app(App.SessionLimits).get(watched),
            to: "2027-01-01T00:00:00.000Z",
        });
        await site.settle();

        const late = open_all();
        await site.settle();

        for (let i = 0; i < early.length; i++) {
            const [name, rec] = early[i];
            expect([name, late[i][1].state()]).toEqual([name, rec.state()]);
            /* The late client got it in one message: every source
             * gave its latest value at subscribe. */
            expect([name, late[i][1].messages.length]).toEqual([name, 1]);
        }
        expect(late.find(([name]) => name == "metadata_search")[1]
            .state().children[fresh]).toMatchObject({ name: "Late" });
    });

    test("a closed subscription lets go of its view and of every source it held", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const { some } = PRINCIPALS;
        expect(site.subs.acl.get(some)).toBeUndefined();

        const recs = Object.values(ENDPOINTS)
            .map(make => fx.client.open(some, make(built.kinds.sessions[0])));
        await site.settle();
        expect(fx.client.dan.views.size).toBe(8);
        /* A permission and UseDevice, for each of the eight. */
        expect(site.subs.acl.get(some).size).toBe(16);

        for (const rec of recs) rec.close();
        expect(fx.client.dan.views.size).toBe(0);
        expect(site.subs.acl.get(some)).toBeUndefined();

        /* Nothing is sent to a closed subscription. */
        const counts = recs.map(rec => rec.messages.length);
        site.grant(some, Perm.ReadDataset, built.spare(3));
        site.put(Info, built.kinds.sessions[0], { name: "After" });
        await site.settle();
        expect(recs.map(rec => rec.messages.length)).toEqual(counts);
    });

    test("an invalid dataset is a child of the structure search and of no metadata search", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const broken = built.kinds.sparkplug[1];
        const structure = await settled(fx, ROOT, search("v2/structure/"));
        const metadata = await settled(fx, ROOT, search("v2/metadata/"));

        const seen = metadata.messages.length;
        const sent = await after(fx, structure, () =>
            site.put(App.UnionComponents, broken, []));
        /* A dataset that reads it turns invalid with it. */
        expect(sent).toContainEqual(child(200, broken,
            { structure: Special.InvalidDataset, config: null }));
        for (const m of sent) {
            expect([m.status, m.response.status]).toEqual([200, 200]);
            expect(m.response.body)
                .toEqual({ structure: Special.InvalidDataset, config: null });
        }
        expect(metadata.messages.slice(seen)).toContainEqual(child(404, broken));
        expect(metadata.messages.slice(seen).map(m => m.child).sort())
            .toEqual(sent.map(m => m.child).sort());
    });
});

describe("permissions", () => {
    /* The lists and the views give no right through a device to a
     * default dataset that is invalid. The single check in the HTTP
     * API does; allowed_check.test.js pins that difference. Nothing
     * here changes either side. */
    test("an invalid default dataset is not shown through UseDevice, and is shown as invalid to an editor", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const user = "user@EXAMPLE.ORG";
        const editor = "editor@EXAMPLE.ORG";
        const { device, dataset } = built.defaults[0];
        site.set_acl(user, [{ permission: Perm.UseDevice, target: device }]);
        site.set_acl(editor, [{ permission: Perm.EditDataset, target: dataset }]);

        const open_all = principal => Object.fromEntries(Object.entries(ENDPOINTS)
            .map(([name, make]) => [name, fx.client.open(principal, make(dataset))]));
        const by_user = open_all(user);
        const by_editor = open_all(editor);
        await site.settle();

        const structure = { structure: App.UNSDevice, config: { source: device } };
        const invalid = { structure: Special.InvalidDataset, config: null };
        const shown = recs => ({
            lists: ["metadata_list", "structure_list", "union_sources", "session_sources"]
                .filter(name => recs[name].state().body.includes(dataset)),
            metadata_search: recs.metadata_search.state().children[dataset]?.uuid,
            structure_search: recs.structure_search.state().children[dataset],
            metadata_uuid: recs.metadata_uuid.state().body?.uuid,
        });

        /* Valid: the device gives every right but editing. */
        expect(shown(by_user)).toEqual({
            lists: ["metadata_list", "structure_list", "union_sources", "session_sources"],
            metadata_search: dataset, structure_search: structure,
            metadata_uuid: dataset,
        });
        expect(by_user.structure_uuid.state().body).toEqual(structure);
        expect(shown(by_editor)).toEqual({
            lists: ["structure_list"],
            metadata_search: undefined, structure_search: structure,
            metadata_uuid: undefined,
        });

        /* A second definition makes it invalid. */
        site.put(App.UnionComponents, dataset, []);
        await site.settle();
        expect(shown(by_user)).toEqual({
            lists: [],
            metadata_search: undefined, structure_search: undefined,
            metadata_uuid: undefined,
        });
        expect(by_user.structure_search.messages.at(-1)).toEqual(child(404, dataset));
        expect(shown(by_editor)).toEqual({
            lists: ["structure_list"],
            metadata_search: undefined, structure_search: invalid,
            metadata_uuid: undefined,
        });
        expect(by_editor.structure_search.messages.at(-1))
            .toEqual(child(200, dataset, invalid));

        /* The views agree with the dataset lists of DataFlow. */
        await check_views(fx, "invalid default dataset");

        /* Mended, the device gives its rights again. */
        site.del(App.UnionComponents, dataset);
        await site.settle();
        expect(shown(by_user).lists).toHaveLength(4);
        expect(by_user.structure_search.messages.at(-1))
            .toEqual(child(201, dataset, structure));
        expect(shown(by_editor).structure_search).toEqual(structure);
    });
});

describe("a source that fails", () => {
    /* Each source of a view, and how to make it fail on the site. */
    const FAILURES = {
        data:   fx => fx.site.error("app", App.SessionLimits),
        check:  fx => fx.site.error("acl", PRINCIPALS.some),
        info:   fx => fx.site.error("app", Info),
        meta:   fx => fx.site.error("app", Metadata.Tags),
        ftypes: fx => fx.site.error("member", Group.FunctionalDatasetGroup),
        parts:  fx => fx.site.error("member", Class.Dataset),
    };
    /* The endpoints that read each source. */
    const READERS = {
        data:   Object.keys(ENDPOINTS),
        check:  Object.keys(ENDPOINTS),
        info:   ["metadata_search", "metadata_uuid"],
        meta:   ["metadata_search", "metadata_uuid"],
        ftypes: ["metadata_search", "metadata_uuid"],
        parts:  ["metadata_search", "metadata_uuid"],
    };

    test.each(Object.keys(FAILURES))("an error on the %s source gives each subscription that reads it one 500 and ends it", async tag => {
        const fx = fixture(SMALL);
        const { some } = PRINCIPALS;
        const watched = fx.built.named.part_parent;
        const recs = Object.entries(ENDPOINTS)
            .map(([name, make]) => [name, fx.client.open(some, make(watched))]);
        await fx.site.settle();
        for (const [name, rec] of recs)
            expect([name, rec.messages.length]).toEqual([name, 1]);

        FAILURES[tag](fx);
        await fx.site.settle();

        for (const [name, rec] of recs) {
            const reads = READERS[tag].includes(name);
            expect([name, rec.messages.slice(1)])
                .toEqual([name, reads ? [{ status: 500 }] : []]);
            expect([name, rec.ended]).toEqual([name, reads]);
        }
        expect(fx.client.dan.views.size).toBe(8 - READERS[tag].length);
    });
});

describe("a reconnect", () => {
    test("the same content sent again computes no body and sends no message, on any endpoint", async () => {
        const fx = fixture(SMALL);
        const { site, built } = fx;
        const watched = [built.named.part_parent, built.kinds.sessions[0]];

        const recs = [];
        for (const principal of Object.values(PRINCIPALS)) {
            for (const [name, make] of Object.entries(ENDPOINTS)) {
                const subs = make.length ? watched.map(uuid => make(uuid)) : [make()];
                for (const sub of subs)
                    recs.push([`${principal} ${name}`, fx.client.open(principal, sub)]);
            }
        }
        await site.settle();
        const views = [...fx.client.dan.views];
        expect(views).toHaveLength(recs.length);

        const messages = recs.map(([, rec]) => rec.messages.length);
        const computed = views.map(view => view.stats.computed);
        const resolved = fx.data.index.stats.resolved;

        /* ConfigDB sends every application again, and Auth sends
         * every ACL again. */
        for (const app of [...STRUCTURE_APPS, ...METADATA_APPS, Info])
            site.resync(app);
        for (const principal of Object.values(PRINCIPALS))
            if (site.acl(principal)) site.repush_acl(principal);
        site.resync_relation("member", Class.Dataset);
        for (const parent of built.parents)
            site.resync_relation("subclass", parent);
        await site.settle();

        expect(recs.map(([, rec]) => rec.messages.length)).toEqual(messages);
        expect(views.map(view => view.stats.computed)).toEqual(computed);
        expect(views.map(view => view.stats.sent)).toEqual(views.map(() => 0));
        expect(fx.data.index.stats.resolved).toBe(resolved);
    });
});

describe("single watches cost one dataset", () => {
    test("on a site of 1,000 datasets, a WATCH v2/metadata/:uuid opens one subclass watch and a WATCH v2/structure/:uuid opens none", async () => {
        const fx = fixture({ datasets: 1000, devices: 510, seed: 62 });
        const { site, built } = fx;
        await site.settle();
        const dataset = built.named.part_parent;
        expect(site.counters.watch.subclass.total()).toBe(0);

        const structure = await settled(fx, ROOT, watch(`v2/structure/${dataset}`));
        expect(structure.messages).toHaveLength(1);
        expect(site.counters.watch.subclass.total()).toBe(0);
        expect(site.counters.opened.subclass.total()).toBe(0);

        const metadata = await settled(fx, ROOT, watch(`v2/metadata/${dataset}`));
        expect(metadata.state().body.parts).toEqual([built.kinds.subset[0]]);
        expect([...site.counters.watch.subclass]).toEqual([[dataset, 1]]);
        expect([...site.counters.opened.subclass]).toEqual([[dataset, 1]]);

        /* One body each, whatever the size of the site. */
        expect(view_of(fx, "structure_uuid", ROOT).stats.computed).toBe(1);
        expect(view_of(fx, "metadata_uuid", ROOT).stats.computed).toBe(1);
    });
});

/* ---- The oracle ---- */

/* The permission each handler asks for, and the map its datasets come
 * from. */
const RULES = {
    metadata_list:          [Perm.ReadDataset, "valid"],
    metadata_uuid:          [Perm.ReadDataset, "valid"],
    metadata_search:        [Perm.ReadDataset, "valid"],
    structure_list:         [READ_STRUCTURE, "datasets"],
    structure_uuid:         [READ_STRUCTURE, "valid"],
    structure_search:       [READ_STRUCTURE, "datasets"],
    union_sources_list:     [Perm.IncludeInUnion, "valid"],
    session_sources_list:   [Perm.UseForSession, "valid"],
};

/* The latest value of each source of a view, read from the sources
 * again and not from the view. */
function fresh_state (view) {
    const state = {};
    for (const [tag, source] of Object.entries(view.sources)) {
        let got = false;
        let value;
        source.subscribe(v => { got = true; value = v; }).unsubscribe();
        if (got) state[tag] = value;
    }
    return state;
}

/* A body as the JSON a client gets, with its parts in order. */
function plain (body) {
    const json = JSON.parse(JSON.stringify(body));
    if (Array.isArray(json?.parts)) json.parts.sort();
    return json;
}

const plain_children = map => Object.fromEntries(
    sorted(map.keys()).map(key => [key, plain(map.get(key))]));

/* Compare every open view with a computation from scratch: a body for
 * every candidate, from the sources as they are now. And compare the
 * datasets it shows with the dataset list of DataFlow. */
async function check_views (fx, label) {
    for (const view of fx.client.dan.views) {
        const where = `${label}: ${view.principal} ${view.name}`;
        const state = fresh_state(view);
        const keys = view.fixed ?? view.candidates(state).keys();
        const expected = new Map();
        for (const key of keys) {
            const body = view.body(state, key);
            if (body !== undefined) expected.set(key, body);
        }
        expect([where, plain_children(view.children)])
            .toEqual([where, plain_children(expected)]);

        const [permission, map] = RULES[view.name];
        const listed = await rx.firstValueFrom(rx.of(state.data[map])
            .pipe(fx.data.filter_allowed_datasets(view.principal, permission)));
        const visible = view.fixed
            ? [...view.fixed].filter(key => listed.has(key))
            : [...listed.keys()];
        expect([where, sorted(view.children.keys())]).toEqual([where, sorted(visible)]);
    }
}

describe("every view against a computation from scratch", () => {
    const PERMS = [
        Perm.ReadDataset, Perm.EditDataset, Perm.IncludeInUnion, Perm.UseForSession,
    ];

    test.each([71, 72, 73])("after each step of a random walk, seed %i", async seed => {
        const fx = fixture({ datasets: 40, devices: 24, seed });
        const { site, built } = fx;
        const { some } = PRINCIPALS;
        const walker = "walker@EXAMPLE.ORG";
        site.set_acl(walker, []);

        const rand = prng(seed * 7919);
        const int = n => Math.floor(rand() * n);
        const pick = list => list[int(list.length)];

        /* Datasets that exist or may come to: the built ones, some
         * that have no structure entry yet, and the default datasets
         * of the devices that have none. */
        const extra = [1, 2, 3, 4].map(n => built.spare(n));
        const spare_defaults = built.spare_devices
            .map(device => ({ device, dataset: default_dataset_uuid(device) }));
        const pool = [
            ...built.datasets, ...extra, ...spare_defaults.map(d => d.dataset),
        ];
        const watched = [
            built.named.part_parent, built.kinds.sessions[0],
            built.defaults[0].dataset, spare_defaults[0].dataset, extra[0],
        ];

        const recs = [];
        for (const principal of [ROOT, PRINCIPALS.wild, some, PRINCIPALS.none, walker]) {
            for (const [name, make] of Object.entries(ENDPOINTS)) {
                const subs = make.length ? watched.map(uuid => make(uuid)) : [make()];
                for (const sub of subs)
                    recs.push({ principal, name, sub, rec: fx.client.open(principal, sub) });
            }
        }
        await site.settle();
        await check_views(fx, "start");

        const has_grant = (principal, permission, target) => site.acl(principal)
            .some(e => e.permission == permission && e.target == target);
        const toggle_grant = (principal, permission, target) =>
            has_grant(principal, permission, target)
                ? site.revoke(principal, permission, target)
                : site.grant(principal, permission, target);
        const structure_of = id => STRUCTURE_APPS.filter(app => site.app(app).has(id));
        const iso = day => new Date(Date.UTC(2026, 0, 1 + day)).toISOString();

        const actions = [
            /* Structure: a new or changed session. */
            () => site.put(App.SessionLimits, pick([...built.kinds.sessions, ...extra]),
                { source: pick(pool), from: iso(int(50)), to: iso(60 + int(50)) }),
            /* A union of anything, which can make a cycle. */
            () => site.put(App.UnionComponents, pick([...built.kinds.unions, extra[3]]),
                [pick(pool), pick(pool)]),
            /* A second definition, or the loss of one. */
            () => {
                const id = pick(pool);
                const have = structure_of(id);
                if (have.length > 1) site.del(have[1], id);
                else site.put(have[0] == App.SparkplugSrc
                    ? App.UnionComponents : App.SparkplugSrc, id,
                    have[0] == App.SparkplugSrc ? [] : { source: pick(built.devices) });
            },
            /* A dataset goes. */
            () => {
                const id = pick(pool);
                for (const app of structure_of(id)) site.del(app, id);
            },
            /* A default dataset is made, or goes. */
            () => {
                const { device, dataset } = pick(spare_defaults);
                if (site.app(App.UNSDevice).has(dataset)) site.del(App.UNSDevice, dataset);
                else site.put(App.UNSDevice, dataset, { source: device });
            },
            /* Names. */
            () => site.put(Info, pick([...pool, ...built.devices]), { name: `Name ${int(5)}` }),
            () => site.del(Info, pick(pool)),
            /* Metadata. */
            () => site.put(pick(METADATA_APPS), pick(pool), { note: int(3) }),
            () => site.del(pick(METADATA_APPS), pick(pool)),
            /* Kinds. */
            () => {
                const [kind, id] = [pick([Kind.Run, Kind.Equipment]), pick(pool)];
                if (site.members(kind).has(id)) site.remove_member(kind, id);
                else site.add_member(kind, id);
            },
            /* Parts. */
            () => site.set_subclasses(pick(pool),
                Array.from({ length: int(4) }, () => pick(pool))),
            /* Dataset membership. */
            () => {
                const id = pick(pool);
                if (site.members(Class.Dataset).has(id)) site.remove_member(Class.Dataset, id);
                else site.add_member(Class.Dataset, id);
            },
            /* Grants on one dataset. */
            () => toggle_grant(pick([some, walker]), pick(PERMS), pick(pool)),
            () => toggle_grant(pick([some, walker]), pick(PERMS), pick(pool)),
            /* A grant on every dataset comes or goes. */
            () => toggle_grant(walker, pick(PERMS), UUIDs.Special.Null),
            /* UseDevice on one device, and on every device. */
            () => toggle_grant(pick([some, walker]), Perm.UseDevice,
                pick([...built.spare_devices, ...built.devices])),
            () => toggle_grant(walker, Perm.UseDevice, UUIDs.Special.Null),
            /* Auth sends an ACL again, unchanged. */
            () => site.repush_acl(pick([some, walker])),
        ];

        for (let step = 0; step < 240; step++) {
            const n = int(actions.length);
            actions[n]();
            await check_views(fx, `seed ${seed} step ${step} action ${n}`);
        }

        /* What each client holds from its messages is what the view
         * holds, and what a client that subscribes now gets. A WATCH
         * v2/structure/:uuid is left out: it sends nothing when its
         * dataset goes away, so it rightly keeps an old body. */
        await site.settle();
        for (const { principal, name, sub, rec } of recs) {
            if (name == "structure_uuid") continue;
            const fresh = fx.client.open(principal, sub);
            await site.settle();
            const where = `seed ${seed}: ${principal} ${name}`;
            expect([where, rec.state()]).toEqual([where, fresh.state()]);
            expect([where, rec.error]).toEqual([where, null]);
            fresh.close();
        }
    }, 120000);
});
