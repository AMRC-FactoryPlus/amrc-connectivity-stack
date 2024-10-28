/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import * as rx from "rxjs";

import * as rxx                 from "@amrc-factoryplus/rx-util";
import { Notify, PathHandler }  from "@amrc-factoryplus/service-api";

import { Perm } from "./constants.js";

export class CDBNotify extends Notify {
    constructor (opts) {
        super(opts);
        this.model = opts.model;
    }

    build_handlers () {
        return [
            new PathHandler({
                path:       "app/:app/object/:obj",
                handler:    (...a) => this.single_config(...a),
            }),
        ];
    }
    
    async create_response (session, app, update) {
        session.log("Map update: %o", update);
        const ok = await session.check_acl(Perm.Read_App, app, true);
        if (!ok)
            return { status: 403 };
        if (!update?.config)
            return { status: 404 };
        const res = { status: 200, body: update.config };
        if (update.etag)
            res.headers = { etag: update.etag };
        return res;
    }

    single_config (session, app, object) {
        /* XXX Strictly there is a race condition here: the initial fetch
         * does not slot cleanly into the sequence of updates. This would be
         * difficult to fix. */
        return rx.concat(
            rxx.rx(
                session.model.config_get({ app, object }),
                rx.flatMap(u => this.create_response(session, app, u)),
                rx.map(response => ({ status: 201, response }))),
            rxx.rx(
                session.model.updates,
                rx.filter(u => u.app == app && u.object == object),
                rx.flatMap(u => this.create_response(session, app, u)),
                rx.map(response => ({ status: 200, response }))),
        );
    }
}
