/*
 * ACS Data Access Service
 * Test support: a fake ConfigDB and Auth that hold one site and count work
 * Copyright 2026 University of Sheffield
 */

/* Not a test file itself: vitest only collects *.test.js.
 *
 * A FakeSite holds the state of one site (application configs, class
 * members, subclasses and ACLs) and gives the two interfaces Data
 * Access reads it through: `cdb` and `auth`. A change made through a
 * driver (`put`, `add_member`, `set_acl`, ...) or through one of the
 * async ConfigDB calls on `cdb` changes the state and sends the
 * notification a real service sends, to every open subscription.
 *
 * Notifications are delivered synchronously unless `notify_lag` is
 * set, so a test can read the result on the next line. `settle()`
 * waits for the work that promises put off.
 *
 * Every subscribe, grant check and delivered message is counted in
 * `counters`, so a test can assert how much work one change costs. */

import * as imm from "immutable";
import * as rx from "rxjs";

import { NotifyV2, UUIDs } from "@amrc-factoryplus/rx-client";

export const ROOT = "root@EXAMPLE.ORG";

/* Captured before any test installs fake timers, so settle() and the
 * block timer keep working under them. */
const real_immediate = globalThis.setImmediate;
const real_timeout = globalThis.setTimeout;
const real_now = performance.now.bind(performance);

const quiet = () => {};

/* How long the rx-client library keeps a class relation WATCH that has
 * no subscriber, in ms (cacheSeq in rx-util). */
const IDLE_WATCH = 5000;

/* The notify sources. An `app` source is one ConfigDB SEARCH over an
 * application. `member` and `subclass` are ConfigDB class relation
 * WATCHes. `acl` is an Auth ACL watch for one principal. */
const KINDS = ["app", "member", "subclass", "acl"];

/* A value as it comes back from a JSON API. */
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const same_json = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A Map from key to count. */
export class Counter extends Map {
    add (key, n = 1) {
        this.set(key, (this.get(key) ?? 0) + n);
    }

    total () {
        let total = 0;
        for (const n of this.values()) total += n;
        return total;
    }
}

/* The Set of targets Auth gives for one permission. It counts `has`:
 * the grant check Data Access makes per dataset, and the calls it
 * makes to compare a pushed ACL with the one before. */
class GrantSet extends Set {
    constructor (items, counters) {
        super(items);
        this.counters = counters;
    }

    has (value) {
        this.counters.grant_has++;
        return super.has(value);
    }
}

export class FakeSite {
    /** Build an empty site.
     * @arg opts.root The root principal. Root holds every permission.
     * @arg opts.latency Milliseconds each async ConfigDB call takes.
     * @arg opts.notify_lag Milliseconds between a change and its
     * notification. 0 delivers synchronously.
     * @arg opts.grant_on_create `{ principal, permission }`: each new
     * object adds one target to that principal's ACL, as an ownership
     * grant does.
     */
    constructor (opts = {}) {
        this.latency = opts.latency ?? 0;
        this.notify_lag = opts.notify_lag ?? 0;
        this.grant_on_create = opts.grant_on_create ?? null;

        /* app -> Map object -> config */
        this.apps = new Map();
        /* class -> Set of UUIDs, for each relation */
        this.relations = { member: new Map(), subclass: new Map() };
        /* object -> class it was created in */
        this.objects = new Map();
        /* principal -> array of { permission, target }. A principal
         * with no entry is one Auth does not know. */
        this.acls = new Map();

        /* kind -> id -> Set of subscriber records */
        this.subs = Object.fromEntries(KINDS.map(k => [k, new Map()]));
        /* The shared class relation sequences, as cacheSeq keeps them. */
        this.shared = { member: new Map(), subclass: new Map() };
        /* The subscriptions callers hold on watch_members and
         * watch_subclasses now, by class. `subs` cannot show these: the
         * library shares one WATCH between them and keeps it for a
         * while after the last one has gone. */
        this.watching = { member: new Counter(), subclass: new Counter() };
        this.held = new Set();
        this.closed = false;

        /* Set to a function (method, ...args) => Error | undefined to
         * make ConfigDB calls fail. */
        this.failing = null;

        /* Messages delivered, by this site and by notify clients built
         * on it. settle() watches this. */
        this.activity = 0;
        /* Calls in flight and notifications not yet delivered. */
        this.pending = 0;
        this.next_object = 0;

        this.counters = this.reset_counters();
        this.auth = this._build_auth(opts.root ?? ROOT);
        this.cdb = this._build_cdb();
    }

    /* ---- Counters ---- */

    /** Zero every counter. Returns the new counters object, which is
     * also `this.counters`. */
    reset_counters () {
        const fresh = {
            /* SEARCH subscribes, by application. Each gets a snapshot. */
            search:     new Counter(),
            /* Subscribes to watch_members and watch_subclasses, by
             * class. This is what a caller asked for. */
            watch:      { member: new Counter(), subclass: new Counter() },
            /* WATCHes this opened on the fake ConfigDB, by class. The
             * library shares one WATCH per class between callers. */
            opened:     { member: new Counter(), subclass: new Counter() },
            /* Subscribes to watch_acl_with_perm, by "principal permission". */
            acl:        new Counter(),
            /* Async ConfigDB calls, by method name. */
            calls:      new Counter(),
            /* has() calls on the grant Sets Auth gave out, whoever
             * made them. Data Access makes one for each dataset it
             * checks. It also makes some on every ACL push, to see
             * whether the grants of a permission changed: one for the
             * Null UUID and up to three for each target, for each
             * open permission watch. So count the checks of a change
             * that is no ACL push, or allow for these. */
            grant_has:  0,
            /* ACL entries filtered: the ACL size, once per open
             * permission watch, per push. */
            acl_scanned: 0,
            /* UUIDs in the class relation lists ConfigDB sent. */
            member_elements: 0,
            /* UUIDs in the list bodies notify clients received. */
            list_elements: 0,
            /* Messages notify clients received. */
            messages:   0,
            /* Messages this site delivered to its subscribers. */
            notifications: 0,
            /* The synchronous time, in ms, each notification took to
             * deliver to every subscriber. */
            blocks:     { count: 0, max: 0, total: 0 },
        };
        if (this.counters) Object.assign(this.counters, fresh);
        else this.counters = fresh;
        return this.counters;
    }

    /** The counters as plain totals. */
    report () {
        const c = this.counters;
        return {
            search_subscribes:      c.search.total(),
            member_subscribes:      c.watch.member.total(),
            subclass_subscribes:    c.watch.subclass.total(),
            member_watches:         c.opened.member.total(),
            subclass_watches:       c.opened.subclass.total(),
            acl_subscribes:         c.acl.total(),
            calls:                  c.calls.total(),
            grant_checks:           c.grant_has,
            acl_scanned:            c.acl_scanned,
            member_elements:        c.member_elements,
            list_elements:          c.list_elements,
            messages:               c.messages,
            notifications:          c.notifications,
            blocks:                 c.blocks.count,
            longest_block_ms:       c.blocks.max,
            total_block_ms:         c.blocks.total,
        };
    }

    /** The synchronous duration of `fn`, in milliseconds. Wrap one
     * driver call in it to time one notification. */
    timed (fn) {
        const start = real_now();
        fn();
        return real_now() - start;
    }

    /* ---- State readers, for builders and oracles ---- */

    app (app) {
        let map = this.apps.get(app);
        if (!map) this.apps.set(app, map = new Map());
        return map;
    }

    members (klass) { return this._relation_set("member", klass); }
    subclasses (klass) { return this._relation_set("subclass", klass); }
    acl (principal) { return this.acls.get(principal); }

    _relation_set (rel, key) {
        const map = this.relations[rel];
        let set = map.get(key);
        if (!set) map.set(key, set = new Set());
        return set;
    }

    /* ---- Drivers: change the state and notify ---- */

    /** Set a config entry. An identical put sends no notification.
     * @returns Whether anything changed. */
    put (app, uuid, config) {
        if (config === undefined)
            throw new TypeError("put needs a config");
        const body = clone(config);
        const map = this.app(app);
        const had = map.has(uuid);
        if (had && same_json(map.get(uuid), body)) return false;
        map.set(uuid, body);
        /* Each subscriber parses the message for itself, so each gets
         * a body of its own. */
        this._send("app", app, () => ({
            status:     200,
            child:      uuid,
            response:   { status: had ? 200 : 201, body: clone(body) },
        }));
        return true;
    }

    /** Delete a config entry. */
    del (app, uuid) {
        const map = this.apps.get(app);
        if (!map?.has(uuid)) return false;
        map.delete(uuid);
        this._send("app", app, () => ({
            status:     200,
            child:      uuid,
            response:   { status: 404 },
        }));
        return true;
    }

    add_member (klass, uuid) {
        if (!this.objects.has(uuid)) this.objects.set(uuid, klass);
        return this._relate("member", klass, set => set.add(uuid));
    }

    remove_member (klass, uuid) {
        return this._relate("member", klass, set => set.delete(uuid));
    }

    /** Replace the member list of a class. ConfigDB sends one message
     * with the new list, however many members came and went. */
    set_members (klass, uuids) {
        const want = new Set(uuids);
        for (const u of want)
            if (!this.objects.has(u)) this.objects.set(u, klass);
        return this._replace("member", klass, want);
    }

    /** Replace the subclass list of a class. */
    set_subclasses (klass, uuids) {
        return this._replace("subclass", klass, new Set(uuids));
    }

    _replace (rel, key, want) {
        return this._relate(rel, key, set => {
            for (const u of [...set])
                if (!want.has(u)) set.delete(u);
            for (const u of want) set.add(u);
        });
    }

    _relate (rel, key, change) {
        const set = this._relation_set(rel, key);
        const before = [...set];
        change(set);
        const list = [...set];
        if (same_json(before, list)) return false;
        this._send_list(rel, key, list);
        return true;
    }

    /* ConfigDB sends the whole list on every change. */
    _send_list (rel, key, list) {
        this._send(rel, key, () => {
            this.counters.member_elements += list.length;
            return list;
        });
    }

    /** Set a principal's whole ACL and push it. Auth pushes the whole
     * ACL whether or not it changed, so this always notifies. */
    set_acl (principal, entries) {
        const acl = entries.map(e =>
            ({ permission: e.permission, target: e.target }));
        this.acls.set(principal, acl);
        this._send("acl", principal, rec => this._grant_set(acl, rec.permission));
    }

    grant (principal, permission, target) {
        this.set_acl(principal,
            [...this.acls.get(principal) ?? [], { permission, target }]);
    }

    revoke (principal, permission, target) {
        this.set_acl(principal, (this.acls.get(principal) ?? []).filter(e =>
            !(e.permission == permission && e.target == target)));
    }

    /** Push a principal's ACL again, unchanged. */
    repush_acl (principal) {
        this.set_acl(principal, this.acls.get(principal) ?? []);
    }

    /** Send every SEARCH subscriber of an application a new snapshot
     * with the same content, as a reconnect does. The bodies are new
     * objects, as they are when parsed from the wire again. The
     * snapshot holds the entries as they are now, however late a
     * notify lag delivers it. */
    resync (app) {
        const entries = [...this.app(app)];
        this._send("app", app, () => this._app_snapshot(entries));
    }

    /** Send a class relation's list again, unchanged. */
    resync_relation (rel, key) {
        this._send_list(rel, key, [...this._relation_set(rel, key)]);
    }

    /** Withhold the first answer of a source. Subscribers that have
     * their first answer keep getting updates.
     * @arg kind "app", "member", "subclass" or "acl", or "*" for every
     * source.
     * @arg id The application, class or principal. Omit for every
     * source of that kind.
     */
    hold (kind, id = "*") {
        this.held.add(kind == "*" ? "*" : `${kind}:${id}`);
    }

    /** Stop withholding, with the arguments given to `hold`, or with
     * none to release everything. Waiting subscribers get the current
     * state. */
    release (kind, id = "*") {
        if (kind === undefined) this.held.clear();
        else this.held.delete(kind == "*" ? "*" : `${kind}:${id}`);

        for (const k of KINDS) {
            for (const [key, subs] of [...this.subs[k]]) {
                if (this._held(k, key)) continue;
                for (const rec of [...subs])
                    if (!rec.done && !rec.ready) this._first(k, key, rec);
            }
        }
    }

    _held (kind, id) {
        return this.held.has("*")
            || this.held.has(`${kind}:*`)
            || this.held.has(`${kind}:${id}`);
    }

    /** Error every open subscription of one source. */
    error (kind, id, err = new Error("Fake source error")) {
        const subs = this.subs[kind].get(id);
        if (!subs) return;
        for (const rec of [...subs]) {
            rec.done = true;
            subs.delete(rec);
            rec.obs.error(err);
        }
    }

    /** Complete every open subscription. Call this when a test ends,
     * before it unsubscribes, so nothing is left running. */
    close () {
        this.closed = true;
        for (const k of KINDS) {
            for (const subs of [...this.subs[k].values()]) {
                for (const rec of [...subs]) {
                    rec.done = true;
                    rec.obs.complete();
                }
                subs.clear();
            }
            this.subs[k].clear();
        }
    }

    /** The number of open subscriptions to the fake services. A class
     * relation WATCH counts once however many callers share it, and
     * for 5 s after the last of them has gone. See `open_watches` for
     * what the callers hold. */
    open_subscriptions () {
        let n = 0;
        for (const k of KINDS)
            for (const subs of this.subs[k].values()) n += subs.size;
        return n;
    }

    /** The subscriptions callers hold on watch_members and
     * watch_subclasses now: `{ member, subclass }`, each a number. A
     * caller that does not unsubscribe shows here at once. */
    open_watches () {
        return {
            member:     this.watching.member.total(),
            subclass:   this.watching.subclass.total(),
        };
    }

    /** Wait until nothing is happening.
     *
     * Each turn waits for a setImmediate, which runs every promise
     * callback that is ready. This returns when no subscription, here
     * or on a notify client, has had a message for two turns in a row,
     * and fails after 50 turns. While a ConfigDB call or a lagged
     * notification is outstanding it waits in real time instead, for
     * at most `timeout` ms. Under fake timers, advance the timers past
     * the latency and the lag before calling this.
     */
    async settle ({ turns = 50, timeout = 2000 } = {}) {
        const deadline = real_now() + timeout;
        let seen = this.activity;
        let quiet_turns = 0;
        let turn = 0;
        while (turn < turns) {
            if (this.pending > 0) {
                if (real_now() > deadline)
                    throw new Error(`The site did not settle: ${this.pending} `
                        + `call(s) or notification(s) still outstanding`);
                await new Promise(r => real_timeout(r, 1));
                quiet_turns = 0;
                seen = this.activity;
                continue;
            }
            await new Promise(r => real_immediate(r));
            turn++;
            if (this.activity == seen && this.pending == 0) {
                if (++quiet_turns >= 2) return;
            }
            else {
                quiet_turns = 0;
                seen = this.activity;
            }
        }
        throw new Error(`The site did not settle in ${turns} turns`);
    }

    /* ---- Notify sources ---- */

    /* One subscription to one source. Each subscriber gets the current
     * state first, unless the source is held, then every change. */
    _source (kind, id, extra) {
        return new rx.Observable(obs => {
            if (this.closed) {
                obs.complete();
                return;
            }
            const rec = { obs, ready: false, done: false, ...extra };
            const map = this.subs[kind];
            let subs = map.get(id);
            if (!subs) map.set(id, subs = new Set());
            subs.add(rec);

            if (!this._held(kind, id)) this._first(kind, id, rec);

            return () => {
                rec.done = true;
                subs.delete(rec);
                if (!subs.size && map.get(id) === subs) map.delete(id);
            };
        });
    }

    _first (kind, id, rec) {
        rec.ready = true;
        switch (kind) {
            case "app":
                return this._deliver(rec, this._app_snapshot(this.app(id)));
            case "member":
            case "subclass": {
                const list = [...this._relation_set(kind, id)];
                this.counters.member_elements += list.length;
                return this._deliver(rec, list);
            }
            case "acl": {
                /* Auth answers nothing for a principal it does not
                 * know, until it learns of one. */
                const acl = this.acls.get(id);
                if (!acl) return;
                return this._deliver(rec, this._grant_set(acl, rec.permission));
            }
        }
    }

    /* A SEARCH snapshot of `entries`, the [object, config] pairs of
     * one application. A real client parses the snapshot from its own
     * WebSocket, so every snapshot has bodies of its own: no subscriber
     * shares a body with another, or with the site. */
    _app_snapshot (entries) {
        const children = {};
        for (const [uuid, body] of entries)
            children[uuid] = { status: 200, body: clone(body) };
        return { status: 201, response: { status: 204 }, children };
    }

    /* As auth.watch_acl_with_perm: filter the whole ACL and build a
     * new Set, for every subscriber, on every push. */
    _grant_set (acl, permission) {
        this.counters.acl_scanned += acl.length;
        return new GrantSet(
            acl.filter(e => e.permission == permission).map(e => e.target),
            this.counters);
    }

    /* Send one notification to every subscriber of a source that has
     * had its first answer.
     *
     * Who gets it is settled now, when the change is made, and not
     * when a notify lag delivers it. A subscriber that arrives in
     * between gets a first answer that already holds this change, so
     * it must not get the change again after it: a real ConfigDB never
     * sends a subscriber a change older than its snapshot.
     * `message_for` must build its message from what it captured when
     * the change was made, for the same reason. */
    _send (kind, id, message_for) {
        const subs = this.subs[kind].get(id);
        if (!subs?.size) return;
        const recipients = [...subs].filter(rec => !rec.done && rec.ready);
        this._notify(() => {
            for (const rec of recipients) {
                if (rec.done) continue;
                this._deliver(rec, message_for(rec));
            }
        });
    }

    _notify (fn) {
        if (this.notify_lag > 0) {
            this.pending++;
            setTimeout(() => {
                this.pending--;
                this._block(fn);
            }, this.notify_lag);
        }
        else {
            this._block(fn);
        }
    }

    _block (fn) {
        const start = real_now();
        fn();
        const took = real_now() - start;
        const { blocks } = this.counters;
        blocks.count++;
        blocks.total += took;
        if (took > blocks.max) blocks.max = took;
    }

    _deliver (rec, message) {
        this.activity++;
        this.counters.notifications++;
        rec.obs.next(message);
    }

    /* ---- The ConfigDB interface ---- */

    /* A class relation as the library gives it: the list ConfigDB
     * sent, made into an Immutable Set and compared with the last one
     * (configdb.js _watch_set), shared between callers and replayed,
     * and dropped when it has had no subscriber for 5 s (cacheSeq). A
     * caller that comes after that opens a new WATCH. close() ends
     * every WATCH and the timer of each one that is waiting to be
     * dropped. */
    _watch_relation (rel, key) {
        return rx.defer(() => {
            this.counters.watch[rel].add(key);
            const cache = this.shared[rel];
            let seq = cache.get(key);
            if (!seq) {
                const opened = rx.defer(() => {
                    this.counters.opened[rel].add(key);
                    return this._source(rel, key);
                });
                const shared = opened.pipe(
                    rx.map(list => imm.Set(list)),
                    rx.distinctUntilChanged(imm.is),
                    rx.finalize(() => {
                        if (cache.get(key) === shared) cache.delete(key);
                    }),
                    rx.share({
                        connector:              () => new rx.ReplaySubject(1),
                        resetOnError:           true,
                        resetOnComplete:        true,
                        resetOnRefCountZero:    () => rx.timer(IDLE_WATCH),
                    }));
                cache.set(key, seq = shared);
            }

            const held = this.watching[rel];
            held.add(key);
            return seq.pipe(rx.finalize(() => {
                held.add(key, -1);
                if (!held.get(key)) held.delete(key);
            }));
        });
    }

    _build_cdb () {
        /* The real NotifyV2 with a scripted request(), so search_app
         * and search_app_changes run the library's own code. */
        const notify = new NotifyV2({ log: quiet, debug: { bound: () => quiet } });
        notify.request = req => {
            const app = /^v2\/app\/([^/]+)\/object\/$/.exec(req.parent ?? "")?.[1];
            if (req.method != "SEARCH" || !app || req.filter !== undefined)
                throw new Error(
                    `Fake ConfigDB: unsupported notify request ${JSON.stringify(req)}`);
            return rx.defer(() => {
                this.counters.search.add(app);
                return this._source("app", app);
            });
        };

        const watch_members = klass => this._watch_relation("member", klass);
        const watch_subclasses = klass => this._watch_relation("subclass", klass);

        /* configdb.js expand_members and expand_subclasses. */
        const expand = watch => rx.switchMap(gs => rx.from(gs).pipe(
            rx.map(g => watch(g).pipe(rx.map(ms => [g, ms]))),
            rx.combineLatestAll((...es) => imm.Map(es)),
            rx.defaultIfEmpty(imm.Map())));

        const call = (method, fn) => (...args) => this._call(method, args, fn);

        return {
            notify,

            search_app: (app, filter) =>
                notify.search(`v2/app/${app}/object/`, filter),
            search_app_changes: (app, filter) =>
                notify.search_changes(`v2/app/${app}/object/`, filter),

            watch_members,
            watch_subclasses,
            expand_members:     () => expand(watch_members),
            expand_subclasses:  () => expand(watch_subclasses),
            watch_members_subclasses: klass =>
                watch_members(klass).pipe(expand(watch_subclasses)),
            watch_member_members: klass =>
                watch_members(klass).pipe(expand(watch_members)),
            watch_powerset: klass =>
                watch_subclasses(klass).pipe(expand(watch_members)),

            get_config: call("get_config", (app, obj) =>
                clone(this.apps.get(app)?.get(obj))),
            put_config: call("put_config", (app, obj, config) => {
                this.put(app, obj, config);
            }),
            delete_config: call("delete_config", (app, obj) => {
                this.del(app, obj);
            }),
            patch_config: call("patch_config", (app, obj, type, patch) => {
                if (type != "merge")
                    throw new RangeError("Only merge-patch supported");
                const now = this.apps.get(app)?.get(obj) ?? {};
                const next = { ...now };
                for (const [k, v] of Object.entries(patch)) {
                    if (v === null) delete next[k];
                    else next[k] = v;
                }
                this.put(app, obj, next);
            }),

            create_object: call("create_object", (klass, obj, excl, owner) =>
                this._create_object(klass, obj, excl, owner)),
            delete_object: call("delete_object", obj => {
                this._delete_object(obj);
            }),

            class_members: call("class_members", klass =>
                [...this.members(klass)]),
            class_subclasses: call("class_subclasses", klass =>
                [...this.subclasses(klass)]),
            class_direct_members: call("class_direct_members", klass =>
                [...this.members(klass)]),
            class_direct_subclasses: call("class_direct_subclasses", klass =>
                [...this.subclasses(klass)]),
            class_has_member: call("class_has_member", (klass, obj) =>
                this.members(klass).has(obj)),
            class_has_direct_member: call("class_has_direct_member", (klass, obj) =>
                this.members(klass).has(obj)),
            class_has_subclass: call("class_has_subclass", (klass, obj) =>
                this.subclasses(klass).has(obj)),
            class_add_member: call("class_add_member", (klass, obj) => {
                this.add_member(klass, obj);
            }),
            class_remove_member: call("class_remove_member", (klass, obj) => {
                this.remove_member(klass, obj);
            }),
            class_add_subclass: call("class_add_subclass", (klass, obj) => {
                this._relate("subclass", klass, set => set.add(obj));
            }),
            class_remove_subclass: call("class_remove_subclass", (klass, obj) => {
                this._relate("subclass", klass, set => set.delete(obj));
            }),
        };
    }

    async _call (method, args, fn) {
        this.counters.calls.add(method);
        this.pending++;
        try {
            if (this.latency > 0)
                await new Promise(r => setTimeout(r, this.latency));
            else
                await null;
            const err = this.failing?.(method, ...args);
            if (err) throw err;
            return fn(...args);
        }
        finally {
            this.pending--;
        }
    }

    /* A real ConfigDB registers the object, then tells the class's
     * member watchers. Creating an object that exists changes nothing. */
    _create_object (klass, obj, excl, owner) {
        if (obj != null && this.objects.has(obj)) {
            if (excl) throw new Error(`Exclusive create of ${obj} failed`);
            return obj;
        }
        const uuid = obj ?? this._new_uuid();
        this.objects.set(uuid, klass);
        this.put(UUIDs.App.Registration, uuid, {
            uuid, "class": klass, rank: 0, owner: owner ?? null, deleted: false,
        });
        this._relate("member", klass, set => set.add(uuid));

        const grant = this.grant_on_create;
        if (grant) this.grant(grant.principal, grant.permission, uuid);
        return uuid;
    }

    /* A real ConfigDB drops every config entry and class link of a
     * deleted object. */
    _delete_object (obj) {
        this.objects.delete(obj);
        for (const [app, map] of [...this.apps])
            if (map.has(obj)) this.del(app, obj);
        for (const rel of ["member", "subclass"]) {
            for (const [key, set] of [...this.relations[rel]])
                if (set.has(obj)) this._relate(rel, key, s => s.delete(obj));
        }
        if (this.relations.subclass.get(obj)?.size)
            this.set_subclasses(obj, []);
    }

    _new_uuid () {
        const n = (++this.next_object).toString(16).padStart(12, "0");
        return `0b1ec700-0000-4000-8000-${n}`;
    }

    /* ---- The Auth interface ---- */

    _build_auth (root) {
        const fetch_acl = async principal => {
            if (principal == root) return () => true;
            const acl = this.acls.get(principal) ?? [];
            return (permission, target, wild) => acl.some(e =>
                e.permission == permission
                && (e.target == target
                    || (wild && e.target == UUIDs.Special.Null)));
        };

        return {
            root_principal: root,

            watch_acl_with_perm: (principal, permission) => rx.defer(() => {
                this.counters.acl.add(`${principal} ${permission}`);
                return this._source("acl", principal, { permission });
            }),

            fetch_acl,
            check_acl: async (principal, permission, target, wild) =>
                (await fetch_acl(principal))(permission, target, wild),
        };
    }
}

/** Build an empty site. See FakeSite for the options. */
export function make_site (opts) {
    return new FakeSite(opts);
}
