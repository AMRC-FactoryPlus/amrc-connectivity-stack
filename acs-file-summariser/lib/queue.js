/*
 * ACS File Summariser
 * Small bounded-concurrency job queue
 * Copyright 2026 University of Sheffield
 */

export class Queue {
    constructor (opts) {
        this.concurrency = opts.concurrency ?? 1;
        this.log = opts.log ?? (() => {});

        this.pending = [];
        this.active = new Set();
    }

    async init () { return this; }

    /* Queue a job identified by `key` unless one is already queued or
     * running for that key. `task` is a function returning a Promise. */
    push (key, task) {
        if (this.active.has(key) || this.pending.some(j => j.key === key))
            return;

        this.pending.push({ key, task });
        this.drain();
    }

    drain () {
        while (this.active.size < this.concurrency && this.pending.length) {
            const { key, task } = this.pending.shift();
            this.active.add(key);

            Promise.resolve()
                .then(task)
                .catch(e => this.log("Job %s failed: %s", key, e))
                .finally(() => {
                    this.active.delete(key);
                    this.drain();
                });
        }
    }
}
