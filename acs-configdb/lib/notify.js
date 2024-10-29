/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import * as rx from "rxjs";

import * as rxx                 from "@amrc-factoryplus/rx-util";
import { Notify, PathHandler }  from "@amrc-factoryplus/service-api";

import { Perm } from "./constants.js";

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

class CDBWatch {
    constructor (session, app) {
        this.session = session;
        this.model = session.model;
        this.app = app;
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
}

export class CDBNotify extends Notify {
    constructor (opts) {
        super(opts);
        this.model = opts.model;
    }

    build_handlers () {
        return [
            new PathHandler({
                path:       "app/:app/object/:obj",
                handler:    (s, a, o) => new CDBWatch(s, a).single_config(o),
            }),
            new PathHandler({
                path:       "app/:app/object/",
                handler:    (s, a) => new CDBWatch(s, a).config_list(),
            }),
        ];
    }
    
}
