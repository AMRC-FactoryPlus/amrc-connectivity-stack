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
        this.status.subscribe(st => this.log("STATUS: %o", st.toJS()));
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
            rx.reduce((map, kv) => map.set(...kv), imm.Map()),
        );

        return rx.from(cdb.watcher()).pipe(
            rx.mergeMap(w => w.application(Git.App.Config)),
            rx.startWith(null),
            rx.switchMap(fetch),
            rxx.shareLatest(),
        );
    }

    _init_status () {
        const repos = this.configs.pipe(
            rx.map(cfs => cfs.keySeq().toSet()),
            rx.startWith(imm.Set()),
            rx.pairwise(),
            rx.mergeMap(([then, now]) => rx.concat(
                then.subtract(now).map(u => [false, u]),
                now.subtract(then).map(u => [true, u]),
            )),
        );

        return rx.merge(repos, this.changed).pipe(
            /* Unusually we need to use concatMap here to avoid
             * concurrency. This is because adds and deletes need to be
             * kept in the right order. We could mess with groupBy to be
             * concurrent across different repos but let's not bother. */
            rx.concatMap(([op, uuid]) => 
                (op ? this.branches(uuid) : rx.of(null)).pipe(
                    rx.map(v => [uuid, v]))),
            rx.scan((map, [k, v]) => v ? map.set(k, v) : map.delete(k),
                imm.Map()),
            rx.auditTime(1000),
            rxx.shareLatest(),
        );
    }

    branches (uuid) {
        const gitdir = `${this.data}/${uuid}`;
        return rx.from(git.listBranches({ fs, gitdir })).pipe(
            rx.mergeAll(),
            rx.mergeMap(ref => git.resolveRef({ fs, gitdir, ref })
                .then(sha => [ref, sha])),
            rx.reduce((map, e) => map.set(...e), imm.Map()),
            rx.catchError(e => imm.Map()),
        );
    }

    update (uuid) {
        this.changed.next([true, uuid]);
    }
}
