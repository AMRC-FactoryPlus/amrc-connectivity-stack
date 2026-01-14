/*
 * ACS Git server
 * Change-notify WS interface
 * Copyright 2025 University of Sheffield
 */

import * as imm from "immutable";
import * as rx from "rxjs";

import * as rxx         from "@amrc-factoryplus/rx-util";
import { Notify }       from "@amrc-factoryplus/service-api";

function imm_res (v, ix) {
    const response = v
        ? { status: 200, body: v.toJS() }
        : { status: 404 };
    return { status: ix ? 200 : 201, response };
}

export class GitNotify {
    constructor (opts) {
        this.status = opts.status.status;
        this.log    = opts.debug.bound("notify");

        this.notify = this.build_notify(opts.api);
    }

    build_notify (api) {
        const notify = new Notify({
            api,
            log:    this.log,
        });

        notify.watch("/v1/status/", this.repo_list.bind(this));
        notify.watch("/v1/status/:uuid", this.repo_status.bind(this));

        return notify;
    }

    run () { this.notify.run(); }
   
    repo_list (session) {
        return rxx.rx(
            this.status,
            rx.map(st => st.keySeq().toSet()),
            rx.distinctUntilChanged(imm.is),
            rx.map(imm_res));
    }

    repo_status (session, uuid) {
        return rxx.rx(
            this.status,
            rx.map(st => st.get(uuid)),
            rx.distinctUntilChanged(imm.is),
            rx.map(imm_res));
    }
}

