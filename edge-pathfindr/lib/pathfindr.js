/*
 * ACS Pathfindr driver
 * Handler.
 * Copyright 2026 University of Sheffield AMRC
 */

import { BufferX } from "@amrc-factoryplus/edge-driver";

import { PathfindrAPI } from "./api.js";
import { parse_addr, select_value, resolve_id } from "./addr.js";

export class PathfindrHandler {
    constructor (driver, conf) {
        this.driver = driver;
        this.conf = conf;
        this.log = driver.debug.bound("pathfindr");

        this.api = new PathfindrAPI({ conf, log: this.log });
    }

    static create (driver, conf) {
        /* Reject an unusable config here rather than failing every poll.
         * The driver reports CONF and the Manager shows the connection as
         * misconfigured, which is the honest signal. */
        if (!conf?.baseURL || !conf?.clientId || !conf?.clientSecret)
            return;
        return new PathfindrHandler(driver, conf);
    }

    async connect () {
        return await this.api.login();
    }

    /* Must not use `this`: the driver library calls this unbound. */
    parseAddr (addr) {
        return parse_addr(addr);
    }

    async close () {
        this.api.close();
    }

    async poll (spec) {
        try {
            let body = await this.api.fetch(spec.req);

            /* Some data only exists on the single-asset endpoint, notably
             * beacon_info with its battery level. Getting there means
             * turning the operator's serial into Pathfindr's internal id
             * first, which the cached collection already knows. */
            if (spec.resolve) {
                const id = resolve_id(body, spec.resolve.ident);
                if (id === undefined) {
                    this.log("No asset with serial %s", spec.resolve.ident);
                    return;
                }
                const path = `${spec.resolve.path}/${id}`;
                body = await this.api.fetch({
                    key: path, path, query: {}, collection: false,
                });
            }

            const value = select_value(body, spec.select);

            if (value === undefined) {
                /* A serial that is not in the estate, or a field the asset
                 * does not carry. Not a connection fault. */
                this.log("No data for %s", spec.addr);
                return;
            }

            return BufferX.fromJSON(value);
        }
        catch (e) {
            return this.poll_failed(spec, e);
        }
    }

    poll_failed (spec, e) {
        switch (e?.kind) {
            case "auth":
                /* Credentials have stopped working. Report it so the Manager
                 * shows an auth failure rather than silent staleness. */
                this.log("Authentication failed for %s: %s", spec.addr, e.message);
                this.driver.connUnauth();
                return;
            case "conn":
                this.log("Connection failed for %s: %s", spec.addr, e.message);
                this.driver.connFailed();
                return;
            case "rate":
                /* Transient by definition. Skip this poll and let the Edge
                 * Agent ask again rather than tearing the connection down. */
                this.log("Rate limited on %s: %s", spec.addr, e.message);
                return;
            default:
                /* A 404 for one address must not take out the connection.
                 *
                 * 422 is worth calling out because it is routine rather than
                 * exceptional: the runtime endpoints answer
                 * `invalid_gps_tracker` for anything that is not a GPS
                 * tracker, so every plain BLE tag returns it. That is the
                 * service telling us the asset has no such data, not a
                 * fault. */
                this.log("Poll failed for %s: %s", spec.addr, e?.message ?? e);
                return;
        }
    }
}
