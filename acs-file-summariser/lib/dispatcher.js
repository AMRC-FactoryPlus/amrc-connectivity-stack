/*
 * ACS File Summariser
 * Watches registered file-type classes and enqueues unprocessed members
 * Copyright 2026 University of Sheffield
 */

import * as rx   from "rxjs";
import * as rxx  from "@amrc-factoryplus/rx-util";

/* How often to re-check members that aren't marked done, even if class
 * membership hasn't changed (e.g. a file whose previous attempt failed). */
const RETRY_INTERVAL = 5 * 60 * 1000;
const RETRY_JITTER = 60 * 1000;

export class Dispatcher {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cdb = this.fplus.ConfigDB;
        this.state = opts.state;
        this.queue = opts.queue;
        this.registry = opts.registry;
        this.process = opts.process;
        this.log = this.fplus.debug.bound("dispatcher");
    }

    async init () { return this; }

    run () {
        const retick = rxx.jitterInterval(RETRY_INTERVAL, RETRY_JITTER).pipe(rx.startWith(null));

        for (const [klass, plugin] of this.registry) {
            this.cdb.watch_members(klass).pipe(
                rx.combineLatestWith(retick),
                rx.map(([members]) => members),
                rxx.retry_backoff(5000, e => this.log("Watch error for class %s: %s", klass, e)),
            ).subscribe({
                next:   members => this.check_members(members, plugin),
                error:  e => this.log("Watch failed permanently for class %s: %o", klass, e),
            });
        }
    }

    check_members (members, plugin) {
        for (const uuid of members) {
            this.state.is_done(uuid)
                .then(done => {
                    if (!done)
                        this.queue.push(uuid, () => this.process(uuid, plugin));
                })
                .catch(e => this.log("Error checking state for %s: %o", uuid, e));
        }
    }
}
