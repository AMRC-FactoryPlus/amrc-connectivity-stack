/*
 * ACS Data Access Service
 * DatasetView: what one notify subscription shows, one dataset at a time
 * Copyright 2026 University of Sheffield
 */

/* These drive a view from scripted sources, so each test says exactly
 * which value arrives when.
 *
 * They run against fakes, so they need no cluster. */

import * as imm from "immutable";
import * as rx from "rxjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SearchFilter, json_equal } from "@amrc-factoryplus/service-api";

import { DataAccess as Constants } from "../../lib/constants.js";
import {
    DatasetView, member_body, metadata_body, search_source, structure_body,
    watch_key, watch_list,
} from "../../lib/dataset-view.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";

const { App, Kind, Special } = Constants;

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
