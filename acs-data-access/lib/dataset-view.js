/*
 * ACS Data Access Service
 * What one notify subscription shows, kept up to date one dataset at a time
 * Copyright 2026 University of Sheffield
 */

/* A DatasetView holds the datasets one notify subscription shows and
 * the body it shows for each. One change to a source makes the view
 * work out the bodies that change can touch, and no other. Each
 * subscription has a view of its own: nothing a principal sees is ever
 * read from what was worked out for another.
 *
 * The functions below the class turn a view into what the notify
 * library asks a handler for: a SEARCH source, a WATCH of one dataset
 * or a WATCH of a list. */

import * as rx from "rxjs";

import { json_equal } from "@amrc-factoryplus/service-api";

/* Marks "every key" where a Set of changed keys is expected. */
const ALL = Symbol("all");

/* What happened to a child, in a change the view reports. */
const CREATED = "created";
const CHANGED = "changed";
const REMOVED = "removed";

/** The datasets one subscription shows, and a body for each.
 *
 * `sources` maps a tag to a change sequence of DataFlow. The tags the
 * bodies below read are:
 *
 *  - `data`: `DataFlow#changes`, the dataset maps.
 *  - `check`: `DataFlow#watch_allowed_check`, the permission rule.
 *  - `info`, `meta`, `ftypes`: `info_changes`, `metadata_changes` and
 *    `functional_changes`.
 *  - `parts`: `parts_changes`, or `dataset_parts_changes` for a view
 *    of one dataset.
 *
 * Every value has a `changed` Set that names the keys the last change
 * touched, or null for every key. A source that is shared gives a new
 * subscriber its latest value again, so the view takes the first value
 * of each source as "every key changed".
 *
 * The view shows nothing until every tag in `required` has a value. A
 * source that is not required and has no value yet counts as empty:
 * the bodies are worked out without it, and again when it answers.
 *
 * `children` is the state: a native Map from dataset UUID to the body
 * shown. It is in the order the datasets became visible.
 */
export class DatasetView {
    /**
     * @arg opts.sources An object from tag to Observable.
     * @arg opts.required The tags that must have a value before the
     * view shows anything. The default is none.
     * @arg opts.candidates The datasets that can be shown: a function
     * from the state to a Map of them (anything with `has` and
     * `keys`), or an array of UUIDs for a view of a fixed list.
     * @arg opts.body A function `(state, uuid)` that gives the body of
     * a candidate, or undefined if the view does not show it.
     * @arg opts.name A label, for whoever reads `registry`.
     * @arg opts.principal The principal the view is for. A label too:
     * the permission rule comes from the `check` source.
     * @arg opts.registry A Set. The view is in it while it runs.
     */
    constructor (opts) {
        this.sources = opts.sources;
        this.required = opts.required ?? [];
        this.fixed = Array.isArray(opts.candidates)
            ? new Set(opts.candidates) : null;
        this.candidates = opts.candidates;
        this.body = opts.body;
        this.name = opts.name;
        this.principal = opts.principal;
        this.registry = opts.registry;

        /** The latest value of each source that has answered, by tag. */
        this.state = {};
        /** Dataset UUID -> the body shown. */
        this.children = new Map();
        /** Counts of the work done: `computed` is the bodies worked
         * out, `sent` the changes to a child reported after the first
         * build. */
        this.stats = { computed: 0, sent: 0 };
        /** Resolves when the view has first worked out its children.
         * It never rejects: a view that fails, or stops before it has
         * built, leaves it unresolved. */
        this.ready = new Promise(resolve => { this._ready = resolve; });

        this.seen = new Set();
        this.built = false;
        this.started = false;
    }

    /** Run the view.
     *
     * The view subscribes to its sources when this is subscribed, and
     * unsubscribes from them all when it is unsubscribed. It can be
     * subscribed once.
     *
     * The first value is `{ built: true, changes: [] }`: `children`
     * now holds every dataset shown. The view takes whatever the
     * sources send during the subscribe call before it builds, so on a
     * service that is running the first build has every value.
     *
     * Each later value is `{ built: false, changes }` with one or more
     * `{ key, kind, body }`, where `kind` is "created", "changed" or
     * "removed" and a removed child has no body. `children` is up to
     * date when the value is sent. One value holds every child that
     * one source change touched.
     *
     * An error from any source errors this. It never completes.
     */
    changes () {
        return new rx.Observable(subscriber => {
            if (this.started) {
                subscriber.error(
                    new Error("A DatasetView can be subscribed only once"));
                return;
            }
            this.started = true;
            this.registry?.add(this);

            const subs = [];
            let closed = false;
            let starting = true;

            const close = () => {
                if (closed) return;
                closed = true;
                for (const sub of subs) sub.unsubscribe();
                this.registry?.delete(this);
            };
            const fail = err => {
                if (closed) return;
                close();
                subscriber.error(err);
            };
            /* A body function that throws must not take the process
             * down: the subscription fails instead. */
            const guarded = fn => {
                try { fn(); }
                catch (err) { fail(err); }
            };
            const build = () => guarded(() => {
                if (closed || this.built || !this._can_build()) return;
                this._build();
                subscriber.next({ built: true, changes: [] });
            });

            for (const [tag, source] of Object.entries(this.sources)) {
                const sub = source.subscribe({
                    next: value => {
                        if (closed) return;
                        const first = !this.seen.has(tag);
                        this.seen.add(tag);
                        this.state[tag] = value;
                        if (starting) return;
                        if (!this.built) return build();

                        guarded(() => {
                            const changes = this._refresh(
                                this._dirty(tag, value, first));
                            if (!changes.length) return;
                            this.stats.sent += changes.length;
                            subscriber.next({ built: false, changes });
                        });
                    },
                    error: fail,
                });
                /* A source can fail inside the subscribe call. */
                if (closed) {
                    sub.unsubscribe();
                    break;
                }
                subs.push(sub);
            }
            starting = false;
            build();

            return close;
        });
    }

    _can_build () {
        return this.required.every(tag => this.seen.has(tag));
    }

    /* The datasets that can be shown now: something with `has` and
     * `keys`. */
    _candidates () {
        return this.fixed ?? this.candidates(this.state);
    }

    _body (key) {
        this.stats.computed++;
        return this.body(this.state, key);
    }

    _build () {
        for (const key of this._candidates().keys()) {
            const body = this._body(key);
            if (body !== undefined) this.children.set(key, body);
        }
        this.built = true;
        this._ready();
    }

    /* The keys whose body one new value of a source can change: a Set,
     * or ALL.
     *
     * A value names the keys it touched. Two sources reach further. A
     * body lists the parts of its dataset that the principal may read,
     * and whether it may read a part depends on the permission rule
     * and on the dataset map, which says whether the part is a default
     * dataset. So a `data` or `check` change to a part also touches
     * the datasets that list it. */
    _dirty (tag, value, first) {
        if (first || value.changed == null) return ALL;
        if (tag != "data" && tag != "check") return value.changed;

        const parents = this.state.parts?.parents;
        if (!parents?.size) return value.changed;

        let dirty = null;
        for (const id of value.changed) {
            const listed = parents.get(id);
            if (!listed) continue;
            dirty ??= new Set(value.changed);
            for (const parent of listed) dirty.add(parent);
        }
        return dirty ?? value.changed;
    }

    /* Work out the body of each dirty key again and say what changed.
     * A key that is no candidate and no child costs nothing. */
    _refresh (dirty) {
        const candidates = this._candidates();
        const changes = [];

        const look = key => {
            const held = this.children.get(key);
            const candidate = candidates.has(key);
            if (!candidate && held === undefined) return;

            const body = candidate ? this._body(key) : undefined;
            if (body === undefined) {
                if (held === undefined) return;
                this.children.delete(key);
                changes.push({ key, kind: REMOVED });
            }
            else if (held === undefined) {
                this.children.set(key, body);
                changes.push({ key, kind: CREATED, body });
            }
            else if (!json_equal(held, body)) {
                this.children.set(key, body);
                changes.push({ key, kind: CHANGED, body });
            }
        };

        if (dirty === ALL) {
            const gone = [...this.children.keys()]
                .filter(key => !candidates.has(key));
            for (const key of gone) look(key);
            for (const key of candidates.keys()) look(key);
        }
        else {
            for (const key of dirty) look(key);
        }
        return changes;
    }
}

/* May the principal see this dataset? `device` is the device the
 * dataset is the valid default dataset of, if it is one. */
function allowed (state, uuid) {
    return state.check.ok(uuid, state.data.defaults.get(uuid));
}

/** The body of a dataset in a membership-only view: true for a dataset
 * the principal may see. The view's candidates say which datasets are
 * looked at. Needs the `data` and `check` sources. */
export function member_body (state, uuid) {
    const { data, check } = state;
    if (!data || !check) return undefined;
    return allowed(state, uuid) ? true : undefined;
}

/** The metadata body of a dataset, or undefined unless the dataset is
 * valid and the principal may read it.
 *
 * The keys are in the order clients have always had: uuid, name, from,
 * to, function, metadata, parts. A key with no value is undefined, so
 * it is left out of the JSON. `parts` lists the dataset's parts the
 * principal may read, whether or not a part is a valid dataset, and is
 * empty while the parts are not known.
 */
export function metadata_body (state, uuid) {
    const { data, check } = state;
    if (!data || !check) return undefined;

    const dataset = data.valid.get(uuid);
    if (!dataset || !allowed(state, uuid)) return undefined;

    const info = state.info?.map.get(uuid);
    const parts = state.parts?.map.get(uuid);

    return {
        uuid,
        name: info?.name ?? "UNKNOWN",
        from: dataset.from ?? undefined,
        to: dataset.to ?? undefined,
        "function": state.ftypes?.map.get(uuid),
        metadata: state.meta?.map.get(uuid),
        parts: parts ? parts.filter(part => allowed(state, part)) : [],
    };
}

/** The structure body of a dataset, `{ structure, config }`, or
 * undefined unless the principal may read the structure.
 *
 * @arg valid_only Give no body for an invalid dataset. Otherwise an
 * invalid dataset has the body `{ structure: InvalidDataset, config:
 * null }`.
 */
export function structure_body (state, uuid, valid_only) {
    const { data, check } = state;
    if (!data || !check) return undefined;

    const dataset = (valid_only ? data.valid : data.datasets).get(uuid);
    if (!dataset || !allowed(state, uuid)) return undefined;

    const { from, to, ...body } = dataset;
    return body;
}

/* The child update for one change of a view. */
function child_update ({ key, kind, body }) {
    if (kind == REMOVED)
        return { status: 200, child: key, response: { status: 404 } };
    return {
        status: 200,
        child: key,
        response: { status: kind == CREATED ? 201 : 200, body },
    };
}

/* A search source has not given its snapshot, has given it and holds
 * the updates since, or sends each update as it comes. */
const WAITING = 0;
const HOLDING = 1;
const LIVE = 2;

/** A view as the source of a notify SEARCH: `{ full, updates, acl }`,
 * which is what `Notify#search` asks a handler for.
 *
 * `updates` runs the view. `full` waits for the view to build and
 * gives the snapshot of its children; the notify library calls it
 * before it subscribes to `updates`, and puts every update behind it
 * in a queue until the snapshot has gone. A long queue there overflows
 * the stack. So this never lets one build up:
 *
 *  - A change before the snapshot is in the snapshot. It is not sent.
 *  - A change after it is kept here until the next turn of the event
 *    loop. By then the snapshot has left the library. The kept updates
 *    go out in order, and from then on each goes straight out.
 *
 * A client therefore gets one snapshot and then only changes.
 */
export function search_source (view) {
    let phase = WAITING;
    let held = [];
    let timer = null;
    let out = null;

    const release = () => {
        timer = null;
        /* By index, so an update that arrives while these go out
         * still goes out after them. */
        for (let i = 0; out && i < held.length; i++)
            out.next(held[i]);
        held = [];
        phase = LIVE;
    };

    const updates = new rx.Observable(subscriber => {
        out = subscriber;
        const sub = view.changes().subscribe({
            next ({ changes }) {
                if (phase == WAITING) return;
                for (const change of changes) {
                    const update = child_update(change);
                    if (phase == HOLDING) held.push(update);
                    else subscriber.next(update);
                }
            },
            error (err) { subscriber.error(err); },
        });

        return () => {
            out = null;
            sub.unsubscribe();
            if (timer != null) clearImmediate(timer);
            timer = null;
            held = [];
        };
    });

    const full = async () => {
        await view.ready;

        /* One synchronous run from here to the return, so the snapshot
         * and the switch to holding updates cannot disagree. */
        const children = {};
        for (const [uuid, body] of view.children)
            children[uuid] = { status: 200, body };
        if (phase == WAITING && out) {
            phase = HOLDING;
            timer = setImmediate(release);
        }
        return { children, response: { status: 204 } };
    };

    /* The view has applied the permission rule already. */
    return { full, updates, acl: rx.pipe() };
}

const watch_update = body => ({
    status: 200,
    response: { status: 200, body },
});

/** A view as a notify WATCH of one dataset.
 *
 * With `always`, this sends what the view holds for the dataset as
 * soon as the view has built, a body or a 200 with no body, and then
 * every change, including back to no body. Without it, this sends only
 * a body, and only one that differs from the last body sent: a
 * dataset that goes away sends nothing.
 */
export function watch_key (view, uuid, { always = false } = {}) {
    return new rx.Observable(subscriber => {
        let sent = false;
        let last;

        const sub = view.changes().subscribe({
            next ({ built, changes }) {
                if (!built && !changes.some(c => c.key == uuid)) return;
                const body = view.children.get(uuid);

                if (!always) {
                    if (body === undefined) return;
                    if (sent && json_equal(body, last)) return;
                }
                sent = true;
                last = body;
                subscriber.next(watch_update(body));
            },
            error (err) { subscriber.error(err); },
        });
        return () => sub.unsubscribe();
    });
}

/** A view as a notify WATCH of a list of UUIDs: the datasets the view
 * shows, sent whole when the view has built and each time a dataset
 * joins or leaves. The order of the list means nothing. */
export function watch_list (view) {
    return new rx.Observable(subscriber => {
        const sub = view.changes().subscribe({
            next ({ built, changes }) {
                if (!built && !changes.some(c => c.kind != CHANGED)) return;
                subscriber.next(watch_update([...view.children.keys()]));
            },
            error (err) { subscriber.error(err); },
        });
        return () => sub.unsubscribe();
    });
}
