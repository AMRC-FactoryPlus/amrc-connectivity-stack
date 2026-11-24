/*
 * ACS service setup
 * Edge Scout fixups: strip the old scout key, sweep orphaned snapshots
 * Copyright 2026 University of Sheffield
 *
 * Two repairs, run on every upgrade:
 *
 *  - The old Edge Scout design stored a `scout` key on connections in
 *    Edge Agent config entries. The Admin UI keeps unknown keys when it
 *    updates an entry, so the dead key would otherwise stay forever.
 *    This removes it.
 *
 *  - The Edge Agent stores each scan's snapshot in the Files service,
 *    in a File object of class Edge.Class.ScoutResult, and deletes a
 *    snapshot when it drops out of a connection's `current` and
 *    `previous`. An agent that stops at the wrong moment, or a deleted
 *    connection, leaves objects nothing points at. This deletes them.
 *
 * ConfigDB keeps no creation time for an object, so "more than a day
 * old" is judged from what we do have. An object is kept when
 *
 *  - a status entry names it as `current.file` or `previous.file`, or
 *  - a status entry names it as `scan` and is queued or running, or
 *    was updated less than a day ago, or
 *  - its Files upload record says it was uploaded less than a day ago.
 *
 * The agent records a scan's id, which is its File object's UUID, in
 * the status entry before it creates the object, so a scan in progress
 * is always kept.
 *
 * Each object is deleted from the Files service first, because the
 * Files permission check needs the object to exist, and then from the
 * ConfigDB. If the Files service refuses or is not there, the object
 * stays for the next run.
 *
 * Nothing here may stop service-setup: a failure is logged as an ERROR
 * and the step goes on.
 */

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { Edge, Files } from "./uuids.js";

const ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function fixup_edge_scout (fplus) {
    await new EdgeScoutFixup({ fplus }).run();
}

export class EdgeScoutFixup {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.log ?? opts.fplus.debug.bound("edge-scout");
        this.now = opts.now ?? (() => Date.now());
    }

    async run () {
        const stripped = await this.strip_agent_configs()
            .catch(e => {
                this.log("ERROR: can't strip old scout keys: %s", e);
                return [];
            });
        const swept = await this.sweep_results()
            .catch(e => {
                this.log("ERROR: can't sweep orphaned scout snapshots: %s", e);
                return { deleted: [], kept: [], failed: [] };
            });
        return { stripped, ...swept };
    }

    /* Remove `scout` from every connection in every Edge Agent config.
     * Returns the agents whose config changed. */
    async strip_agent_configs () {
        const app = UUIDs.App.EdgeAgentConfig;
        const agents = await this.cdb.get_all_configs(app);

        const changed = [];
        for (const [agent, config] of agents) {
            if (!has_scout(config)) continue;
            try {
                if (await this.rewrite(app, agent, strip_scout)) {
                    this.log("Removed old scout settings from Edge Agent %s", agent);
                    changed.push(agent);
                }
            }
            catch (e) {
                this.log("ERROR: can't remove old scout settings from Edge Agent %s: %s",
                    agent, e);
            }
        }
        return changed;
    }

    /* Read, change and write a config with If-Match, rebuilding if
     * someone else saved it first. `change` returns the new config,
     * or undefined to leave it. */
    async rewrite (app, obj, change) {
        for (let i = 1; ; i++) {
            const [config, etag] = await this.cdb.get_config_with_etag(app, obj);
            const next = change(config);
            if (next === undefined) return false;
            try {
                await this.cdb.put_config(app, obj, next, etag ? { etag } : undefined);
                return true;
            }
            catch (e) {
                const stale = e instanceof ServiceError && e.status == 412;
                if (!stale || i >= ATTEMPTS) throw e;
                this.log("Config %s of %s changed under us; rebuilding", app, obj);
            }
        }
    }

    /* Delete ScoutResult objects that no status entry needs. */
    async sweep_results () {
        const { cdb } = this;

        /* A missing class means a site that has never loaded the
         * dumps for this release, so there is nothing to sweep. */
        const objects = await cdb.class_members(Edge.Class.ScoutResult)
            .catch(ServiceError.check(404));
        if (!objects?.length)
            return { deleted: [], kept: [], failed: [] };

        /* Only a missing app may read as "no entries". Any other
         * failure must stop the sweep, or every snapshot would look
         * unreferenced. */
        const statuses = await cdb.get_all_configs(Edge.App.ScoutStatus)
            .catch(ServiceError.check(404)) ?? new Map();

        const keep = this.referenced(statuses);
        const deleted = [], kept = [], failed = [];

        for (const obj of objects) {
            if (keep.has(obj) || await this.uploaded_recently(obj)) {
                kept.push(obj);
                continue;
            }
            if (await this.delete_result(obj))
                deleted.push(obj);
            else
                failed.push(obj);
        }

        if (deleted.length)
            this.log("Deleted %d orphaned scout snapshots", deleted.length);
        return { deleted, kept, failed };
    }

    /* The objects the status entries still need. */
    referenced (statuses) {
        const now = this.now();
        const keep = new Set();
        for (const status of statuses.values()) {
            for (const ref of [status?.current, status?.previous])
                if (ref?.file) keep.add(ref.file);

            if (!status?.scan) continue;
            const live = status.state == "queued" || status.state == "running";
            const updated = Date.parse(status.updated);
            const recent = Number.isFinite(updated) && now - updated < DAY_MS;
            if (live || recent) keep.add(status.scan);
        }
        return keep;
    }

    /* Was this object's content uploaded less than a day ago? An object
     * with no upload record has no content, and nothing to date it by
     * beyond its status entry. */
    async uploaded_recently (obj) {
        const record = await this.cdb.get_config(Files.App.Config, obj)
            .catch(e => {
                this.log("ERROR: can't read the upload record of %s: %s", obj, e);
                return { date_uploaded: new Date(this.now()).toISOString() };
            });
        const uploaded = Date.parse(record?.date_uploaded);
        return Number.isFinite(uploaded) && this.now() - uploaded < DAY_MS;
    }

    /* Delete one snapshot, from Files and then from the ConfigDB.
     * Returns true when both are gone. */
    async delete_result (obj) {
        try {
            const res = await this.fplus.Fetch.fetch({
                service:    Files.Service.Files,
                method:     "DELETE",
                url:        `/v1/file/${obj}`,
            });
            if (res.status != 204) {
                this.log("ERROR: the Files service answered %s to deleting scout snapshot %s, "
                    + "so it stays until the next run", res.status, obj);
                return false;
            }
            await this.cdb.delete_object(obj);
            this.log("Deleted orphaned scout snapshot %s", obj);
            return true;
        }
        catch (e) {
            this.log("ERROR: can't delete scout snapshot %s: %s", obj, e);
            return false;
        }
    }
}

function has_scout (config) {
    return config?.deviceConnections?.some?.(c => c && "scout" in c) ?? false;
}

function strip_scout (config) {
    if (!has_scout(config)) return undefined;
    return {
        ...config,
        deviceConnections: config.deviceConnections.map(c => {
            if (!c || !("scout" in c)) return c;
            const rest = { ...c };
            delete rest.scout;
            return rest;
        }),
    };
}
