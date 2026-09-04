/*
 * ACS File Summariser
 * Per-file processing state, held in ConfigDB
 * Copyright 2026 University of Sheffield
 */

import { App } from "./constants.js";

export class State {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
    }

    async init () { return this; }

    async get (file_uuid) {
        return this.cdb.get_config(App.SummaryState, file_uuid);
    }

    async is_done (file_uuid) {
        const state = await this.get(file_uuid);
        return state?.status === "done";
    }

    async mark_done (file_uuid) {
        await this.cdb.put_config(App.SummaryState, file_uuid, {
            status:     "done",
            updated_at: new Date().toISOString(),
        });
    }

    async mark_error (file_uuid, error) {
        await this.cdb.put_config(App.SummaryState, file_uuid, {
            status:     "error",
            error:      error?.message ?? String(error),
            updated_at: new Date().toISOString(),
        });
    }
}
