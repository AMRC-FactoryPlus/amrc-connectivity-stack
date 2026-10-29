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

    run () {
        this.log("Watching the Published class");

        /* Nothing is built or withdrawn yet: this only reports the
         * work it finds. */
        this.plans().subscribe(p => {
            const list = s => s.isEmpty() ? "none" : s.join(", ");
            this.log("To build: %s", list(p.get("build")));
            this.log("To withdraw: %s", list(p.get("withdraw")));
        });
    }
}
