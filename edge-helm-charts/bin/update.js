/*
 * AMRC Connectivity Stack Edge Helm charts
 * Script to update an on-prem git repo
 * Copyright 2024 AMRC
 */

import fs       from "fs";

import git      from "isomorphic-git";
import http     from "isomorphic-git/http/node";

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { GIT_VERSION } from "../lib/git-version.js";

const path = process.env.GIT_REPO_PATH;

const fplus = await new ServiceClient({ env: process.env }).init();
const repo = await fplus.Git.remote({ path });
const princ = await fplus.Auth.find_principal();

const opts = {
    fs, http,
    ...repo,
    dir: "charts",
    remote: "origin",
    author: {
        name: "ACS installer",
        email: princ.kerberos,
    },
};

const log = fplus.debug.bound("charts");
log("ACS Edge Helm Charts update rev %s", GIT_VERSION);

const get_ref = ref => git.resolveRef({...opts, ref})
    .catch(e => e instanceof git.Errors.NotFoundError
        ? null : Promise.reject(e));

const set_branch = (ref, sha1) => {
    log("Updating %s branch %s to %s", path, ref, sha1);
    return git.branch({ ...opts, ref, object: sha1, force: true });
};

const push_ref = async ref => {
    log("Pushing branch %s to %s", ref, path);
    await git.push({ ...opts, ref, remoteRef: ref });
};

await git.init({...opts, defaultBranch: "main"});
await git.addRemote(opts);

log("Fetching from %s", path);
const mirror = await git.fetch(opts);

const main = await get_ref("origin/main");
const acs = (await get_ref("origin/acs")) ?? main;
const update = (!main || main == acs);

await git.add({...opts, filepath:"."});
const sha1 = await git.commit({
    ...opts,
    ref:        "acs",
    parent:     (acs ? [acs] : []),
    message:    "ACS install",
});
log("Committed %s to branch acs", sha1);
await push_ref("acs");

if (!main || main == acs) {
    await set_branch("main", "acs");
    await push_ref("main");
}

log("Done.");

