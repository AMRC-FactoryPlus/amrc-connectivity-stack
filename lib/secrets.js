/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Sealed secret handling
 * Copyright 2023 AMRC
 */

import child_process from "child_process";
import fs_p from "fs/promises";

import concat_stream from "concat-stream";
import tmpfile from "tmp-promise";

import { Debug } from "@amrc-factoryplus/utilities";

import { Checkout }         from "./checkout.js";
import { Edge }             from "./uuids.js";

const debug = new Debug();

export class SealedSecrets {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cert_dir   = opts.cert_dir;

        this.log = debug.log.bind(debug, "edge");
    }

    async write_sealed_secret (co, x509, opts) {
        const { namespace, name, key } = opts;

        const sealed = await this.run_kubeseal(x509, opts);
        this.log("Got sealed data: %s", sealed);

        const obj = await co.read_manifest(namespace, "SealedSecret", name) ??
            manifests.sealed_secret(namespace, name);
        obj.spec.encryptedData[key] = sealed;
        await co.write_manifest(obj);
        await co.commit("Updated sealed secret %s/%s/%s.", 
            namespace, name, key);
    }

    async seal_secret (opts) {
        const info = await this.fplus.ConfigDB
            .get_config(Edge.App.Cluster, opts.cluster);
        if (!info) return 404;

        const x509 = info.kubeseal_cert;
        if (!x509) return 503;

        const co = await Checkout.clone({ fplus: this.fplus, url: info.flux });
        await this.write_sealed_secret(co, x509, opts);
        if (opts.dryrun)
            await co.dispose()
        else
            await co.push();

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

    run_kubeseal (x509, opts) {
        return tmpfile.withFile(async ({ path: cert }) => {
            await fs_p.writeFile(cert, x509);

            const sealed = await new Promise(resolve => {
                const kid = child_process.spawn("/usr/local/bin/kubeseal", [
                    "--cert", cert,
                    "--namespace", opts.namespace,
                    "--name", opts.name,
                    "--raw"]);
                opts.content.pipe(kid.stdin);
                kid.stderr.pipe(concat_stream(
                    { encoding: "string" }, 
                    err => err && this.log("Kubeseal error: %s", err)));
                kid.stdout.pipe(concat_stream({ encoding: "string" }, resolve));
            });

            return sealed;
        }, { tmpdir: this.cert_dir, prefix: "cert-" });
    };
}
