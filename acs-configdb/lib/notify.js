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

const mk_res = init => response => ({ status: init ? 201 : 200, response });

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
    return { status: 200, body: list };
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

class CDBWatch {
    constructor (session, app) {
        this.session = session;
        this.model = session.model;
        this.app = app;
        this.log = session.log.bind(session);
    }

    /* XXX This is not right. Until we have a push Auth API we will need
     * to check ACLs for every update, but we should avoid sending more
     * updates after a 403 until we get an ACL change. */
    async check_acl (update) {
        const { session, app } = this;

        const ok = await session.check_acl(Perm.Read_App, app, true);
        if (ok)
            return update;

        return {
            status:     update.status,
            response:   { status: 403 },
        };
    }

    single_config (object) {
        const { model, app } = this;

        /* XXX Strictly there is a race condition here: the initial fetch
         * does not slot cleanly into the sequence of updates. This would be
         * difficult to fix. */
        return rxx.rx(
            rx.concat(
                rxx.rx(
                    model.config_get({ app, object }),
                    rx.map(entry_response),
                    rx.map(mk_res(true))),
                rxx.rx(
                    model.updates,
                    rx.filter(u => u.app == app && u.object == object),
                    rx.map(entry_response),
                    rx.map(mk_res(false)))),
            rx.flatMap(u => this.check_acl(u)));
    }

    config_list () {
        const { model, app } = this;

        /* Here we fetch the complete list every time. We could track
         * the list contents from changes but this is safer. */
        return rxx.rx(
            model.updates,
            rx.filter(u => u.app == app),
            rx.startWith(null),
            rx.concatMap(upd => model.config_list(app)
                .then(list_response)
                .then(mk_res(!!upd))),
            rx.flatMap(u => this.check_acl(u)));
    }

    search_full (status) {
        const { model, app } = this;

        /* XXX It would be better to fetch these atomically */
        return rxx.rx(
            rx.defer(() => model.config_list(app)),
            rx.mergeAll(),
            rx.mergeMap(object => model.config_get({ app, object })
                .then(entry_response)
                .then(res => [object, res])),
            rx.toArray(),
            rx.map(Object.fromEntries),
            rx.map(children => ({
                status,
                response:   { status: 204 },
                children,
            })));
    }

    search_filter (seq, filter) {
        const want = r => r.status < 300 && jmp_match(r.body, filter)
        return rxx.rx(
            seq,
            rxu.withState(imm.Set(), (okids, u) => {
                this.log("FILTER: %o %o", okids.toJS(), u);
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
            rx.mergeAll(),
            rx.tap(v => this.log("FILTER RETURN: %o", v)));
    }

    config_search (filter) {
        const { model, app } = this;

        const search = rxx.rx(
            model.updates,
            rx.filter(u => u.app == app),
            rx.map(entry => ({
                status:     200,
                child:      entry.object,
                response:   entry_response(entry),
            })),
            /* This will always be replaced with a full update */
            rx.startWith({ status: 201, child: true }),
            /* This will send a parent 403 if the ACL check fails */
            rx.concatMap(u => this.check_acl(u)),
            rxu.withState(true, (need_full, u) => {
                /* No-access will always be a parent update */
                const ok = u.child;
                const rv = need_full && ok
                    ? this.search_full(u.status)
                    : rx.of(u);
                return [!ok, rv];
            }),
            rx.concatAll());

        return filter ? this.search_filter(search, filter) : search;
    }
}

export class CDBNotify extends Notify {
    constructor (opts) {
        super(opts);
        this.model = opts.model;
    }

    build_handlers () {
        return [
            new WatchFilter({
                path:       "app/:app/object/:obj",
                handler:    (s, a, o) => new CDBWatch(s, a).single_config(o),
            }),
            new WatchFilter({
                path:       "app/:app/object/",
                handler:    (s, a) => new CDBWatch(s, a).config_list(),
            }),
            new SearchFilter({
                path:       "app/:app/object/",
                handler:    (s, f, a) => new CDBWatch(s, a).config_search(f),
            }),
        ];
    }
    
}
