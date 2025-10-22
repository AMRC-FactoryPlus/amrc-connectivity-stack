/*
 * ACS Git server
 * Post-commit hooks
 * Copyright 2025 University of Sheffield AMRC
 */

/* This class contains methods which can be invoked when a branch moves.
 * The initial need for this is automatic schema loading from a tracked
 * remote repo but more use cases may emerge in the future.
 */

import fsp              from "fs/promises";
import { setTimeout }   from "timers/promises";
import { format }       from "util";

import * as imm from "immutable";
import * as rx from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";

const Instance = imm.Record({ 
    hook: null,
    repo: null,
    branch: null,
});

export class Hooks {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.status = opts.status;
        this.hook_state = opts.state;

        this.log = opts.fplus.debug.bound("hooks");
        //this.hooks = this._build_hooks();
        this.runner = this._build_runner();
    }

    async run () {
        const h_st = await fsp.readFile(this.hook_state, "utf8")
            .catch(() => ("[]"));
        this.done = imm.Seq(JSON.parse(h_st))
            .map(e => [Instance(e), e.commit])
            .fromEntrySeq().toMap();

        this.runner.subscribe();
    }

    _build_runner () {
        const { configs, status } = this.status;
        return rxx.rx(
            rx.combineLatest({ configs, status }),
            /* This ensures we only do one run at a time, but we catch
             * up with the last item if we miss any. */
            rx.throttle(this.run_hooks.bind(this),
                { leading: true, trailing: true }));
    }

    /* Accepts the current state of the server.
     * Calculates which hooks need to run and runs them. We keep a state
     * file recording what has been run. This looks like
     *  [ { hook, repo, branch, commit } ]
     * and records the commit SHA the last time each hook was run.
     */
    async run_hooks ({ configs, status }) {
        const { done } = this;

        /* Calculate the changes we need to make. */
        const want = configs.entrySeq()
            .filter(([repo, conf]) => conf.hooks)
            .flatMap(([repo, conf]) => imm.Seq(conf.hooks)
                .entrySeq()
                .map(([branch, hook]) => Instance({ repo, branch, hook })))
            .map(inst => [inst, status.get(inst.repo)?.get(inst.branch)]);
        this.log("Want: %o", want.toJS());
        this.log("Done: %o", done.toJS());
        const changes = want.filter(([inst, commit]) => done.get(inst) != commit);
        this.log("Changed: %o", changes.toJS());

        for (const [inst, commit] of changes) {
            const msg = format("hook %s for %s branch %s",
                inst.hook, inst.repo, inst.branch);
            //const hook = this.hooks.get(inst.hook);
            //if (!hook) {
            //    this.log("Undefined %s", msg);
            //    continue;
            //}

            this.log("Running %s", msg);
            await setTimeout(6000);
            //const err = await hook(inst.repo, commit)
            //    .then(() => null, e => e);
            //if (err)
            //    this.log("Error running %s: %s", msg, err);
            this.log("Finished %s", msg);

            this.done = this.done.set(inst, commit);
            const h_st = this.done.entrySeq()
                .map(([inst, commit]) => ({ commit, ...inst.toJS() }))
                .toArray();
            await fsp.writeFile(this.hook_state, JSON.stringify(h_st), "utf8");
        }
    }
}

