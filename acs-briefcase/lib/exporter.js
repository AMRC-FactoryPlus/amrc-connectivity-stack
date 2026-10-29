/*
 * ACS Briefcase exporter
 * Work out which datasets to build or withdraw
 * Copyright 2026 University of Sheffield
 */

import * as imm from "immutable";
import * as rx  from "rxjs";

import { App, Class } from "./constants.js";

/** Compare what is Published with what has been released.
 *
 * A Published dataset with no live release needs a briefcase built. A
 * live release whose dataset is no longer Published needs withdrawing.
 * A release stays live until its entry records a withdrawal.
 *
 * @param published An immutable Set of Published dataset UUIDs.
 * @param releases An immutable Map from dataset UUID to its Briefcase
 * release entry.
 * @returns An immutable Map holding the Sets `build` and `withdraw`.
 */
export function plan (published, releases) {
    const live = releases
        .filter(r => r?.withdrawn == null)
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

    /* Build one briefcase. A failure is logged and does not stop the
     * builds after it. */
    async build (dataset) {
        this.log("Building a briefcase of %s", dataset);
        try {
            const b = await this.builder.build(dataset);
            this.log("Built %s: %s, sha256 %s", dataset, b.file, b.sha256);
            return b;
        }
        catch (e) {
            this.log("Can't build a briefcase of %s: %s", dataset, e.message ?? e);
            return null;
        }
    }

    /** A sequence of builds: each dataset that needs a briefcase,
     * built one at a time. Nothing records the briefcases yet, so a
     * dataset is built only once while the process runs. */
    builds (plans) {
        return plans.pipe(
            rx.mergeMap(p => p.get("build")),
            rx.distinct(),
            rx.concatMap(ds => this.build(ds)));
    }

    run () {
        this.log("Watching the Published class");

        const plans = this.plans().pipe(rx.share());

        /* Nothing is withdrawn yet: this only reports it. */
        plans.subscribe(p => {
            const withdraw = p.get("withdraw");
            if (!withdraw.isEmpty())
                this.log("To withdraw: %s", withdraw.join(", "));
        });
        this.builds(plans).subscribe();
    }
}
