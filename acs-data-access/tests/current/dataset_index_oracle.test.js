/*
 * ACS Data Access Service
 * The per-change dataset map against the whole-map algorithm
 * Copyright 2026 University of Sheffield
 */

/* A random walk over a small site, 20 times from 20 seeds. After every
 * change the per-change reducers (AppConfigs, then DatasetIndex) must
 * hold exactly what the old whole-map code builds from the same state.
 * The old code is the verbatim copy in support/reference-datasets.js.
 *
 * The site is small on purpose: 80 UUIDs over 6 structure apps, so the
 * walk keeps running into duplicate definitions, references to missing
 * datasets, and cycles that form and break.
 *
 * Pure: no cluster, no rxjs, no timer. A failure names the seed and the
 * step, and the same seed always takes the same walk. */

import * as imm from "immutable";
import { describe, expect, test } from "vitest";

import { json_equal } from "@amrc-factoryplus/service-api";

import { AppConfigs } from "../../lib/app-configs.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DatasetIndex } from "../../lib/dataset-index.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";

import {
    reference_datasets, reference_default_devices, reference_group,
    reference_invalid, reference_valid,
} from "../support/reference-datasets.js";
import { prng } from "../support/site-builder.js";

const { App, Special } = Constants;

const SEEDS = Array.from({ length: 20 }, (_, i) => 7001 + i);
const STEPS = 2000;
const UUIDS = 80;
const DEFAULTS = 20;

const UNKNOWN_APP = "f0000000-0000-4000-8000-00000000000f";

const hex = n => n.toString(16).padStart(12, "0");
const DAY = 24 * 60 * 60 * 1000;
const EPOCH = Date.UTC(2026, 0, 1);

const clone = value => JSON.parse(JSON.stringify(value));

function same_time (a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    const at = a.getTime();
    const bt = b.getTime();
    return at === bt || (Number.isNaN(at) && Number.isNaN(bt));
}

/* Deep equality of two dataset map entries. */
function same_entry (a, b) {
    return a.structure === b.structure
        && json_equal(a.config, b.config)
        && same_time(a.from, b.from)
        && same_time(a.to, b.to);
}

const ENTRY_KEYS = "structure,config,from,to";

/** A site, the reducers that follow it, and the walk over it. */
class Walk {
    constructor (seed) {
        this.seed = seed;
        this.rand = prng(seed);

        /* Odd seeds have an app Data Access does not know in place of
         * one of the device kinds, so some datasets have an unknown
         * structure. */
        this.all_apps = [
            App.SparkplugSrc, App.SparkplugSubset, App.UNSDevice,
            seed % 2 ? UNKNOWN_APP : App.UNSDeviceMetrics,
            App.UnionComponents, App.SessionLimits,
        ];

        const block = hex(seed).slice(-8);
        this.devices = Array.from({ length: DEFAULTS },
            (_, i) => `${block}-0de0-4000-8000-${hex(i)}`);
        /* The first UUIDs are the default dataset UUIDs of the
         * devices, so a UNS device entry can be a default dataset. */
        this.uuids = Array.from({ length: UUIDS }, (_, i) =>
            i < DEFAULTS
                ? default_dataset_uuid(this.devices[i])
                : `${block}-0d50-4000-8000-${hex(i)}`);
        this.device_of = new Map(
            this.devices.map((dev, i) => [this.uuids[i], dev]));
        this.outside = `${block}-0bad-4000-8000-${hex(0)}`;

        /* What ConfigDB holds: app -> Map uuid -> config. An app that
         * is out of the class keeps its entries. */
        this.truth = new Map(this.all_apps.map(app => [app, imm.Map()]));
        /* The apps in the class, in member Set order. */
        this.wanted = [...this.all_apps];

        this.configs = new AppConfigs();
        this.index = new DatasetIndex();
        /* The last result of each reducer. */
        this.grouped = null;

        this.seen = {
            checks: 0, results: 0, quiet: 0, wide: 0,
            to_invalid: 0, to_valid: 0, removed: 0,
            duplicates: 0, dangling: 0, cycle_made: 0, cycle_broken: 0,
            defaults: 0, windows: 0, max_valid: 0, max_invalid: 0,
            set_changes: 0,
        };
        this.had_cycle = false;
        this.kind = "start";
        this.step = -1;
    }

    /* Random choices. */
    int (n) { return Math.floor(this.rand() * n); }
    chance (p) { return this.rand() < p; }
    pick (list) { return list[this.int(list.length)]; }

    /* The UUIDs that have a structure entry in a wanted app. */
    present () {
        const ids = new Set();
        for (const app of this.wanted)
            for (const id of this.truth.get(app).keys()) ids.add(id);
        return [...ids];
    }

    /* A UUID for a session or union to refer to: usually a valid
     * dataset, sometimes one that is invalid or may not exist, now and
     * then one that never will. The index is safe to ask: every step
     * before this one checked it against the whole-map algorithm. */
    pick_ref () {
        const roll = this.rand();
        if (roll < 0.02) return this.outside;
        if (roll < 0.06) return this.pick(this.uuids);
        if (roll < 0.14) {
            const present = this.present();
            if (present.length) return this.pick(present);
        }
        const valid = [...this.index.valid.keys()];
        return valid.length ? this.pick(valid) : this.pick(this.uuids);
    }

    make_config (app, id) {
        if (app == App.SessionLimits) {
            const config = { source: this.pick_ref() };
            const start = EPOCH + this.int(60) * DAY + this.int(1000);
            if (this.chance(0.6))
                config.from = new Date(start).toISOString();
            if (this.chance(0.6))
                config.to = new Date(start + this.int(30) * DAY).toISOString();
            else if (this.chance(0.2))
                config.to = null;
            return config;
        }
        if (app == App.UnionComponents)
            return Array.from({ length: this.int(5) }, () => this.pick_ref());
        if (app == App.UNSDevice) {
            const own = this.device_of.get(id);
            return { source: own && this.chance(0.8)
                ? own : this.pick(this.devices) };
        }
        return { n: this.int(1000) };
    }

    /* Each of these changes the truth and passes on the value
     * search_app_changes would emit, if the app is in the class. */

    put (app, id, config) {
        const previous = this.truth.get(app);
        const map = previous.set(id, config);
        this.truth.set(app, map);
        if (this.wanted.includes(app))
            this.feed({ key: app, value: { map, child: id, previous } });
        else
            this.quiet();
    }

    del (app, id) {
        const previous = this.truth.get(app);
        const map = previous.delete(id);
        this.truth.set(app, map);
        if (this.wanted.includes(app))
            this.feed({ key: app, value: { map, child: id, previous } });
        else
            this.quiet();
    }

    /* A full snapshot with new body objects, as after a reconnect. */
    snapshot (app) {
        const map = this.truth.get(app).map(clone);
        this.truth.set(app, map);
        return { key: app, value: { map, child: null, previous: null } };
    }

    set_event (before) {
        return {
            set:        imm.OrderedSet(this.wanted),
            added:      this.wanted.filter(a => !before.includes(a)),
            removed:    before.filter(a => !this.wanted.includes(a)),
        };
    }

    /* Change an app's entries with no notification, as changes made
     * while the connection was down. */
    lose (app) {
        let map = this.truth.get(app);
        const count = 1 + this.int(4);
        for (let i = 0; i < count; i++) {
            /* Mostly an entry the app has; sometimes any UUID, which
             * can make a duplicate. */
            const own = [...map.keys()];
            const id = own.length && this.chance(0.7)
                ? this.pick(own) : this.pick(this.uuids);
            map = this.chance(0.4) && map.has(id)
                ? map.delete(id)
                : map.set(id, this.make_config(app, id));
        }
        this.truth.set(app, map);
    }

    fail (problem) {
        throw new Error(`Seed ${this.seed}, step ${this.step} `
            + `(${this.kind}): ${problem}`);
    }

    /* Pass one event through both reducers, then compare with the
     * whole-map algorithm. */
    feed (event) {
        const before = new Map(this.index.entries);
        const applies = this.index.stats.applies;

        const grouped = this.configs.apply(event);
        let result = null;
        if (grouped) {
            this.grouped = grouped.map;
            result = this.index.apply(grouped.map, grouped.changed);
        }
        else if (this.index.stats.applies != applies)
            this.fail("the index ran without a grouped result");

        this.check(before, result);
        return result;
    }

    /* Nothing reaches the reducers: a change to an app that is out of
     * the class, or a step with nothing to do. Nothing may have moved,
     * and the whole-map algorithm must still agree. */
    quiet () {
        this.check(new Map(this.index.entries), null);
    }

    /* Pass on an event that must give no result: the set of apps has
     * grown and the new app has not answered. */
    feed_held (event) {
        const before = this.index.entries;
        if (this.configs.apply(event) != null)
            this.fail("a result before the new app answered");
        if (this.index.entries !== before)
            this.fail("the dataset map moved while an app was awaited");
    }

    check (before, result) {
        const { index, seen } = this;
        seen.checks++;

        /* The grouped map against the old grouping loop. */
        const ref_grouped = reference_group(
            this.wanted.map(app => [app, this.truth.get(app)]));
        if (this.grouped.size != ref_grouped.size)
            this.fail(`grouped has ${this.grouped.size} objects, `
                + `reference ${ref_grouped.size}`);
        for (const [id, ref_inner] of ref_grouped) {
            const inner = this.grouped.get(id);
            if (!inner) this.fail(`grouped lacks ${id}`);
            if ([...inner.keys()].join() != [...ref_inner.keys()].join())
                this.fail(`app order differs for ${id}`);
            for (const [app, config] of ref_inner)
                if (!json_equal(inner.get(app), config))
                    this.fail(`config differs for ${id} in ${app}`);
        }

        /* The dataset map against the old resolver. */
        const ref = reference_datasets(ref_grouped);
        const ours = index.entries;
        if (ours.size != ref.size)
            this.fail(`${ours.size} datasets, reference ${ref.size}`);
        for (const [id, ref_entry] of ref) {
            const entry = ours.get(id);
            if (!entry) this.fail(`the map lacks ${id}`);
            if (Object.keys(entry).join() != ENTRY_KEYS)
                this.fail(`entry keys of ${id}: ${Object.keys(entry)}`);
            if (!same_entry(entry, ref_entry))
                this.fail(`entry of ${id} is ${JSON.stringify(entry)}, `
                    + `reference ${JSON.stringify(ref_entry)}`);
        }

        /* valid, invalid and defaults against the old filters. */
        const ref_valid = reference_valid(ref);
        const ref_invalid = reference_invalid(ref);
        for (const [name, map, ref_map] of [
            ["valid", index.valid, ref_valid],
            ["invalid", index.invalid, ref_invalid],
        ]) {
            if (map.size != ref_map.size)
                this.fail(`${name} has ${map.size}, reference ${ref_map.size}`);
            for (const id of ref_map.keys()) {
                if (!map.has(id)) this.fail(`${name} lacks ${id}`);
                if (map.get(id) !== ours.get(id))
                    this.fail(`${name} holds another object for ${id}`);
            }
        }
        const ref_defaults = reference_default_devices(ref);
        if (index.defaults.size != ref_defaults.size)
            this.fail(`${index.defaults.size} defaults, `
                + `reference ${ref_defaults.size}`);
        for (const [id, dev] of ref_defaults)
            if (index.defaults.get(id) !== dev)
                this.fail(`default device of ${id}`);

        /* The changed Set is exactly the datasets whose entry
         * differs, and every other entry is the same object. */
        const differs = new Set();
        for (const [id, entry] of ours)
            if (!before.has(id) || !same_entry(before.get(id), entry))
                differs.add(id);
        for (const id of before.keys())
            if (!ours.has(id)) differs.add(id);

        const changed = result ? result.changed : new Set();
        if (result == null && differs.size > 0)
            this.fail(`no result, but ${[...differs]} differ`);
        if (result != null && differs.size == 0)
            this.fail("a result with nothing different");
        if (changed.size != differs.size
            || [...differs].some(id => !changed.has(id))
        )
            this.fail(`changed is ${[...changed].sort()}, `
                + `the entries that differ are ${[...differs].sort()}`);
        for (const [id, entry] of ours)
            if (!changed.has(id) && before.get(id) !== entry)
                this.fail(`${id} was replaced but did not change`);
        if (result) {
            if (result.datasets !== index.entries
                || result.valid !== index.valid
                || result.invalid !== index.invalid
                || result.defaults !== index.defaults
            )
                this.fail("the result does not hold the index's maps");
        }

        /* What this walk has been through. */
        if (result) seen.results++; else seen.quiet++;
        if (changed.size > 1) seen.wide++;
        for (const id of changed) {
            const was = before.get(id);
            const now = ours.get(id);
            if (!now) { seen.removed++; continue; }
            if (!was) continue;
            const was_valid = was.structure != Special.InvalidDataset;
            const now_valid = now.structure != Special.InvalidDataset;
            if (was_valid && !now_valid) seen.to_invalid++;
            if (!was_valid && now_valid) seen.to_valid++;
        }
        for (const entry of ref_valid.values())
            if (entry.from instanceof Date || entry.to instanceof Date)
                seen.windows++;
        seen.max_valid = Math.max(seen.max_valid, ref_valid.size);
        seen.max_invalid = Math.max(seen.max_invalid, ref_invalid.size);
        if (ref_defaults.size) seen.defaults++;
        this.look_at_graph(ref_grouped);
    }

    /* Count the shapes the walk is meant to reach. */
    look_at_graph (grouped) {
        const { seen } = this;
        const refs = new Map();
        let duplicates = false;
        let dangling = false;
        for (const [id, defs] of grouped) {
            if (defs.size != 1) { duplicates = true; continue; }
            const [app, config] = defs.entries().next().value;
            const targets = app == App.SessionLimits ? [config.source]
                : app == App.UnionComponents ? config
                : [];
            refs.set(id, targets);
            if (targets.some(t => !grouped.has(t))) dangling = true;
        }
        if (duplicates) seen.duplicates++;
        if (dangling) seen.dangling++;

        /* Is any dataset its own ancestor? */
        const state = new Map();
        const on_cycle = id => {
            if (state.get(id) == "done") return false;
            if (state.get(id) == "open") return true;
            state.set(id, "open");
            for (const target of refs.get(id) ?? [])
                if (on_cycle(target)) return true;
            state.set(id, "done");
            return false;
        };
        const cycle = [...refs.keys()].some(on_cycle);
        if (cycle && !this.had_cycle) seen.cycle_made++;
        if (!cycle && this.had_cycle) seen.cycle_broken++;
        this.had_cycle = cycle;
    }

    start () {
        /* Some datasets before the reducers see anything. */
        for (let i = 0; i < 40; i++) {
            const app = this.pick(this.all_apps);
            const id = this.pick(this.uuids);
            this.truth.set(app,
                this.truth.get(app).set(id, this.make_config(app, id)));
        }
        this.feed_held(this.set_event([]));
        this.wanted.forEach((app, i) => {
            if (i < this.wanted.length - 1)
                this.feed_held(this.snapshot(app));
            else
                this.feed(this.snapshot(app));
        });
    }

    one_step (step) {
        this.step = step;
        const roll = this.rand();

        if (roll < 0.14) {
            this.kind = "repair";
            this.repair();
        }
        else if (roll < 0.46) {
            this.kind = "put";
            const id = this.pick(this.uuids);
            const holders = this.all_apps.filter(
                app => this.truth.get(app).has(id));
            /* Mostly edit the entry a dataset has. Sometimes write
             * under another app, which makes a duplicate. */
            const app = holders.length && this.chance(0.94)
                ? this.pick(holders) : this.pick(this.all_apps);
            this.put(app, id, this.make_config(app, id));
        }
        else if (roll < 0.51) {
            this.kind = "identical put";
            const app = this.pick(this.all_apps);
            const ids = [...this.truth.get(app).keys()];
            if (ids.length) {
                const id = this.pick(ids);
                this.put(app, id, clone(this.truth.get(app).get(id)));
            }
            else
                this.quiet();
        }
        else if (roll < 0.71) {
            this.kind = "delete";
            const entries = [];
            for (const app of this.all_apps)
                for (const id of this.truth.get(app).keys())
                    entries.push([app, id]);
            if (entries.length) this.del(...this.pick(entries));
            else this.quiet();
        }
        else if (roll < 0.75) {
            this.kind = "delete of an absent entry";
            this.del(this.pick(this.all_apps), this.pick(this.uuids));
        }
        else if (roll < 0.78) {
            this.kind = "cycle";
            /* A union and a session that refer to each other. */
            const a = this.pick(this.uuids);
            const b = this.pick(this.uuids);
            for (const app of this.all_apps) {
                if (this.truth.get(app).has(a)) this.del(app, a);
                if (this.truth.get(app).has(b)) this.del(app, b);
            }
            this.put(App.UnionComponents, a, [b]);
            if (a != b)
                this.put(App.SessionLimits, b, { source: a });
        }
        else if (roll < 0.84) {
            this.kind = "identical resync";
            this.feed(this.snapshot(this.pick(this.wanted)));
        }
        else if (roll < 0.93) {
            this.kind = "resync with changes";
            const app = this.pick(this.wanted);
            this.lose(app);
            this.feed(this.snapshot(app));
        }
        else if (roll < 0.95 && this.wanted.length > 3) {
            this.kind = "app leaves the class";
            const before = this.wanted;
            const gone = this.pick(before);
            this.wanted = before.filter(app => app != gone);
            this.seen.set_changes++;
            this.feed(this.set_event(before));
        }
        else if (this.wanted.length < this.all_apps.length) {
            this.kind = "app joins the class";
            const before = this.wanted;
            const back = this.pick(
                this.all_apps.filter(app => !before.includes(app)));
            /* It joins at the end, so the app order changes too. */
            this.wanted = [...before, back];
            this.seen.set_changes++;
            this.feed_held(this.set_event(before));
            this.feed(this.snapshot(back));
        }
        else {
            this.kind = "resync of every app";
            for (const app of this.wanted)
                this.feed(this.snapshot(app));
        }
    }

    /* Make one invalid dataset valid again, if there is one: drop the
     * extra entries of a duplicate, or write a config that refers only
     * to valid datasets. */
    repair () {
        const invalid = [...this.index.invalid.keys()].sort();
        if (!invalid.length) return this.quiet();
        const id = this.pick(invalid);
        const holders = this.wanted.filter(
            app => this.truth.get(app).has(id));
        if (holders.length > 1) {
            const keep = this.pick(holders);
            for (const app of holders)
                if (app != keep) this.del(app, id);
            return;
        }
        const valid = [...this.index.valid.keys()].sort();
        const app = this.pick(
            [App.SparkplugSrc, App.UnionComponents, App.SessionLimits]);
        for (const other of holders)
            if (other != app) this.del(other, id);
        const config = app == App.SparkplugSrc || !valid.length ? { n: 0 }
            : app == App.UnionComponents ? [this.pick(valid), this.pick(valid)]
            : { source: this.pick(valid) };
        this.put(valid.length ? app : App.SparkplugSrc, id, config);
    }

    run () {
        this.start();
        for (let step = 0; step < STEPS; step++)
            this.one_step(step);
        return this.seen;
    }
}

describe("the per-change dataset map equals the whole-map algorithm", () => {
    test("there are 20 seeds of 2,000 changes", () => {
        expect(new Set(SEEDS).size).toBe(20);
        expect(STEPS).toBe(2000);
    });

    test.each(SEEDS)("seed %i: 2,000 random changes", seed => {
        const walk = new Walk(seed);
        const seen = walk.run();

        /* Every step is checked at least once, so the 20 walks make
         * 40,000 checks or more between them. */
        expect(seen.checks).toBeGreaterThanOrEqual(STEPS);

        /* Every walk reaches each shape it is meant to test. */
        /* Changes that moved an entry, and changes that did not. */
        expect(seen.results).toBeGreaterThan(1000);
        expect(seen.quiet).toBeGreaterThan(400);
        /* Changes that reached more than one dataset. */
        expect(seen.wide).toBeGreaterThan(150);
        expect(seen.to_invalid).toBeGreaterThan(100);
        expect(seen.to_valid).toBeGreaterThan(100);
        expect(seen.removed).toBeGreaterThan(400);
        /* Checks made with a duplicate definition or a reference to a
         * missing dataset on the site. */
        expect(seen.duplicates).toBeGreaterThan(300);
        expect(seen.dangling).toBeGreaterThan(800);
        expect(seen.cycle_made).toBeGreaterThan(10);
        expect(seen.cycle_broken).toBeGreaterThan(10);
        /* Checks made with a default dataset on the site, and valid
         * datasets with a time window, summed over the checks. */
        expect(seen.defaults).toBeGreaterThan(300);
        expect(seen.windows).toBeGreaterThan(2000);
        expect(seen.max_valid).toBeGreaterThan(25);
        expect(seen.max_invalid).toBeGreaterThan(5);
        expect(seen.set_changes).toBeGreaterThan(20);
    });

    test("the same seed takes the same walk", () => {
        const a = new Walk(SEEDS[0]);
        const b = new Walk(SEEDS[0]);
        expect(a.run()).toEqual(b.run());
        expect(JSON.stringify([...a.index.entries].sort()))
            .toBe(JSON.stringify([...b.index.entries].sort()));
    });

    /* The harness must be able to fail. Each case breaks one thing the
     * walk checks and expects the walk to stop with the seed named. */
    test("a wrong changed Set stops the walk and names the seed", () => {
        const walk = new Walk(SEEDS[0]);
        const apply = walk.index.apply.bind(walk.index);
        let calls = 0;
        walk.index.apply = (grouped, changed) => {
            const result = apply(grouped, changed);
            if (result && ++calls == 50)
                result.changed = new Set([...result.changed, "extra"]);
            return result;
        };
        expect(() => walk.run())
            .toThrow(new RegExp(`^Seed ${SEEDS[0]}, step \\d+ \\(.+\\): changed is`));
    });

    test("a stale window stops the walk and names the seed", () => {
        const walk = new Walk(SEEDS[1]);
        /* An index that forgets to look at referrers. */
        walk.index._closure = ids => new Set(ids);
        expect(() => walk.run())
            .toThrow(new RegExp(`^Seed ${SEEDS[1]}, step \\d+ `));
    });

    test("an entry replaced without a change stops the walk", () => {
        const walk = new Walk(SEEDS[2]);
        const apply = walk.index.apply.bind(walk.index);
        let calls = 0;
        walk.index.apply = (grouped, changed) => {
            const result = apply(grouped, changed);
            if (++calls == 60) {
                const [id, entry] = walk.index.entries.entries().next().value;
                walk.index.entries = walk.index.entries.set(id, { ...entry });
            }
            return result;
        };
        expect(() => walk.run()).toThrow(
            /was replaced but did not change|does not hold the index's maps|holds another object/);
    });
});
