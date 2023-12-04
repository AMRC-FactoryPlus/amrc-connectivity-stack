/* ACS initial service setup
 * Copyright 2023 AMRC
 */

import FS from "fs/promises";
import fs from "fs";
import Path from "path";
import process from "process";

import git from "isomorphic-git";
import http from "isomorphic-git/http/node/index.js";

import { ServiceClient, UUIDs } from "@amrc-factoryplus/utilities";

//import { GIT_VERSION } from "../lib/git-version.js";

const Checkouts = process.env.GIT_CHECKOUTS;

const Git = {
    Service:    "7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b",
    Config:     "38d62a93-b6b4-4f63-bad4-d433e3eaff29",
    Class: {
        Repo:       "d25f2afc-1ab8-4d27-b51b-d02314624e3e",
        Group:      "b03d4dfe-7e78-4252-8e62-af594cf316c9",
    },
    Perm: {
        Pull:   "12ecb694-b4b9-4d2a-927e-d100019f7ebe",
    },
};
const EDO = {
    Config:     "5b47881c-b012-4040-945c-eacafca539b2",
    Cluster:    "f24d354d-abc1-4e32-98e1-0667b3e40b61",
    Edge: {
        Flux:   "34ee0e7f-8c9c-4f6d-aad7-4ed700bc77da",
    },
};

const fplus = await new ServiceClient({env: process.env}).init();
const log = fplus.debug.log.bind(fplus.debug, "setup");

const my_princ = await fplus.Auth.find_principal();
const git_base = await fplus.Discovery.service_url(Git.Service);
const author = { name: "ACS bootstrap", email: my_princ.kerberos };

async function git_auth (url, auth) {
    const bad = auth?.headers?.Authorization
        ?.match(/^Bearer\s+(\S+)$/)?.[1];
    const tok = await fplus.Fetch._service_token(git_base, bad);
    return {
        headers: {
            "Authorization": `Bearer ${tok}`,
        },
    };
}
const remote = { http, onAuth: git_auth, onAuthFailed: git_auth };

async function setup_edo_conf (needs) {
    const Auth = fplus.Auth;
    const CDB = fplus.ConfigDB;
    const conf = await CDB.get_config(EDO.Config, EDO.Config) ?? {};

    const git = conf.git ??= {};
    git.group ??= {};
    for (const [path, name] of Object.entries(needs.group)) {
        const have = git.group[path];
        if (have && have.path && have.uuid)
            continue;

        log("Creating repo group %s", path);
        const uuid = await CDB.create_object(Git.Class.Group);
        log("Created repo group %s: %s", path, uuid);
        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        git.group[path] = { path, uuid };
    }

    git.repo ??= {};
    const shared = git.group.shared;
    for (const [rep, name] of Object.entries(needs.repo)) {
        const have = git.repo[rep];
        if (have && have.path && have.uuid)
            continue;

        const path = `${shared.path}/${rep}`;
        log("Creating repo %s", path);
        const uuid = await CDB.create_object(Git.Class.Repo);
        log("Created repo %s: %s", path, uuid);
        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        await CDB.put_config(Git.Config, uuid, { path });
        await Auth.add_to_group(shared.uuid, uuid);
        git.repo[rep] = { path, uuid };
    }

    await Auth.add_ace(EDO.Edge.Flux, Git.Perm.Pull, shared.uuid);
    await CDB.put_config(EDO.Config, EDO.Config, conf);
    return conf;
}

async function setup_repo_mirror ({ uuid, source, ref }) {
    const dir = Path.join(Checkouts, uuid);
    const local = new URL(`/uuid/${uuid}`, git_base).toString();

    log("Checking out %s", local);
    await FS.rm(dir, {recursive: true, force: true});
    await git.clone({
        fs, dir, ...remote,
        url:            local,
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
        fs, dir, ...remote,
        remote:         "source", 
        singleBranch:   true,
        ref,
    });
    const sha1 = mirror.fetchHead;

    const set_branch = async ref => {
        log("Updating branch %s to %s", ref, sha1);
        await git.branch({fs, dir, ref, object: sha1, force: true});
        await git.push({
            fs, dir, ...remote, 
            remote:     "local",
            ref,
            remoteRef:  ref,
            force:      true,
        });
    };
    await set_branch("acs");
    if (reset_main) await set_branch("main");

    await FS.rm(dir, { recursive: true, force: true });
}

const edo_conf = await setup_edo_conf({
    group: {
        cluster:    "Edge cluster repositories",
        shared:     "Shared repositories",
    },
    repo: {
        helm:       "Edge Helm charts",
    },
});

await setup_repo_mirror({
    uuid:       edo_conf.git.repo.helm.uuid,
    source:     process.env.HELM_REPO_URL,
    ref:        process.env.HELM_REPO_REF,
});

