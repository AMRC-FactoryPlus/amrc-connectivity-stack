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

//import { Schemas }      from "./hooks/schemas.js";

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

    async update_done (update) {
        this.done = update(this.done);
        const h_st = this.done.entrySeq()
            .map(([inst, commit]) => ({ commit, ...inst.toJS() }))
            .toArray();
        await fsp.writeFile(this.hook_state, JSON.stringify(h_st), "utf8");
        this.log("Rewrite hook-state: %o", h_st);
    }

    /* Accepts the current state of the server.
     * Calculates which hooks need to run and runs them. We keep a state
     * file recording what has been run. This looks like
     *  [ { hook, repo, branch, commit } ]
     * and records the commit SHA the last time each hook was run.
     */
    async run_hooks ({ configs, status }) {
        const { done } = this;

        /* NOTE: some callbacks take (key, value) and some (value, key). */

        /* Calculate the changes we need to make. */
        const want = configs
            .filter(conf => conf.hooks)
            .flatMap((conf, repo) => imm.Map(conf.hooks)
                .mapKeys((branch, hook) => Instance({ repo, branch, hook })))
            .map((hook, inst) => status.get(inst.repo)?.get(inst.branch));

        this.log("Want: %o", want.toJS());
        this.log("Done: %o", done.toJS());

        const removed = done.keySeq().filter(inst => want.has(inst));
        this.log("Removed: %o", removed.toJS());
        await this.update_done(d => d.deleteAll(removed));

        const changed = want.filter((commit, inst) => done.get(inst) != commit);
        this.log("Changed: %o", changed.toJS());

        for (const [inst, commit] of changed)
            await this.run_hook(inst, commit);
    }

    async run_hook (inst, commit) {
        const msg = format("hook %s for %s branch %s",
            inst.hook, inst.repo, inst.branch);

        //const hook = this.hooks.get(inst.hook);
        //if (!hook) {
        //    this.log("Undefined %s", msg);
        //    return;
        //}

        /* XXX Should we retry on error? I'm not sure here. In general
         * an error is unlikely to be resolved by retrying, but there
         * are some limited circumstances such as service-setup not run
         * yet where errors have external causes and can be fixed.
         * Perhaps we should distinguish permanent problems with the
         * repo contents from temporary service errors? */
        this.log("Running %s", msg);
        await setTimeout(6000);
        //await hook(inst.repo, commit)
        //    .then(() => this.log("Finished %s", msg))
        //    .catch(err => this.log("Error running %s: %s", msg, err));
        
        await this.update_done(d => d.set(inst, commit));
    }
}

