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

const duration_or_never = i => i == "never" ? -1 : duration(i);

class PullSpec extends imm.Record({
    uuid:       null,
    branch:     null,
    url:        null,
    ref:        "main",
    interval:   null,
    ff:         null,
}) {
    static of (uuid, branch, conf) {
        return new PullSpec({
            ...conf,
            uuid, branch,
            interval:   duration_or_never(conf.interval ?? "1h"),
            ff:         conf.merge,
        });
    }

    get desc () { return `${this.uuid}@${this.branch}`; }
}

export class AutoPull {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.data   = opts.data;
        this.status = opts.status;

        this.log = this.fplus.debug.bound("pull");
    }

    async init () {
        this.pulls = this._init_pulls();

        return this;
    }

    _init_pulls () {
        const updates = spec => rx.defer(() => rx.of(Math.random()*5000)).pipe(
            rx.mergeMap(jitter => rx.timer(jitter, spec.interval)),
            rx.tap({
                next:       () => this.log(`UPDATE ${spec.desc}`),
                subscribe:  () => this.log(`START ${spec.desc}`),
                finalize:   () => this.log(`STOP ${spec.desc}`),
            }),
            /* exhaustMap will avoid running another update if the
             * previous is still running */
            rx.exhaustMap(() => this.update(spec)
                .catch(e => this.log("UPDATE ERROR %s: %s", spec.desc, e))),
        );

        /* status.configs is a seq of imm.Map */
        return this.status.configs.pipe(
            rx.map(entries => entries.toSeq()
                .map(conf => imm.Seq.Keyed(conf.pull))
                .flatMap((pulls, uuid) => pulls
                    .map((pull, branch) => PullSpec.of(uuid, branch, pull)))
                .toSet()),
            rx.distinctUntilChanged(imm.is),
            rxx.mapStartStops(updates),
            rx.mergeAll(),
        );
    }

    async update (spec) {
        const gitdir    = `${this.data}/${spec.uuid}`;
        const remote    = `_update_${spec.branch}`;

        const get_ref = ref => git.resolveRef({ fs, gitdir, ref })
            .catch(e => e instanceof git.Errors.NotFoundError ? null 
                : Promise.reject(e))
        const before = await get_ref(spec.branch);

        await git.addRemote({ fs, gitdir, remote, url: spec.url });
        const mirror = await git.fetch({
            fs, gitdir, http, remote,
            singleBranch:   true,
            ref:            spec.ref,
        });
        const sha1 = mirror.fetchHead;

        const set_branch = ref => {
            this.log("Updating %s branch %s to %s", spec.uuid, ref, sha1);
            return git.branch({ fs, gitdir, ref, object: sha1, force:  true });
        };
        await set_branch(spec.branch);
        if (spec.ff) {
            const ff = await get_ref(spec.ff);
            if (ff == null || ff == before)
                await set_branch(spec.ff);
            else
                this.log("Leaving %s branch %s at %s", spec.uuid, spec.ff, ff);
        }

        await git.deleteRemote({ fs, gitdir, remote });
    }

    run () {
        this.pulls.subscribe();
    }
}
