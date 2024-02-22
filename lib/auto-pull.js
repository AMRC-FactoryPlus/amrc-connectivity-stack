/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Auto-pull from external repos
 * Copyright 2024 AMRC
 */

import git      from "isomorphic-git";
import rx       from "rxjs";

import { Git }  from "./uuids.js";

export class AutoPull {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.data   = opts.data;

        this.log = this.fplus.debug.bound("pull");
    }

    async init () {
        this.configs = this._init_configs();

        return this;
    }

    _init_configs () {
        const app = Git.App.Config;
        const cdb = this.fplus.ConfigDB;

        const fetch = () => rx.from(cdb.list_configs(app)).pipe(
            rx.mergeAll(),
            rx.mergeMap(obj => cdb.get_config(app, obj)
                .then(conf => [obj, conf])),
            rx.toArray(),
            rx.map(kvs => new Map(kvs)),
        );

        return rx.from(cdb.watcher()).pipe(
            rx.mergeMap(w => w.application(Git.App.Config)),
            rx.startWith(null),
            rx.switchMap(fetch),
        );
    }

    run () {
        this.configs.subscribe(cs => this.log("CONFIGS: %o", cs));
    }
}
