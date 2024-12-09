/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import deep_equal from "deep-equal";
import * as imm from "immutable";
import * as rx from "rxjs";

import * as rxx                 from "@amrc-factoryplus/rx-util";
import { 
    Notify, WatchFilter, SearchFilter
}  from "@amrc-factoryplus/service-api";

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

/* XXX This is not right. Until we have a push Auth API we will need
 * to check ACLs for every update, but we should avoid sending more
 * updates after a 403 until we get an ACL change. */
function acl_checker (session, ...args) {
    const check = async update => {
        const ok = await session.check_acl(...args);
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

class ConfigWatch {
    constructor (session, app) {
        this.session = session;
        this.model = session.model;
        this.app = app;

        this.updates = rxx.rx(
            this.model.updates,
            rx.filter(u => u.type == "config"));

        this.check_acl = acl_checker(this.session, Perm.Read_App, this.app, true);
    }

    single_config (object) {
        const { model, app } = this;

        /* XXX Strictly there is a race condition here: the initial fetch
         * does not slot cleanly into the sequence of updates. This would be
         * difficult to fix. */
        return rxx.rx(
            rx.concat(
                model.config_get({ app, object }),
                rxx.rx(
                    this.updates,
                    rx.filter(u => u.app == app && u.object == object))),
            rx.map(entry_response),
            rx.map(mk_res),
            this.check_acl);
    }

    config_list () {
        const { model, app } = this;

        /* Here we fetch the complete list every time. We could track
         * the list contents from changes but this is safer. */
        return rxx.rx(
            this.updates,
            rx.filter(u => u.app == app),
            set_contents(() => model.config_list(app)),
            this.check_acl);
    }

    async search_full (status) {
        const { model, app } = this;

        const list = await model.config_list(app);
        if (!list)
            return { status, response: { status: 404 } };

        const entries = await Promise.all(
            list.map(object => model.config_get({ app, object })
                .then(entry_response)
                .then(res => [object, res])));

        return {
            status,
            response:   { status: 204 },
            children:   Object.fromEntries(entries),
        };
    }

    search_filter (seq, filter) {
        const want = r => r.status < 300 && jmp_match(r.body, filter)
        return rxx.rx(
            seq,
            rxu.withState(imm.Set(), (okids, u) => {
                if (!u.child) {
                    /* Don't touch no-access updates */
                    if (!u.children)
                        return [imm.Set(), rx.of(u)];
                    const entries = imm.Seq(u.children).filter(want);
                    return [
                        entries.keySeq().toSet(),
                        rx.of({ ...u, children: entries.toJS() }),
                    ];
                }
                const child = u.child;
                const nkids = want(u.response) ? okids.add(child) : okids.delete(child);
                const nu = nkids.has(child) ? rx.of(u)
                    : okids.has(child)
                        ? rx.of({ status: 200, child, response: { status: 412 } })
                    : rx.EMPTY;
                return [nkids, nu];
            }),
            rx.mergeAll());
    }

    config_search (filter) {
        const { model, app } = this;

        const search = rxx.rx(
            this.updates,
            rx.filter(u => u.app == app),
            rx.map(entry => ({
                status:     200,
                child:      entry.object,
                response:   entry_response(entry),
            })),
            /* This will always be replaced with a full update */
            rx.startWith({ status: 201, child: true }),
            /* This will send a parent 403 if the ACL check fails */
            this.check_acl,
            rxu.asyncState(false, async (child_ok, u) => {
                const rv = u.child && !child_ok
                    ? await this.search_full(u.status)
                    : u;
                return [rv.child || rv.children, rv];
            }));

        return filter ? this.search_filter(search, filter) : search;
    }
}

/* XXX This is not ideal. There is a race between the update and the
 * lookup meaning we might miss notifications. It would be better to
 * pass the update in the sequence but I think that would mean caching
 * the whole class structure js-side. */
function class_watch (rel, session, klass) {
    const model = session.model;

    const ck_acl = acl_checker(session, Perm.Manage_Obj, klass, true);

    return rxx.rx(
        model.updates,
        rx.filter(u => u.type == "class"),
        set_contents(() => model.class_lookup(klass, rel)),
        ck_acl);
}

export class CDBNotify extends Notify {
    constructor (opts) {
        super(opts);
        this.model = opts.model;
    }

    build_handlers () {
        const v1_2 = vers => [
            new WatchFilter({
                path:       `${vers}/app/:app/object/:obj`,
                handler:    (s, a, o) => new ConfigWatch(s, a).single_config(o),
            }),
            new WatchFilter({
                path:       `${vers}/app/:app/object/`,
                handler:    (s, a) => new ConfigWatch(s, a).config_list(),
            }),
            new SearchFilter({
                path:       `${vers}/app/:app/object/`,
                handler:    (s, f, a) => new ConfigWatch(s, a).config_search(f),
            }),
        ];
        return [
            ...v1_2("v1"),
            ...v1_2("v2"),
            new WatchFilter({
                path:       "v2/class/:class/member/",
                handler:    class_watch.bind(null, "all_membership"),
            }),
            new WatchFilter({
                path:       "v2/class/:class/subclass/",
                handler:    class_watch.bind(null, "all_subclass"),
            }),
        ];
    }
    
}
