/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Auto-pull from external repos
 * Copyright 2024 AMRC
 */

import imm          from "immutable";
import git          from "isomorphic-git";
import duration     from "parse-duration";
import rx           from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { Git }  from "./uuids.js";

const PullSpec = imm.Record({
    uuid:       null,
    branch:     null,
    url:        null,
    ref:        "main",
    interval:   null,
});
PullSpec.of = (uuid, [branch, conf]) => PullSpec({
    ...conf,
    uuid, branch,
    interval:   duration(conf.interval ?? "1h"),
});
    
export class AutoPull {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.data   = opts.data;

        this.log = this.fplus.debug.bound("pull");
    }

    async init () {
        this.configs = this._init_configs();
        this.pulls = this._init_pulls();

        return this;
    }

    _init_configs () {
        const app = Git.App.Config;
        const cdb = this.fplus.ConfigDB;

        const fetch = () => rx.from(cdb.list_configs(app)).pipe(
            rx.mergeAll(),
            rx.mergeMap(uuid => cdb.get_config(app, uuid)
                .then(conf => [uuid, conf])),
            rx.filter(([, conf]) => conf.pull),
            rx.mergeMap(([uuid, conf]) => Object.entries(conf.pull)
                .map(kv => PullSpec.of(uuid, kv))),
            rx.toArray(),
            rx.map(imm.Set),
        );

        return rx.from(cdb.watcher()).pipe(
            rx.mergeMap(w => w.application(Git.App.Config)),
            rx.startWith(null),
            rx.switchMap(fetch),
            rx.distinctUntilChanged(imm.is),
            rx.share(),
        );
    }

    _init_pulls () {
        return this.configs.pipe(
            rxx.mapItemsToObservable(s => this.pull(s)),
            rx.mergeAll(),
        );
    }

    pull (spec) {
        this.log("PULL: %o", spec.toJS());

        return rx.interval(spec.interval).pipe(
            rx.tap({
                subscribe:  () => this.log(`START ${spec.uuid}`),
                finalize:   () => this.log(`STOP ${spec.uuid}`),
            }),
            rx.tap(() => this.log(`UPDATE ${spec.uuid}`)),
        );
    }

    run () {
        this.configs.subscribe(cs => this.log("CONFIGS: %o", cs.toJS()));
        this.pulls.subscribe();
    }
}
