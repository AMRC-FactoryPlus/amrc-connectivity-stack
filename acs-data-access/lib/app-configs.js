/*
 * ACS Data Access Service
 * ConfigDB application entries, kept up to date one change at a time
 * Copyright 2026 University of Sheffield
 */

/* Nothing here uses rxjs. Each class takes one change at a time through
 * `apply` and says which keys that change touched, so the caller can
 * update what it derives from the map without reading the whole map
 * again. `apply` returns null when the change made no difference. */

import { Map as IMap } from "immutable";

import { json_equal } from "@amrc-factoryplus/service-api";

/* Marks "every object" in AppConfigs#pending. */
const ALL = Symbol("all");

/* json_equal does not look at the order of an object's keys. A write
 * that only reorders the keys of a config would be dropped here, and
 * the config held would keep its old key order. That cannot happen:
 * ConfigDB stores a config as jsonb, which keeps keys in one fixed
 * order whatever order they were written in, so the same content
 * always arrives in the same order. */
function same_value (a, b) {
    return a === b || json_equal(a, b);
}

/* True when two inner maps have the same applications in the same
 * order, each with the same body object. */
function same_inner (a, b) {
    if (a === b) return true;
    if (a == null || b == null || a.size !== b.size) return false;
    const theirs = b.entries();
    for (const [app, value] of a) {
        const [other_app, other_value] = theirs.next().value;
        if (app !== other_app || value !== other_value) return false;
    }
    return true;
}

/** The entries of one ConfigDB application.
 *
 * Feed it the values of `ConfigDB#search_app_changes` for one
 * application. It holds its own Map from object UUID to config, and
 * changes that Map only where a config differs, so a config that did
 * not change keeps its object identity across a resync.
 */
export class AppMap {
    constructor () {
        /** The Map held, or null before the first value. */
        this.map = null;
    }

    /** Apply one value of the change sequence.
     *
     * @arg change `{ map, child, previous }`. `child` is the object
     * that changed, or null when `map` is a full snapshot.
     * @returns `{ map, changed }`, or null if nothing differs. `changed`
     * is a native Set of object UUIDs, or null on the first value,
     * where every key counts as changed.
     */
    apply ({ map, child, previous }) {
        /* The first value can be a child update, when this reads a
         * shared sequence that replays its latest value. Its map is
         * complete either way. */
        if (this.map == null) {
            this.map = map;
            return { map, changed: null };
        }
        if (child == null)
            return this._apply_snapshot(map);
        /* A delete of an entry that was not there. */
        if (previous != null && map === previous)
            return null;
        return this._apply_child(map, child);
    }

    _apply_child (map, child) {
        const held = this.map;
        if (map.has(child)) {
            const value = map.get(child);
            if (held.has(child) && same_value(held.get(child), value))
                return null;
            this.map = held.set(child, value);
        }
        else {
            if (!held.has(child)) return null;
            this.map = held.delete(child);
        }
        return { map: this.map, changed: new Set([child]) };
    }

    /* A snapshot after the first one: a reconnect, or a parent error
     * that has cleared. Most of it repeats what is held. */
    _apply_snapshot (map) {
        const held = this.map;
        const changed = new Set();
        const next = held.withMutations(mut => {
            for (const [key, value] of map) {
                if (held.has(key) && same_value(held.get(key), value))
                    continue;
                mut.set(key, value);
                changed.add(key);
            }
            for (const key of held.keys()) {
                if (map.has(key)) continue;
                mut.delete(key);
                changed.add(key);
            }
        });
        if (changed.size == 0) return null;
        this.map = next;
        return { map: next, changed };
    }
}

/** The entries of every application in a class, grouped by object.
 *
 * Feed it the values of `watch_each` over the class's member Set, with
 * `ConfigDB#search_app_changes` as the inner sequence. The result is a
 * Map from object UUID to a Map from application UUID to config: every
 * object that has an entry in at least one application.
 *
 * The applications of an inner map are in the order the member Set
 * lists them. That order is the key order of the JSON a client reads,
 * so an inner map is always built again from the applications in that
 * order, never updated in place.
 */
export class AppConfigs {
    constructor () {
        /* The application UUIDs in member Set order, or null before
         * the first Set. */
        this.wanted = null;
        /* Application UUID -> AppMap. */
        this.apps = new Map();
        /** Object UUID -> Map application UUID -> config. */
        this.grouped = IMap();
        /* The objects whose inner map may be out of date: a native
         * Set, or ALL. */
        this.pending = ALL;
        this.started = false;
    }

    /** Apply one value of the `watch_each` sequence.
     *
     * @arg event `{ set, added, removed }` when the set of applications
     * is given, or `{ key, value }` with an application UUID and one
     * value of its change sequence.
     * @returns `{ map, changed }`, or null if nothing differs or not
     * every application has answered yet. `changed` is a native Set of
     * object UUIDs. It is null on the first result and after a change
     * to the set of applications, where every key counts as changed.
     */
    apply (event) {
        if (event.set !== undefined)
            this._apply_set(event);
        else
            this._apply_app(event.key, event.value);
        return this._flush();
    }

    _apply_set ({ set, added, removed }) {
        const wanted = [...set];
        const before = this.wanted;
        const same_order = before != null
            && before.length == wanted.length
            && before.every((app, i) => app === wanted[i]);
        this.wanted = wanted;

        for (const app of removed ?? [])
            this.apps.delete(app);
        for (const app of added ?? [])
            if (!this.apps.has(app)) this.apps.set(app, new AppMap());
        /* Do not rely on the caller's difference alone. */
        for (const app of wanted)
            if (!this.apps.has(app)) this.apps.set(app, new AppMap());
        for (const app of [...this.apps.keys()])
            if (!set.has(app)) this.apps.delete(app);

        /* The order of the applications decides the key order of every
         * inner map, so all of them are built again. The set of
         * applications changes rarely. */
        if (!same_order) this.pending = ALL;
    }

    _apply_app (app, change) {
        const held = this.apps.get(app);
        if (!held) return;
        const result = held.apply(change);
        if (!result) return;
        if (result.changed == null)
            this.pending = ALL;
        else if (this.pending !== ALL)
            for (const id of result.changed) this.pending.add(id);
    }

    _ready () {
        if (this.wanted == null) return false;
        for (const app of this.wanted)
            if (this.apps.get(app).map == null) return false;
        return true;
    }

    /* Every object the result holds or should hold. */
    _all_objects () {
        const ids = new Set(this.grouped.keys());
        for (const app of this.wanted)
            for (const id of this.apps.get(app).map.keys())
                ids.add(id);
        return ids;
    }

    _build_inner (id) {
        let inner = null;
        for (const app of this.wanted) {
            const map = this.apps.get(app).map;
            if (!map.has(id)) continue;
            inner = (inner ?? IMap()).set(app, map.get(id));
        }
        return inner;
    }

    _flush () {
        if (!this._ready()) return null;

        const all = this.pending === ALL;
        const ids = all ? this._all_objects() : this.pending;
        const changed = new Set();
        const before = this.grouped;
        this.grouped = before.withMutations(mut => {
            for (const id of ids) {
                const old = before.get(id);
                const inner = this._build_inner(id);
                if (inner == null) {
                    if (old === undefined) continue;
                    mut.delete(id);
                }
                else {
                    if (same_inner(old, inner)) continue;
                    mut.set(id, inner);
                }
                changed.add(id);
            }
        });
        this.pending = new Set();

        const first = !this.started;
        this.started = true;
        if (first)
            return { map: this.grouped, changed: null };
        if (changed.size == 0)
            return null;
        return { map: this.grouped, changed: all ? null : changed };
    }
}
