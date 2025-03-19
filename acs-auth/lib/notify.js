/* ACS Auth service
 * Change-notify interface
 * Copyright 2025 University of Sheffield AMRC
 */

import * as rx from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";
import { Notify }   from "@amrc-factoryplus/service-api";

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
        const idt = this.data.track_identities(sess.principal);
        if (!idt.isPresent) return { status: 404 };

        return rxx.rx(
            idt.get(),
            rx.map(idr => idr.uniq(i => i.uuid)),
            rx.map((res, ix) => res.toUpdate(ix)));
    }
}
