/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import * as rx          from "rxjs";

import * as rxx         from "@amrc-factoryplus/rx-util";
import { Notify }       from "@amrc-factoryplus/service-api";

import { Perm }         from "./constants.js";
import { Relations }    from "./relations.js";
import * as rxu         from "./rx-util.js";

const mk_res = (response, ix) => ({ status: ix ? 200 : 201, response });

function entry_response (entry) {
    if (!entry?.config)
        return { status: 404 };
    const response = { status: 200, body: entry.config };
    if (entry?.etag)
        response.headers = { etag: entry.etag };
    return response;
}

function list_response (list) {
    if (!list)
        return { status: 404 };
    return { status: 200, body: [...list] };
}

function set_contents (lookup) {
    return rx.pipe(
        rx.startWith(null),
        rx.switchMap(lookup),
        rx.map(l => l && new Set(l)),
        rx.distinctUntilChanged(deep_equal),
        rx.map(list_response),
        rx.map(mk_res));
}

/* Compare two class lookup results. Each is a Set of UUIDs, or
 * undefined if the class does not exist. This gives the same answer as
 * deep_equal for these values, at a fraction of the cost. */
function same_set (a, b) {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    if (a.size != b.size) return false;
    for (const x of a)
        if (!b.has(x)) return false;
    return true;
}

export class CDBNotify {
    constructor (opts) {
        this.auth   = opts.auth;
        this.model  = opts.model;
        this.log    = opts.debug.bound("notify");

        this.config_updates = rxx.rx(
            this.model.updates,
            rx.filter(u => u.type == "config"),
            rx.share());
        /* Config updates for one (app, object). Most watchers watch a
         * single config, so we don't filter every update past every
         * watcher. */
        this.object_updates = rxu.keyed(this.config_updates,
            u => JSON.stringify([u.app, u.object]));
        this.class_updates = rxx.rx(
            this.model.updates,
            rx.filter(u => u.type == "class"),
            rx.share());

        /* Lookups triggered by class updates, one per (relation,
         * class) however many clients are watching it. Nothing is
         * replayed to new watchers, so stop as soon as the last watcher
         * leaves rather than running lookups nobody receives. */
        this.lookup_seq = 0;
        this.shared_lookups = rxx.cacheSeq({
            factory: key => this.shared_lookup(...JSON.parse(key)),
            timeout: 0,
        });

        this.notify = this.build_notify(opts.api);
    }

    build_notify (api) {
        const notify = new Notify({
            api,
            log:    this.log,
        });

        for (const vers of ["v1", "v2"]) {
            notify.watch(`${vers}/app/:app/object/:obj`, this.single_config.bind(this));
            notify.watch(`${vers}/app/:app/object/`, this.config_list.bind(this));
            notify.search(`${vers}/app/:app/object/`, this.config_search.bind(this));
        }

        for (const rel of Relations) {
            notify.watch(`v2/class/:class/${rel.path}/`,
                this.class_watch.bind(this, rel.table, rel.cperm));
        }

        return notify;
    }

    run () { this.notify.run(); }
    
    /* XXX This is not right. Until we have a push Auth API we will need
     * to check ACLs for every update, but we should avoid sending more
     * updates after a 403 until we get an ACL change. */
    acl_checker (session, ...args) {
        const check = async update => {
            const ok = await this.auth.check_acl(session.principal, ...args);
            if (ok)
                return update;

            return {
                status: update.status,
                response: {
                    status: 403,
                },
            };
        };

        return rx.concatMap(check);
    }

    single_config (session, app, object) {
        const { model } = this;

        const ck_acl = this.acl_checker(session, Perm.ReadApp, app, true);

        /* XXX Strictly there is a race condition here: the initial fetch
         * does not slot cleanly into the sequence of updates. This would be
         * difficult to fix. */
        return rxx.rx(
            rx.concat(
                model.config_get({ app, object }),
                this.object_updates(JSON.stringify([app, object]))),
            rx.map(entry_response),
            rx.map(mk_res),
            ck_acl);
    }

    config_list (session, app) {
        const { model } = this;

        const ck_acl = this.acl_checker(session, Perm.ReadApp, app, true);

        /* Here we fetch the complete list every time. We could track
         * the list contents from changes but this is safer. */
        return rxx.rx(
            this.config_updates,
            rx.filter(u => u.app == app),
            set_contents(() => model.config_list(app)),
            ck_acl);
    }

    async search_full (app) {
        const { model } = this;

        const entries = await model.config_get_all(app);
        if (!entries)
            return { response: { status: 404 } };

        const children = Object.fromEntries(
            entries.map(e => [e.object, entry_response(e)]));

        return {
            children,
            response:   { status: 204 },
        };
    }

    config_search (session, app) {
        const acl = this.acl_checker(session, Perm.ReadApp, app, true);

        const full = () => this.search_full(app);
        const updates = rxx.rx(
            this.config_updates,
            rx.filter(u => u.app == app),
            rx.map(entry => ({
                status:     200,
                child:      entry.object,
                response:   entry_response(entry),
            })));

        return { acl, full, updates };
    }

    /* Look up one class relation. The result is tagged with the order
     * the lookup started in. */
    async class_lookup (rel, klass) {
        const seq = ++this.lookup_seq;
        const list = await this.model.class_lookup(klass, rel);
        return { seq, set: list && new Set(list) };
    }

    /* Re-run the lookup on every class update. Class updates carry no
     * detail, so every watched relation must be looked up again. This
     * seq is shared by all watchers of the same relation, and runs at
     * most one lookup at a time: updates that arrive during a lookup
     * are handled by one more lookup once it finishes. */
    shared_lookup (rel, klass) {
        return rxx.rx(
            this.class_updates,
            rxu.coalesce(() => this.class_lookup(rel, klass)));
    }

    /* XXX This is not ideal. There is a race between the update and the
     * lookup meaning we might miss notifications. It would be better to
     * pass the update in the sequence but I think that would mean caching
     * the whole class structure js-side. */
    class_watch (rel, perm, session, klass) {
        const ck_acl = this.acl_checker(session, perm, klass, true);
        const shared = this.shared_lookups(JSON.stringify([rel, klass]));

        return rx.defer(() => {
            /* Each watcher does its own initial lookup, then follows
             * the shared lookups. We use a result only if its lookup
             * started after the last one we used. This is the ordering
             * the per-watcher switchMap used to give: an older lookup
             * never replaces a newer one. */
            let latest = 0;
            return rxx.rx(
                rx.merge(shared, rx.defer(() => this.class_lookup(rel, klass))),
                rx.filter(r => {
                    if (r.seq < latest) return false;
                    latest = r.seq;
                    return true;
                }),
                rx.map(r => r.set),
                rx.distinctUntilChanged(same_set),
                rx.map(list_response),
                rx.map(mk_res),
                ck_acl);
        });
    }
}
