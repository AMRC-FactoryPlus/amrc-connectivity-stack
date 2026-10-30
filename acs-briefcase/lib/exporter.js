/*
 * ACS Briefcase exporter
 * Build, store and withdraw briefcases as datasets are published
 * Copyright 2026 University of Sheffield
 */

import crypto           from "node:crypto";
import fsp              from "node:fs/promises";

import * as imm         from "immutable";
import * as rx          from "rxjs";

import { App, Class }   from "./constants.js";
import { live_briefcase } from "./store.js";
import { defined }      from "./util.js";

/** Compare what is Published with what has been released.
 *
 * A Published dataset with no live briefcase needs one built. A live
 * briefcase whose dataset is no longer Published needs withdrawing.
 *
 * @param published An immutable Set of Published dataset UUIDs.
 * @param releases An immutable Map from dataset UUID to its Briefcase
 * release entry.
 * @returns An immutable Map holding the Sets `build` and `withdraw`.
 */
export function plan (published, releases) {
    const live = releases
        .filter(r => live_briefcase(r))
        .keySeq().toSet();

    return imm.Map({
        build:      published.subtract(live),
        withdraw:   live.subtract(published),
    });
}

export class Exporter {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.fplus.debug.bound("exporter");
        this.builder = opts.builder;
        this.store = opts.store;
        this.exporter = opts.exporter;
        this.retry = opts.retry ?? 5 * 60 * 1000;
        this.now = opts.now ?? Date.now;
        this.schedule = opts.schedule ?? setTimeout;

        this.plan = null;
        /* Failed builds: the UUID to build each dataset under next
         * time, and when the attempt failed. A UUID is only reused
         * until it is recorded. */
        this.failed = new Map();
        /* Datasets built or withdrawn that the plan doesn't show yet,
         * because the change hasn't come back from ConfigDB. Without
         * these, a dataset could be built twice. */
        this.built = new Set();
        this.withdrawn = new Set();

        this.running = false;
        this.again = false;
    }

    /** A sequence of plans, emitted each time the work to do changes.
     * Nothing is emitted until both the Published class and the
     * Briefcase release entries can be read. */
    plans () {
        return rx.combineLatest([
            this.cdb.watch_members(Class.Published),
            this.cdb.search_app(App.BriefcaseRelease),
        ]).pipe(
            rx.map(([published, releases]) => plan(published, releases)),
            rx.distinctUntilChanged(imm.is));
    }

    /** Take a new plan. Work done that the plan now shows needs no
     * more remembering. */
    update (plan) {
        this.plan = plan;
        for (const ds of this.built)
            if (!plan.get("build").has(ds)) this.built.delete(ds);
        for (const ds of this.withdrawn)
            if (!plan.get("withdraw").has(ds)) this.withdrawn.delete(ds);
    }

    /** Build, store and record a briefcase of a dataset. A failure is
     * logged and retried later. */
    async build (dataset) {
        const uuid = this.failed.get(dataset)?.uuid ?? crypto.randomUUID();
        let zip;
        try {
            const entry = await this.store.release(dataset);
            if (live_briefcase(entry)) {
                this.built.add(dataset);
                return;
            }
            const replaces = entry?.briefcases?.at(-1)?.uuid;

            this.log("Building briefcase %s of %s", uuid, dataset);
            zip = await this.builder.build(dataset, { briefcase: uuid, replaces });
            const file = await this.store.upload(zip.file);
            await this.store.record(dataset, defined({
                uuid, file, replaces,
                sha256:     zip.sha256,
                size:       zip.size,
                built:      zip.built,
                exporter:   this.exporter,
            }));

            this.failed.delete(dataset);
            this.built.add(dataset);
            this.log("Released briefcase %s of %s", uuid, dataset);
        }
        catch (e) {
            this.failed.set(dataset, { uuid, at: this.now() });
            this.log("Can't build briefcase %s of %s, retrying in %ds: %s",
                uuid, dataset, this.retry / 1000, e.message ?? e);
            this.schedule(() => this.poke(), this.retry);
        }
        finally {
            if (zip) await fsp.rm(zip.file, { force: true });
        }
    }

    /** Withdraw a dataset's live briefcase. A failure is logged and
     * retried later. */
    async withdraw (dataset) {
        try {
            const at = new Date(this.now()).toISOString();
            const uuid = await this.store.withdraw(dataset, at);
            this.withdrawn.add(dataset);
            if (uuid) this.log("Withdrew briefcase %s of %s", uuid, dataset);
        }
        catch (e) {
            this.log("Can't withdraw the briefcase of %s, retrying in %ds: %s",
                dataset, this.retry / 1000, e.message ?? e);
            this.schedule(() => this.poke(), this.retry);
        }
    }

    /** Do the work in the current plan, one dataset at a time.
     * Withdrawals come first, as they are quick. */
    async pass () {
        const p = this.plan;
        if (!p) return;

        for (const ds of p.get("withdraw"))
            if (!this.withdrawn.has(ds))
                await this.withdraw(ds);

        for (const ds of p.get("build")) {
            if (this.built.has(ds)) continue;
            const failed = this.failed.get(ds);
            if (failed && this.now() - failed.at < this.retry) continue;
            await this.build(ds);
        }
    }

    /** Start a pass, or another one after the pass already running. */
    poke () {
        if (this.running) {
            this.again = true;
            return;
        }
        this.running = true;
        this.pass()
            .catch(e => this.log("Pass failed: %s", e))
            .finally(() => {
                this.running = false;
                if (this.again) {
                    this.again = false;
                    this.poke();
                }
            });
    }

    run () {
        this.log("Watching the Published class");
        this.plans().subscribe(p => {
            this.update(p);
            this.poke();
        });
    }
}
