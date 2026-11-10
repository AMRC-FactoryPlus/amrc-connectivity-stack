/*
 * ACS Data Access Service
 * The dataset map, kept up to date one change at a time
 * Copyright 2026 University of Sheffield
 */

/* Nothing here uses rxjs. DatasetIndex takes the structure entries of
 * every dataset, grouped by dataset, and the datasets whose entries
 * changed. It works out again only those datasets and the datasets
 * that refer to them, directly or through other datasets. Every other
 * entry of the dataset map stays the same object. */

import { Map as IMap } from "immutable";

import { json_equal } from "@amrc-factoryplus/service-api";

import { DataAccess as Constants } from "./constants.js";
import { default_dataset_device } from "./default-datasets.js";
import { minDate, maxDate } from "./utils.js";

/** The time window of one dataset, from its structure entry.
 *
 * These are the rules the dataset map has always used. A session takes
 * the later `from` and the earlier `to` of its own limits and its
 * source. A union takes the earliest `from` and the latest `to` of its
 * components and ignores a component with no window. A device dataset
 * has no window.
 *
 * This throws on a config it cannot read, such as a null session
 * config. DatasetIndex treats that as an invalid dataset.
 *
 * @arg structure The structure application UUID.
 * @arg config The config stored under that application.
 * @arg lookup A function from a dataset UUID to that dataset's window,
 * `{ from, to }`, or null if that dataset is missing or invalid.
 * @returns `{ from, to }`, each a Date or null, or null if the dataset
 * is invalid.
 */
export function resolve_window (structure, config, lookup) {
    if (structure === Constants.App.SessionLimits) {
        const child = lookup(config.source);
        if (!child) return null;

        const from = config.from ? new Date(config.from) : null;
        const to = config.to ? new Date(config.to) : null;

        return {
            from:   maxDate(from, child.from),
            to:     minDate(to, child.to),
        };
    }

    if (structure === Constants.App.SparkplugSrc
        || structure === Constants.App.SparkplugSubset
        || structure === Constants.App.UNSDevice
        || structure === Constants.App.UNSDeviceMetrics
    )
        return { from: null, to: null };

    if (structure === Constants.App.UnionComponents) {
        const children = config.map(id => lookup(id));
        if (children.some(c => !c)) return null;

        const from_times = children
            .map(v => v.from?.getTime())
            .filter(t => !isNaN(t));
        const to_times = children
            .map(v => v.to?.getTime())
            .filter(t => !isNaN(t));

        return {
            from:   from_times.length
                ? new Date(Math.min(...from_times)) : null,
            to:     to_times.length
                ? new Date(Math.max(...to_times)) : null,
        };
    }

    /* Unknown structure. */
    return null;
}

/** The datasets a structure entry refers to.
 *
 * @arg structure The structure application UUID.
 * @arg config The config stored under that application.
 * @returns An array of dataset UUIDs: the source of a session, the
 * components of a union, and nothing for any other kind. A reference
 * that is not a string is left out; it can never name a dataset.
 */
export function dataset_refs (structure, config) {
    if (structure === Constants.App.SessionLimits) {
        const source = config?.source;
        return typeof source == "string" ? [source] : [];
    }
    if (structure === Constants.App.UnionComponents) {
        if (!Array.isArray(config)) return [];
        return config.filter(id => typeof id == "string");
    }
    return [];
}

function invalid_entry () {
    return {
        structure:  Constants.Special.InvalidDataset,
        config:     null,
        from:       null,
        to:         null,
    };
}

/* Two window ends are the same when both are null, or both are Dates
 * for the same moment. Two invalid Dates count as the same. */
function same_time (a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    const at = a.getTime();
    const bt = b.getTime();
    return at === bt || (isNaN(at) && isNaN(bt));
}

function same_entry (a, b) {
    return a.structure === b.structure
        && (a.config === b.config || json_equal(a.config, b.config))
        && same_time(a.from, b.from)
        && same_time(a.to, b.to);
}

/** The dataset map and the maps derived from it.
 *
 * Call `apply` with the grouped structure entries each time they
 * change. The public maps are Immutable Maps that are replaced, never
 * changed in place, so a caller can keep an old one and compare.
 */
export class DatasetIndex {
    constructor () {
        /** Dataset UUID -> `{ structure, config, from, to }`. */
        this.entries = IMap();
        /** The entries that are valid datasets. */
        this.valid = IMap();
        /** The entries that are invalid datasets. */
        this.invalid = IMap();
        /** Default dataset UUID -> the device it reads. */
        this.defaults = IMap();
        /** Counts of the work done: calls to `apply`, and datasets
         * whose window was worked out. */
        this.stats = { applies: 0, resolved: 0 };

        /* Dataset UUID -> `{ from, to }`, or null for an invalid
         * dataset. Kept across calls: a dataset that no change reaches
         * is never worked out again. */
        this.windows = new Map();
        /* Dataset UUID -> Set of the datasets it refers to. */
        this.refs = new Map();
        /* Dataset UUID -> Set of the datasets that refer to it. The
         * key is there even when no such dataset exists, so a dataset
         * that refers to a missing one is found when it appears. */
        this.referrers = new Map();
        this.started = false;
    }

    /** The datasets that refer directly to a dataset.
     * @returns A new native Set of dataset UUIDs.
     */
    referrers_of (uuid) {
        return new Set(this.referrers.get(uuid));
    }

    /** Bring the maps up to date.
     *
     * @arg grouped Map dataset UUID -> Map structure application UUID
     * -> config, as AppConfigs gives it.
     * @arg changed The dataset UUIDs whose inner map differs from the
     * call before, as a Set or an array. Null means any of them can
     * differ. The first call does not read this: it has no call before
     * it, so it looks at every dataset.
     * @returns `{ datasets, valid, invalid, defaults, changed }`, or
     * null if no entry differs. `changed` is a native Set of the
     * dataset UUIDs whose entry was added, replaced or removed. The
     * first call always returns a value, and its `changed` holds every
     * dataset.
     */
    apply (grouped, changed) {
        this.stats.applies++;

        /* The first value read from a shared sequence can be a replay
         * of its latest value. Its map is complete, but its `changed`
         * names an older change, and an index built from only those
         * datasets would be missing the rest. */
        if (!this.started) changed = null;

        let ids = changed;
        if (ids == null) {
            ids = new Set(grouped.keys());
            for (const id of this.entries.keys()) ids.add(id);
            for (const id of this.refs.keys()) ids.add(id);
            this.windows.clear();
        }

        for (const id of ids)
            this._update_refs(id, grouped.get(id));

        /* A change to a dataset can change every dataset that refers
         * to it, and so on up. Nothing else can depend on it. */
        const stale = this._closure(ids);
        for (const id of stale)
            this.windows.delete(id);

        /* Dataset UUID -> its new entry, or null if it has gone, for
         * the datasets whose entry differs. */
        const updates = new Map();
        for (const id of stale) {
            const old = this.entries.get(id);
            const entry = this._build_entry(id, grouped);
            if (entry == null) {
                if (old !== undefined) updates.set(id, null);
            }
            else if (old === undefined || !same_entry(old, entry))
                updates.set(id, entry);
        }
        this._store(updates);
        const { entries, valid, invalid, defaults } = this;

        const first = !this.started;
        this.started = true;
        if (!first && updates.size == 0) return null;
        return {
            datasets: entries, valid, invalid, defaults,
            changed: new Set(updates.keys()),
        };
    }

    /* Put new entries in the four public maps. A map that no update
     * touches stays the same object. */
    _store (updates) {
        if (updates.size == 0) return;
        const is_valid = entry => entry != null
            && entry.structure !== Constants.Special.InvalidDataset;
        const put = (map, id, value) => {
            if (value == null) map.delete(id);
            else map.set(id, value);
        };

        this.entries = this.entries.withMutations(map => {
            for (const [id, entry] of updates) put(map, id, entry);
        });
        this.valid = this.valid.withMutations(map => {
            for (const [id, entry] of updates)
                put(map, id, is_valid(entry) ? entry : null);
        });
        this.invalid = this.invalid.withMutations(map => {
            for (const [id, entry] of updates)
                put(map, id, entry != null && !is_valid(entry) ? entry : null);
        });
        this.defaults = this.defaults.withMutations(map => {
            for (const [id, entry] of updates)
                put(map, id, default_dataset_device(id, entry));
        });
    }

    /* Record which datasets `id` refers to now. A dataset with no
     * structure entry, or with more than one, refers to nothing. */
    _update_refs (id, defs) {
        let refs = [];
        if (defs != null && defs.size == 1) {
            const [structure, config] = defs.entries().next().value;
            refs = dataset_refs(structure, config);
        }

        const old = this.refs.get(id);
        if (old) {
            for (const target of old) {
                const users = this.referrers.get(target);
                if (!users) continue;
                users.delete(id);
                if (users.size == 0) this.referrers.delete(target);
            }
        }

        if (refs.length == 0) {
            this.refs.delete(id);
            return;
        }
        const now = new Set(refs);
        this.refs.set(id, now);
        for (const target of now) {
            let users = this.referrers.get(target);
            if (!users) this.referrers.set(target, users = new Set());
            users.add(id);
        }
    }

    /* The given datasets and every dataset that refers to one of them,
     * through any number of datasets. */
    _closure (ids) {
        const seen = new Set(ids);
        const queue = [...seen];
        while (queue.length > 0) {
            const users = this.referrers.get(queue.pop());
            if (!users) continue;
            for (const user of users) {
                if (seen.has(user)) continue;
                seen.add(user);
                queue.push(user);
            }
        }
        return seen;
    }

    /* The entry `id` should have, or null if it should have none. */
    _build_entry (id, grouped) {
        const defs = grouped.get(id);
        if (defs == null || defs.size == 0) return null;

        const win = this._resolve(id, grouped, new Set());
        if (win == null) return invalid_entry();

        const [structure, config] = defs.entries().next().value;
        return { structure, config, from: win.from, to: win.to };
    }

    /* The window of a dataset, or null if it is missing or invalid.
     *
     * `visited` holds the datasets on the path from the dataset first
     * asked for down to this one, and each reference gets its own
     * copy. So a dataset is found in `visited` only when it is its own
     * ancestor, and a result never depends on the order datasets are
     * asked for. That is what makes it safe to keep results across
     * calls. */
    _resolve (id, grouped, visited) {
        if (this.windows.has(id))
            return this.windows.get(id);

        /* A cycle. The call that put `id` in `visited` is still
         * running and will record null for it when this returns. */
        if (visited.has(id))
            return null;
        visited.add(id);

        const defs = grouped.get(id);
        /* A missing dataset. Not recorded: it has no entry to keep. */
        if (defs == null || defs.size == 0)
            return null;

        this.stats.resolved++;
        let win = null;
        /* More than one structure entry makes a dataset invalid. */
        if (defs.size == 1) {
            const [structure, config] = defs.entries().next().value;
            /* A stored config can be anything. One that cannot be read
             * makes this dataset invalid, and through the null result
             * every dataset that refers to it. */
            try {
                win = resolve_window(structure, config,
                    ref => this._resolve(ref, grouped, new Set(visited)));
            }
            catch {
                win = null;
            }
        }
        this.windows.set(id, win);
        return win;
    }
}
