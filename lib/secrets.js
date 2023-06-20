/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Sealed secret handling
 * Copyright 2023 AMRC
 */

import { Debug } from "@amrc-factoryplus/utilities";

import { Checkout }             from "./checkout.js";
import { write_sealed_secret }  from "./kubeseal.js";
import { Edge }                 from "./uuids.js";

const debug = new Debug();

export class SealedSecrets {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.cert_dir   = opts.cert_dir;

        this.log = debug.log.bind(debug, "edge");
    }

    async seal_secret (opts) {
        const info = await this.fplus.ConfigDB
            .get_config(Edge.App.Cluster, opts.cluster);
        if (!info) return 404;

        const x509 = info.kubeseal_cert;
        if (!x509) return 503;

        const co = await Checkout.clone({ fplus: this.fplus, url: info.flux });
        await write_sealed_secret({
            ...opts, x509, 
            tmpdir:     this.cert_dir,
            checkout:   co,
            log:        this.log,
        });
        await (opts.dryrun ? co.dispose() : co.push());

        return 204;
    }

    async delete_secret (opts) {
        const info = await this.fplus.ConfigDB
            .get_config(Edge.App.Cluster, opts.cluster);
        if (!info) return 404;

        const { namespace, name, key } = opts;
        const mf = [namespace, "SealedSecret", name];
        const co = await Checkout.clone({ fplus: this.fplus, url: info.flux });
        const obj = await co.read_manifest(...mf);
        if (obj) {
            const enc = obj.spec.encryptedData;
            delete enc[key];
            if (Object.keys(enc).length == 0)
                await co.unlink_manifest(...mf);
            else
                await co.write_manifest(obj);
            if (opts.dryrun)
                await co.dispose();
            else
                await co.push("Remove sealed secret %s/%s/%s.",
                    namespace, name, key);
        }

        return 204;
    }

}
