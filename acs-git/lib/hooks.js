i/*
 * ACS Git server
 * Post-commit hooks
 * Copyright 2025 University of Sheffield AMRC
 */

/* This class contains methods which can be invoked when a branch moves.
 * The initial need for this is automatic schema loading from a tracked
 * remote repo but more use cases may emerge in the future.
 */

import fsp from "fs/promises";

import imm from "immutable";

const Instance = imm.Record({ 
    hook: null,
    repo: null,
    branch: null,
});

export class Hooks {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.status = opts.status;
        this.hook_state = opts.hook_state;

        this.log = opts.fplus.debug.bound("hooks");
        this.hooks = this._build_hooks();
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

    /* Accepts the current state of the server.
     * Calculates which hooks need to run and runs them. We keep a state
     * file recording what has been run. This looks like
     *  [ { hook, repo, branch, commit } ]
     * and records the commit SHA the last time each hook was run.
     */
    run_hooks (configs, state) {
        const { done } = this;

        /* Calculate the desired state from the server state. */
        const want = configs.entrySeq()
            .filter(([repo, conf]) => conf.hooks)
            .flatMap(([repo, conf]) => imm.Seq(conf.hooks)
                .entrySeq()
                .map(([branch, hook]) => Instance({ repo, branch, hook })))
            .map(inst => [inst, state.get(inst.repo)?.get(inst.branch)])
            .toMap();
        this.log("Want: %o", want.toJS());

        
