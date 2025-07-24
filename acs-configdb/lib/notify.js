/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import deep_equal from "deep-equal";
import * as imm from "immutable";
import * as rx from "rxjs";

import * as rxx         from "@amrc-factoryplus/rx-util";
import { Notify }       from "@amrc-factoryplus/service-api";

import { Perm } from "./constants.js";
import * as rxu from "./rx-util.js";

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

function jmp_match (cand, filter) {
    if (filter === null || typeof(filter) != "object")
        return cand === filter;
    if (Array.isArray(filter))
        return deep_equal(cand, filter);

    for (const [k, v] of Object.entries(filter)) {
        if (v === null) {
            if (k in cand)
                return false;
        }
        else {
            if (!(k in cand) || !jmp_match(cand[k], v))
                return false;
        }
    }
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

        notify.watch("v2/class/:class/member/",
            this.class_watch.bind(this, "all_membership"));
        notify.watch("v2/class/:class/subclass/",
            this.class_watch.bind(this, "all_subclass"));
        notify.watch("v2/class/:class/direct/member/",
            this.class_watch.bind(this, "membership"));
        notify.watch("v2/class/:class/direct/subclass/",
            this.class_watch.bind(this, "subclass"));

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

        const ck_acl = this.acl_checker(session, Perm.Read_App, app, true);

        /* XXX Strictly there is a race condition here: the initial fetch
         * does not slot cleanly into the sequence of updates. This would be
         * difficult to fix. */
        return rxx.rx(
            rx.concat(
                model.config_get({ app, object }),
                rxx.rx(
                    this.config_updates,
                    rx.filter(u => u.app == app && u.object == object))),
            rx.map(entry_response),
            rx.map(mk_res),
            ck_acl);
    }

    config_list (session, app) {
        const { model } = this;

        const ck_acl = this.acl_checker(session, Perm.Read_App, app, true);

        /* Here we fetch the complete list every time. We could track
         * the list contents from changes but this is safer. */
        return rxx.rx(
            this.config_updates,
            rx.filter(u => u.app == app),
            set_contents(() => model.config_list(app)),
            ck_acl);
    }

    async search_full (app, status) {
        const { model } = this;

        const entries = await model.config_get_all(app);
        if (!entries)
            return { status, response: { status: 404 } };

        const children = Object.fromEntries(
            entries.map(e => [e.object, entry_response(e)]));

        return {
            status, children,
            response:   { status: 204 },
        };
    }

    config_search (session, app) {
        const acl = this.acl_checker(session, Perm.Read_App, app, true);

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

    /* XXX This is not ideal. There is a race between the update and the
     * lookup meaning we might miss notifications. It would be better to
     * pass the update in the sequence but I think that would mean caching
     * the whole class structure js-side. */
    class_watch (rel, session, klass) {
        const { model } = this;

        /* XXX We should check different perms for direct and derived */
        const ck_acl = this.acl_checker(session, Perm.Manage_Obj, klass, true);

        return rxx.rx(
            this.model.updates,
            rx.filter(u => u.type == "class"),
            /* This line opens a txn per update per watcher. This is not
             * good. Perhaps have a shared seq querying the full
             * relation set on every update? Or just track changes
             * properly... */
            set_contents(() => model.class_lookup(klass, rel)),
            ck_acl);
    }
}
