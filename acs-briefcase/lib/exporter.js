/*
 * ACS Briefcase exporter
 * Build, store, deliver and withdraw briefcases as datasets are published
 * Copyright 2026 University of Sheffield
 */

import crypto           from "node:crypto";
import fsp              from "node:fs/promises";

import * as imm         from "immutable";
import * as rx          from "rxjs";

import { App, Class }   from "./constants.js";
import { live_briefcase } from "./store.js";
import { defined, watch_members } from "./util.js";

/* The tier that is not delivered: nothing outside Factory+ can serve
 * it until there are enclaves. */
const HELD_TIER = "enclave-only";

/* Does the sharing platform still need telling that this briefcase
 * was withdrawn? Only a briefcase it has been sent. */
function needs_notice (briefcase) {
    return briefcase.withdrawn && briefcase.pushed
        && !briefcase.withdrawal_pushed;
}

/** Compare what is Published with what has been released.
 *
 * A Published dataset with no live briefcase needs one built. A live
 * briefcase whose dataset is no longer Published needs withdrawing.
 *
 * With delivery on, a live briefcase that has not been pushed to the
 * sharing platform needs pushing, unless its tier is held back. A
 * briefcase with no tier recorded is included: its tier is found when
 * the work is done. A withdrawn briefcase that was pushed needs a
 * withdrawal notice sending.
 *
 * @param published An immutable Set of Published dataset UUIDs.
 * @param releases An immutable Map from dataset UUID to its Briefcase
 * release entry.
 * @param opts.deliver Whether briefcases are delivered.
 * @returns An immutable Map holding the Sets `build`, `withdraw`,
 * `push` and `notify`.
 */
export function plan (published, releases, opts = {}) {
    const keys = pred => releases.filter(pred).keySeq().toSet();
    const live = keys(r => live_briefcase(r));

    const push = keys(r => {
        const b = live_briefcase(r);
        return b && !b.pushed && b.tier !== HELD_TIER;
    });
    const notify = keys(r => r.briefcases?.some(needs_notice));

    return imm.Map({
        build:      published.subtract(live),
        withdraw:   live.subtract(published),
        push:       opts.deliver ? push.intersect(published) : imm.Set(),
        notify:     opts.deliver ? notify : imm.Set(),
    });
}

export class Exporter {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.fplus.debug.bound("exporter");
        this.builder = opts.builder;
        this.store = opts.store;
        /* Delivery to the sharing platform. Without it, briefcases
         * stay in the Files service. */
        this.delivery = opts.delivery;
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
        this.pushed = new Set();
        this.notified = new Set();
        /* When the last push or notice for each dataset failed. */
        this.push_failed = new Map();
        this.notify_failed = new Map();

        this.running = false;
        this.again = false;
    }

    /** A sequence of plans, emitted each time the work to do changes.
     * Nothing is emitted until both the Published class and the
     * Briefcase release entries can be read. */
    plans () {
        return rx.combineLatest([
            watch_members({
                cdb: this.cdb, klass: Class.Published,
                log: this.log, delay: this.retry,
            }),
            this.cdb.search_app(App.BriefcaseRelease),
        ]).pipe(
            rx.map(([published, releases]) => plan(published, releases,
                { deliver: !!this.delivery })),
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
        for (const ds of this.pushed)
            if (!plan.get("push").has(ds)) this.pushed.delete(ds);
        for (const ds of this.notified)
            if (!plan.get("notify").has(ds)) this.notified.delete(ds);
    }

    /* Is it too soon to try again after a failure? */
    too_soon (failed, dataset) {
        const at = failed.get(dataset);
        return at != null && this.now() - at < this.retry;
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
                tier:       zip.tier,
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

    /** Deliver a dataset's live briefcase to the sharing platform and
     * record when. A failure is logged and retried later. */
    async push (dataset) {
        try {
            const live = live_briefcase(await this.store.release(dataset));
            if (!live || live.pushed) {
                this.pushed.add(dataset);
                return;
            }

            let tier = live.tier;
            if (!tier) {
                tier = await this.delivery.tier(live);
                await this.store.mark(dataset, live.uuid, { tier });
            }
            if (tier === HELD_TIER) {
                this.pushed.add(dataset);
                this.log("Not delivering briefcase %s of %s: its tier is %s",
                    live.uuid, dataset, tier);
                return;
            }

            await this.delivery.release(dataset, live);
            const at = new Date(this.now()).toISOString();
            await this.store.mark(dataset, live.uuid, { pushed: at });

            this.push_failed.delete(dataset);
            this.pushed.add(dataset);
            this.log("Delivered briefcase %s of %s", live.uuid, dataset);
        }
        catch (e) {
            this.push_failed.set(dataset, this.now());
            this.log("Can't deliver the briefcase of %s, retrying in %ds: %s",
                dataset, this.retry / 1000, e.message ?? e);
            this.schedule(() => this.poke(), this.retry);
        }
    }

    /** Tell the sharing platform of each withdrawn briefcase of a
     * dataset that it holds, and record when. A failure is logged and
     * retried later. */
    async notify (dataset) {
        try {
            const entry = await this.store.release(dataset);
            for (const b of entry?.briefcases ?? []) {
                if (!needs_notice(b)) continue;
                await this.delivery.withdraw(dataset, b);
                const at = new Date(this.now()).toISOString();
                await this.store.mark(dataset, b.uuid, { withdrawal_pushed: at });
                this.log("Sent the withdrawal of briefcase %s of %s",
                    b.uuid, dataset);
            }
            this.notify_failed.delete(dataset);
            this.notified.add(dataset);
        }
        catch (e) {
            this.notify_failed.set(dataset, this.now());
            this.log("Can't send the withdrawal for %s, retrying in %ds: %s",
                dataset, this.retry / 1000, e.message ?? e);
            this.schedule(() => this.poke(), this.retry);
        }
    }

    /** Do the work in the current plan, one dataset at a time.
     * Withdrawals and their notices come first, as they are quick and
     * stop downloads. */
    async pass () {
        const p = this.plan;
        if (!p) return;

        for (const ds of p.get("withdraw"))
            if (!this.withdrawn.has(ds))
                await this.withdraw(ds);

        for (const ds of p.get("notify"))
            if (!this.notified.has(ds) && !this.too_soon(this.notify_failed, ds))
                await this.notify(ds);

        for (const ds of p.get("build")) {
            if (this.built.has(ds)) continue;
            const failed = this.failed.get(ds);
            if (failed && this.now() - failed.at < this.retry) continue;
            await this.build(ds);
        }

        for (const ds of p.get("push"))
            if (!this.pushed.has(ds) && !this.too_soon(this.push_failed, ds))
                await this.push(ds);
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
