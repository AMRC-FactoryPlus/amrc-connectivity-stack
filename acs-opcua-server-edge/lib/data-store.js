/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - Data Store
 *
 * In-memory store for tag values with periodic flush to a persistent
 * JSON file so values survive pod restarts.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

export class DataStore extends EventEmitter {
    constructor(opts) {
        super();
        this.dataDir = opts.dataDir;
        this.cacheFile = path.join(this.dataDir, "last-values.json");
        this.flushInterval = opts.flushInterval ?? 5000;

        this.values = new Map();
        this.dirty = false;
        this.timer = null;
    }

    load() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const data = JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
                for (const [topic, entry] of Object.entries(data)) {
                    this.values.set(topic, entry);
                }
                console.log(`Loaded ${this.values.size} cached values from ${this.cacheFile}`);
            }
        }
        catch (err) {
            console.error(`Error loading cache file: ${err.message}`);
        }
    }

    start() {
        this.load();
        this.timer = setInterval(() => this.flush(), this.flushInterval);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.flush();
    }

    set(topic, value, timestamp) {
        const entry = {
            value,
            timestamp: timestamp ?? new Date().toISOString(),
        };
        this.values.set(topic, entry);
        this.dirty = true;
        this.emit("change", topic, entry);
    }

    get(topic) {
        const entry = this.values.get(topic);
        return entry ?? null;
    }

    flush() {
        if (!this.dirty) return;

        try {
            const data = Object.fromEntries(this.values);
            const tmp = this.cacheFile + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
            fs.renameSync(tmp, this.cacheFile);
            this.dirty = false;
        }
        catch (err) {
            console.error(`Error flushing cache: ${err.message}`);
        }
    }
}
