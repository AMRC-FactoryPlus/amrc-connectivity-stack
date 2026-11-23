/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Sealed secret handling
 * Copyright 2023 AMRC
 */

import { Checkout }             from "./checkout.js";
import { run_kubeseal }         from "./kubeseal.js";
import * as manifests           from "./manifests.js";
import { Edge }                 from "./uuids.js";

/* Put a sealed value under a key in a list of SealedSecret manifests
 * read from the cluster repo, creating the manifest if there is none.
 * With opts.create_only the key must not exist already: we return
 * false and change nothing if it does. */
export function set_sealed_key (sss, opts, sealed) {
    if (sss.length == 0)
        sss[0] = manifests.sealed_secret(opts.namespace, opts.name);
    const enc = sss[0].spec.encryptedData ??= {};
    if (opts.create_only && Object.hasOwn(enc, opts.key))
        return false;
    enc[opts.key] = sealed;
    return true;
}

/* This needs reworking. The repo URLs are now by-uuid and the
 * certificate is in a different App. */
export class SealedSecrets {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.cert_dir   = opts.cert_dir;

        this.log = this.fplus.debug.bound("edge");
    }

    async seal_secret (opts) {
        const info = await this.fplus.ConfigDB
            .get_config(Edge.App.EdgeStatus, opts.cluster);
        if (!info) return 404;

        const x509 = info.kubeseal_cert;
        if (!x509) return 503;

        const sealed = await run_kubeseal({
            ...opts, x509,
            tmpdir:     this.cert_dir,
            log:        this.log,
        });

        const co = await Checkout.clone({
            fplus:  this.fplus,
            uuid:   opts.cluster,
        });
        const dir = await co.mkdir("edo", "secrets", opts.namespace);
        const file = `${opts.name}.yaml`;
        const sss = await co.read_manifests(dir, file);
        if (!set_sealed_key(sss, opts, sealed)) {
            this.log("Refusing to replace sealed secret %s/%s/%s",
                opts.namespace, opts.name, opts.key);
            await co.dispose();
            return 403;
        }
        await co.write_manifests(dir, file, sss);
        await co.commit("Updated sealed secret %s/%s/%s",
            opts.namespace, opts.name, opts.key);

        await (opts.dryrun ? co.dispose() : co.push());

        return 204;
    }

    async delete_secret (opts) {
        const info = await this.fplus.ConfigDB
            .get_config(Edge.App.EdgeStatus, opts.cluster);
        if (!info) return 404;

        const co = await Checkout.clone({
            fplus:  this.fplus,
            uuid:   opts.cluster,
        });
        const dir = await co.mkdir("edo", "secrets", opts.namespace);
        const file = `${opts.name}.yaml`;
        const sss = await co.read_manifests(dir, file);
        if (sss.length) {
            const enc = sss[0].spec.encryptedData;
            delete enc[opts.key];
            if (Object.keys(enc).length == 0)
                await co.unlink_file(dir, file);
            else
                await co.write_manifests(dir, file, sss);
            if (opts.dryrun)
                await co.dispose();
            else
                await co.push("Remove sealed secret %s/%s/%s.",
                    opts.namespace, opts.name, opts.key);
        }

        return 204;
    }

}
