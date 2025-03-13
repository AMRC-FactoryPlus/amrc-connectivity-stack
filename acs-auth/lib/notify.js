/* ACS Auth service
 * Change-notify interface
 * Copyright 2025 University of Sheffield AMRC
 */

import * as rx from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";
import { Notify }   from "@amrc-factoryplus/service-api";

function to_update (response, ix) {
    return { status: ix ? 200 : 201, response };
}

function set_response (items) {
    if (!items)
        return { status: 403 };
    return { status: 200, body: [...new Set(items)] };
}

export class AuthNotify {
    constructor (opts) {
        this.data   = opts.data;
        this.log    = opts.debug.bound("notify");

        this.notify = this.build_notify(opts.api);
    }

    run () {
        this.log("Running notify server");
        this.notify.run();
    }

    build_notify (api) {
        const notify = new Notify({
            api,
            log:    this.log,
        });

        notify.watch("v2/principal/", this.principal_list.bind(this));

        return notify;
    }

    principal_list (sess) {
        return rxx.rx(
            this.data.track_identities(sess.principal, () => true),
            rx.map(ids => ids?.map(i => i.uuid)),
            rx.map(set_response),
            rx.map(to_update));
    }
}
