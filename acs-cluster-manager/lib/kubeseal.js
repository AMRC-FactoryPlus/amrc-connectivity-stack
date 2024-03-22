/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Kubeseal interaction
 * Copyright 2023 AMRC
 */

import child_process from "child_process";
import fs_p from "fs/promises";

import concat_stream from "concat-stream";
import tmpfile from "tmp-promise";

import * as manifests from "./manifests.js";

export async function write_sealed_secret (opts) {
    const { checkout: co, namespace, name, key } = opts;

    const sealed = await run_kubeseal(opts);
    opts.log("Got sealed data: %s", sealed);

    const obj = await co.read_manifest(namespace, "SealedSecret", name) ??
        manifests.sealed_secret(namespace, name);
    obj.spec.encryptedData[key] = sealed;
    await co.write_manifest(obj);
    await co.commit("Updated sealed secret %s/%s/%s.", 
        namespace, name, key);
}

export function run_kubeseal (opts) {
    return tmpfile.withFile(async ({ path: cert }) => {
        await fs_p.writeFile(cert, opts.x509);

        const sealed = await new Promise(resolve => {
            const kid = child_process.spawn("/usr/local/bin/kubeseal", [
                "--cert", cert,
                "--namespace", opts.namespace,
                "--name", opts.name,
                "--raw"]);
            opts.content.pipe(kid.stdin);
            kid.stderr.pipe(concat_stream(
                { encoding: "string" }, 
                err => err && opts.log("Kubeseal error: %s", err)));
            kid.stdout.pipe(concat_stream({ encoding: "string" }, resolve));
        });

        return sealed;
    }, { tmpdir: opts.tmpdir, prefix: "cert-" });
};
