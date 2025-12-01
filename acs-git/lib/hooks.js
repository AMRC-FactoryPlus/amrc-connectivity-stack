/*
 * ACS Git server
 * Post-commit hooks
 * Copyright 2025 University of Sheffield AMRC
 */

/* This class contains methods which can be invoked when a branch moves.
 * The initial need for this is automatic schema loading from a tracked
 * remote repo but more use cases may emerge in the future.
 */

import fs               from "fs";
import fsp              from "fs/promises";
import { format }       from "util";
import path             from "path";

import * as imm     from "immutable";
import git          from "isomorphic-git";
import * as rx      from "rxjs";

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
        this.data = opts.data;
        this.hook_state = opts.state;
        this.checkouts = opts.checkouts;
        
        this.wdprefix = path.join(opts.checkouts, "wd-");
        this.log = opts.fplus.debug.bound("hooks");
        this.runner = this._build_runner();
    }

    async run () {
        await fsp.mkdir(this.checkouts, { recursive: true });

        this.hooks = await this._build_hooks("schemas");

        const h_st = await fsp.readFile(this.hook_state, "utf8")
            .catch(() => ("[]"));
        this.done = imm.Seq(JSON.parse(h_st))
            .map(e => [Instance(e), e.commit])
            .fromEntrySeq().toMap();

        this.runner.subscribe();
    }

    _build_hooks (...hooks) {
        return Promise.all(
            hooks.map(h => 
                import(`./hooks/${h}.js`)
                    .then(m => [h, m.default])))
            .then(es => imm.Map(es));
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

        const removed = done.keySeq().filter(inst => !want.has(inst));
        this.log("Removed: %o", removed.toJS());
        await this.update_done(d => d.deleteAll(removed));

        const changed = want.filter((commit, inst) => done.get(inst) != commit);
        this.log("Changed: %o", changed.toJS());

        for (const [inst, commit] of changed) 
            await this.run_hook(inst, commit);
    }

    async checkout_for_hook (gitdir, ref) {
        const dir = await fsp.mkdtemp(this.wdprefix);
        await git.checkout({
            fs, gitdir, dir, ref,
            noUpdateHead: true,
            track: false,
            force: true,
        });
        return dir;
    }

    async run_hook (inst, commit) {
        const msg = format("hook %s for %s branch %s (%s)",
            inst.hook, inst.repo, inst.branch, commit);

        const Hook = this.hooks.get(inst.hook);
        if (!Hook) {
            this.log("Undefined %s", msg);
            return;
        }

        const gitdir = path.join(this.data, inst.repo);
        const workdir = await this.checkout_for_hook(gitdir, commit);

        /* XXX Should we retry on error? I'm not sure here. In general
         * an error is unlikely to be resolved by retrying, but there
         * are some limited circumstances such as service-setup not run
         * yet where errors have external causes and can be fixed.
         * Perhaps we should distinguish permanent problems with the
         * repo contents from temporary service errors? */
        this.log("Running %s", msg);
        await new Hook({ ...inst, gitdir, workdir, fplus: this.fplus })
            .run()
            .then(() => this.log("Finished %s", msg))
            .catch(err => this.log("Error running %s: %s", msg, err));
        
        await this.update_done(d => d.set(inst, commit));
        await fsp.rm(workdir, { recursive: true, force: true });
    }
}

