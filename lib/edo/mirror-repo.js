/* ACS service setup
 * EDO git repo mirroring
 * Copyright 2023 AMRC
 */

import FS from "fs/promises";
import fs from "fs";
import Path from "path";

import git from "isomorphic-git";
import http from "isomorphic-git/http/node/index.js";

export async function mirror_repo ({ ss, uuid, source, ref }) {
    const dir       = Path.join(ss.checkouts, uuid);
    const local     = ss.fplus.Git.remote({ uuid });
    const author    = { name: "ACS bootstrap", email: ss.email };

    log("Checking out %s", local.url);
    await FS.rm(dir, {recursive: true, force: true});
    await git.clone({
        fs, dir, http, ...local,
        remote:         "local",
        noCheckout:     true,
    });

    const ref_or_null = ref => git.resolveRef({fs, dir, ref})
        .catch(e => { 
            if (e instanceof git.Errors.NotFoundError)
                return null;
            throw e;
        });
    const acs = await ref_or_null("refs/remotes/local/acs");
    const main = await ref_or_null("refs/remotes/local/main");
    const reset_main = acs == main;

    log("Fetching %s @ %s", source, ref);
    await git.addRemote({ fs, dir, remote: "source", url: source });
    const mirror = await git.fetch({
        fs, dir, http,
        remote:         "source", 
        singleBranch:   true,
        ref,
    });
    const sha1 = mirror.fetchHead;

    const set_branch = async ref => {
        log("Updating branch %s to %s", ref, sha1);
        await git.branch({fs, dir, ref, object: sha1, force: true});
        await git.push({
            fs, dir, http, ...local,
            ref,
            remoteRef:  ref,
            force:      true,
        });
    };
    await set_branch("acs");
    if (reset_main) await set_branch("main");

    await FS.rm(dir, { recursive: true, force: true });
}

