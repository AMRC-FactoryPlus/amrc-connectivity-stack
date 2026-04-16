/*
 * ACS MES Collation
 * Data model / business logic
 */

import * as imm from "immutable";
import * as rx from "rxjs";

import { App } from "./constants.js";

export default class Model {
    constructor (opts) {
        this.auth = opts.auth;
        this.fplus = opts.fplus;
        this.log = opts.fplus.debug.bound("model");

        /* Observable of model updates for notify subscribers */
        this.updates = new rx.Subject();

        /* Current set of MES device UUIDs (immutable Set) */
        this.mes_devices = imm.Set();
    }

    async init () {
        const cdb = this.fplus.ConfigDB;

        this.log("Watching MES identifiers application %s", App.MESIdentifiers);

        cdb.watch_list(App.MESIdentifiers).subscribe({
            next: uuids => {
                this.mes_devices = uuids;
                this.log("MES devices updated (%s total):", uuids.size);
                for (const uuid of uuids)
                    this.log("  %s", uuid);
                this.updates.next({ type: "mes_devices", uuids });
            },
            error: e => this.log("Error watching MES identifiers: %s", e),
        });

        return this;
    }
}
