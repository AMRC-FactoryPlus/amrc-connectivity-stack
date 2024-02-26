/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Auto-pull from external repos
 * Copyright 2024 AMRC
 */

import imm          from "immutable";
import git          from "isomorphic-git";
import duration     from "parse-duration";
import rx           from "rxjs";

import { Git }  from "./uuids.js";

const PullSpec = imm.Record({
    url:        null,
    ref:        "main",
    interval:   null,
});
PullSpec.of = conf => PullSpec({
    ...conf,
    interval:   duration(conf.interval ?? "1h"),
});
    
const RepoSpec = imm.Record({
    uuid:   null,
    pull:   null,
});
RepoSpec.of = (uuid, conf) => RepoSpec({
    uuid,
    pull:   imm.Seq.Keyed(conf.pull).map(PullSpec.of).toMap(),
});

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
            rx.filter(([, conf]) => conf.pull),
            rx.map(e => RepoSpec.of(...e)),
            rx.toArray(),
            rx.map(pulls => new imm.Set(pulls)),
        );

        return rx.from(cdb.watcher()).pipe(
            rx.mergeMap(w => w.application(Git.App.Config)),
            rx.startWith(null),
            rx.switchMap(fetch),
            rx.distinctUntilChanged(imm.is),
            rx.share(),
        );
    }

    run () {
        this.configs.subscribe(cs => this.log("CONFIGS: %o", cs.toJS()));
    }
}
