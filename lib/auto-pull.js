/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Auto-pull from external repos
 * Copyright 2024 AMRC
 */

import fs           from "fs";

import duration     from "parse-duration";
import imm          from "immutable";
import git          from "isomorphic-git";
import http         from "isomorphic-git/http/node/index.js";
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
        const updates = spec => rx.defer(() => rx.of(Math.random()*5000)).pipe(
            rx.mergeMap(jitter => rx.timer(jitter, spec.interval)),
            rx.tap({
                next:       () => this.log(`UPDATE ${spec.uuid}`),
                subscribe:  () => this.log(`START ${spec.uuid}`),
                finalize:   () => this.log(`STOP ${spec.uuid}`),
            }),
            /* exhaustMap will avoid running another update if the
             * previous is still running */
            rx.exhaustMap(() => this.update(spec)
                .catch(e => this.log("UPDATE ERROR: %s", e))),
        );

        return this.configs.pipe(
            rxx.mapItemsToObservable(updates),
            rx.mergeAll(),
        );
    }

    async update (spec) {
        this.log("UPDATE: %o", spec.toJS());
        const gitdir    = `${this.data}/${spec.uuid}`;
        const remote    = `_update_${spec.branch}`;

        await git.addRemote({ fs, gitdir, remote, url: spec.url });
        const mirror = await git.fetch({
            fs, gitdir, http, remote,
            singleBranch:   true,
            ref:            spec.ref,
        });
        const sha1 = mirror.fetchHead;
        this.log("Updating %s branch %s to %s", spec.uuid, spec.branch, sha1);
        await git.branch({fs, gitdir, ref: spec.branch, object: sha1, force: true});
        await git.deleteRemote({ fs, gitdir, remote });
    }

    run () {
        this.configs.subscribe(cs => this.log("CONFIGS: %o", cs.toJS()));
        this.pulls.subscribe();
    }
}
