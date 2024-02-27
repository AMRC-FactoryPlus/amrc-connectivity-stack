/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Make current repo status available
 * Copyright 2024 AMRC
 */

import fs           from "fs";

import imm          from "immutable";
import git          from "isomorphic-git";
import rx           from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { Git }  from "./uuids.js";

export class RepoStatus {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.data = opts.data;

        this.log = this.fplus.debug.bound("status");

        this.configs = this._init_configs();
        this.changed = new rx.Subject();
        this.status = this._init_status();
    }

    async init () {
        return this;
    }

    run () {
        this.configs.subscribe(cs => this.log("CONFIGS: %o", cs.toJS()));
    }

    /* A sequence returning our current set of config entries. This
     * returns an imm.Map and doesn't remove duplicates. */
    _init_configs () {
        const app = Git.App.Config;
        const cdb = this.fplus.ConfigDB;

        const fetch = () => rx.from(cdb.list_configs(app)).pipe(
            rx.mergeAll(),
            rx.mergeMap(uuid => cdb.get_config(app, uuid)
                .then(conf => [uuid, conf])),
            rx.reduce((map, kv) => map.set(...kv),
                imm.Map().asMutable()),
            rx.map(map => map.asImmutable()),
        );

        return rx.from(cdb.watcher()).pipe(
            rx.mergeMap(w => w.application(Git.App.Config)),
            rx.startWith(null),
            rx.switchMap(fetch),
            rxx.shareLatest(),
        );
    }

    _init_status () {
        return rx.NEVER;
    }

    update (uuid) {
        this.changed.next([uuid, true]);
    }

    remove (uuid) {
        this.changed.next([uuid, false]);
    }
}
