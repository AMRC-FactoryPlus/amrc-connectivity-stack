/*
 * ACS File Summariser
 * Per-file processing: download, summarise, write, mark done
 * Copyright 2026 University of Sheffield
 */

import fs   from "node:fs/promises";
import path from "node:path";

import { App } from "./constants.js";

export class Job {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.state = opts.state;
        this.influx = opts.influx;
        this.scratch_dir = opts.scratch_dir;
        this.log = this.fplus.debug.bound("job");
    }

    async init () { return this; }

    /* Download, summarise and write points for one file. `plugin` is the
     * summariser module registered for this file's class. */
    async run (file_uuid, plugin) {
        this.log("Processing %s", file_uuid);

        const scratch_path = path.join(this.scratch_dir, `${file_uuid}.tmp`);

        try {
            const config = await this.fplus.ConfigDB.get_config(App.Summary, file_uuid);

            await this.fplus.Files.save_file(file_uuid, scratch_path);

            let count = 0;
            for await (const row of plugin.summarise(scratch_path, config)) {
                this.influx.write({
                    ...row,
                    tags: { ...row.tags, file: file_uuid },
                });
                count++;
            }
            await this.influx.flush();

            await this.state.mark_done(file_uuid);
            this.log("Finished %s (%d points)", file_uuid, count);
        } catch (e) {
            this.log("Failed to summarise %s: %s", file_uuid, e);
            await this.state.mark_error(file_uuid, e).catch(() => {});
            throw e;
        } finally {
            await fs.rm(scratch_path, { force: true });
        }
    }
}
