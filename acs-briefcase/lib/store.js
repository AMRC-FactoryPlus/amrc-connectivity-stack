/*
 * ACS Briefcase exporter
 * Keep briefcases in the Files service and record them in ConfigDB
 * Copyright 2026 University of Sheffield
 */

import { App, FileType } from "./constants.js";

/** The live briefcase in a Briefcase release entry: the last one, if
 * it has not been withdrawn. Null if there is none. */
export function live_briefcase (entry) {
    const last = entry?.briefcases?.at(-1);
    return last && !last.withdrawn ? last : null;
}

export class Store {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.files = opts.fplus.Files;
    }

    /** The dataset's Briefcase release entry, or undefined. */
    release (dataset) {
        return this.cdb.get_config(App.BriefcaseRelease, dataset);
    }

    /** Upload a zip to the Files service as a Briefcase file.
     * @returns The UUID of the new File object. */
    upload (file) {
        return this.files.upload_file(FileType.Briefcase, file);
    }

    /** Add a briefcase to the end of the dataset's record. */
    async record (dataset, briefcase) {
        const entry = await this.release(dataset);
        const briefcases = [...entry?.briefcases ?? [], briefcase];
        await this.cdb.put_config(App.BriefcaseRelease, dataset, { briefcases });
    }

    /** Mark the dataset's live briefcase as withdrawn.
     * @param at The time of the withdrawal, as an ISO 8601 string.
     * @returns The UUID of the briefcase withdrawn, or null if none
     * was live. */
    async withdraw (dataset, at) {
        const entry = await this.release(dataset);
        const live = live_briefcase(entry);
        if (!live) return null;

        live.withdrawn = at;
        await this.cdb.put_config(App.BriefcaseRelease, dataset, entry);
        return live.uuid;
    }
}
