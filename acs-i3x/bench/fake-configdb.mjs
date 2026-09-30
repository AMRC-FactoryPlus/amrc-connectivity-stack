/*
 * ACS i3X
 * In-memory stand-in for the RxClient ConfigDB notify interface
 * Copyright 2026 University of Sheffield
 */

/*
 * Only the calls that lib/refresh.ts and ObjectTree.init() make are
 * implemented. Every notify message is delivered on a later macrotask
 * (setImmediate), the way notify-v2 messages arrive on a WebSocket. If
 * the event loop is busy, deliveries queue up behind it, as they would
 * in a real socket buffer.
 */

import * as rx from "rxjs";

/* The duck-typed immutable.js Set shape refresh.ts expects. */
class MemberSet {
    constructor (items) { this.items = [...items]; }
    isEmpty () { return this.items.length === 0; }
    [Symbol.iterator] () { return this.items[Symbol.iterator](); }
}

export class FakeConfigDB {
    constructor () {
        this.configs = new Map();
        this.config_subs = new Map();
        this.members = new Set();
        this.member_subs = new Set();
        this.stats = { watches: 0, deliveries: 0 };
    }

    deliver (fn) {
        setImmediate(() => {
            this.stats.deliveries++;
            fn();
        });
    }

    /* ---- The RxClient ConfigDB surface ---- */

    watch_config (app, obj) {
        const key = `${app}:${obj}`;
        return new rx.Observable(sub => {
            this.stats.watches++;
            let subs = this.config_subs.get(key);
            if (!subs) this.config_subs.set(key, subs = new Set());
            subs.add(sub);
            this.deliver(() => {
                if (!sub.closed) sub.next(this.configs.get(key) ?? null);
            });
            return () => subs.delete(sub);
        });
    }

    watch_members (klass) {
        return new rx.Observable(sub => {
            this.member_subs.add(sub);
            this.deliver(() => {
                if (!sub.closed) sub.next(new MemberSet(this.members));
            });
            return () => this.member_subs.delete(sub);
        });
    }

    async class_members (klass) { return [...this.members]; }

    async get_config (app, obj) {
        return this.configs.get(`${app}:${obj}`) ?? null;
    }

    /* ---- Writes, as an importer would make them ---- */

    put_config (app, obj, value) {
        const key = `${app}:${obj}`;
        this.configs.set(key, value);
        const subs = this.config_subs.get(key);
        if (!subs || subs.size === 0) return;
        this.deliver(() => {
            for (const sub of [...subs]) sub.next(value);
        });
    }

    create_object (uuid) {
        this.members.add(uuid);
        this.notify_members();
    }

    delete_object (uuid) {
        this.members.delete(uuid);
        this.notify_members();
    }

    notify_members () {
        if (this.member_subs.size === 0) return;
        const set = new MemberSet(this.members);
        this.deliver(() => {
            for (const sub of [...this.member_subs]) sub.next(set);
        });
    }
}

export function mk_fplus (configdb) {
    return {
        ConfigDB: configdb,
        Directory: { get_device_info: async () => ({ online: false }) },
        debug: { bound: () => () => {} },
    };
}
