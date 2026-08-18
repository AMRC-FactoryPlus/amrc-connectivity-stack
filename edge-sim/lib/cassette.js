/*
 * ACS simulator driver
 * Cassette validation and loading.
 * Copyright 2026 University of Sheffield AMRC
 */

import fsp from "fs/promises";
import path from "path";

import * as UUIDs from "./uuids.js";

/* Validate a parsed cassette document. Returns the cassette with
 * derived fields filled in, or throws with a useful message. See
 * docs/cassette-format.md for the format definition. */
export function validateCassette (doc) {
    if (typeof doc != "object" || doc == null)
        throw new Error("Cassette is not an object");

    const meta = doc.cassette;
    if (typeof meta != "object" || meta == null)
        throw new Error("Cassette has no 'cassette' metadata block");
    if (meta.version != 1)
        throw new Error(`Unsupported cassette version: ${meta.version}`);
    if (typeof meta.name != "string" || !meta.name.length)
        throw new Error("Cassette has no name");

    if (!Array.isArray(doc.channels) || !doc.channels.length)
        throw new Error("Cassette has no channels");
    const byId = new Map();
    const byPath = new Map();
    for (const ch of doc.channels) {
        if (!Number.isInteger(ch.id))
            throw new Error(`Channel id is not an integer: ${ch.id}`);
        if (typeof ch.path != "string" || !ch.path.length)
            throw new Error(`Channel ${ch.id} has no path`);
        if (byId.has(ch.id))
            throw new Error(`Duplicate channel id: ${ch.id}`);
        if (byPath.has(ch.path))
            throw new Error(`Duplicate channel path: ${ch.path}`);
        byId.set(ch.id, ch);
        byPath.set(ch.path, ch);
    }

    if (!Array.isArray(doc.samples))
        throw new Error("Cassette has no samples");
    let last = -1;
    for (const s of doc.samples) {
        if (!Array.isArray(s) || s.length != 3)
            throw new Error(`Bad sample (want [offset_ms, channel, value]): ${JSON.stringify(s)}`);
        const [off, ch] = s;
        if (!Number.isFinite(off) || off < 0)
            throw new Error(`Bad sample offset: ${off}`);
        if (off < last)
            throw new Error(`Samples not sorted by offset at ${off}`);
        if (!byId.has(ch))
            throw new Error(`Sample references unknown channel: ${ch}`);
        last = off;
    }

    const duration = meta.duration_ms ?? last;
    if (duration < last)
        throw new Error(`duration_ms (${duration}) is before the last sample (${last})`);

    return {
        ...doc,
        cassette:   { ...meta, duration_ms: duration },
        byId, byPath,
    };
}

/* Resolves a cassette UUID to a validated cassette. The source of
 * record is the ConfigDB (App.Cassette entry for the object), fetched
 * over HTTP from CONFIGDB_URL with CONFIGDB_TOKEN as a bearer token.
 * Cassette switching by command is the point of this driver, so there
 * is deliberately no inline-config route. Drivers have no Factory+
 * service identity today, so the token (or a trusted in-cluster
 * route) must be provided externally; this is the documented gap in
 * the driver identity story.
 *
 * CASSETTE_DIR (file <uuid>.json) is a development-only shortcut for
 * running the driver without a cluster; it is checked first when set.
 */
export class CassetteStore {
    constructor (opts) {
        this.env = opts.env ?? process.env;
        this.log = opts.log ?? (() => {});
    }

    async fetch (uuid) {
        if (!/^[0-9a-f]{8}-[0-9a-f-]{27}[0-9a-f]$/i.test(uuid))
            throw new Error(`Not a cassette UUID: ${uuid}`);

        const dir = this.env.CASSETTE_DIR;
        if (dir) {
            const file = path.join(dir, `${uuid}.json`);
            const json = await fsp.readFile(file, "utf-8")
                .catch(() => null);
            if (json != null) {
                this.log("Cassette %s from %s", uuid, file);
                return validateCassette(JSON.parse(json));
            }
        }

        const cdb = this.env.CONFIGDB_URL;
        if (cdb) {
            const url = `${cdb.replace(/\/$/, "")}/v1/app/${UUIDs.App.Cassette}/object/${uuid}`;
            const headers = {};
            if (this.env.CONFIGDB_TOKEN)
                headers.Authorization = `Bearer ${this.env.CONFIGDB_TOKEN}`;
            const rsp = await fetch(url, { headers });
            if (rsp.status == 404)
                throw new Error(`Cassette ${uuid} not found in ConfigDB`);
            if (!rsp.ok)
                throw new Error(`ConfigDB fetch for ${uuid} failed: ${rsp.status}`);
            this.log("Cassette %s from ConfigDB", uuid);
            return validateCassette(await rsp.json());
        }

        throw new Error(`No source for cassette ${uuid}: CONFIGDB_URL (or dev CASSETTE_DIR) unset`);
    }
}
