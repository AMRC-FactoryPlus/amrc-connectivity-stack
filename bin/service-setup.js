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

import { GIT_VERSION } from "../lib/git-version.js";

const Checkouts = process.env.GIT_CHECKOUTS;
const Repos = "./shared";
const Git_Service = "7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b";

const fplus = await new ServiceClient({env: process.env}).init();

const my_princ = await fplus.Auth.find_principal();
const git_base = await fplus.Discovery.service_url(Git_Service);
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

const repos = await FS.readdir(Repos);
for (const repo of repos) {
    const path = `shared/${repo}`;
    console.log(`Updating repo ${path} to ${GIT_VERSION}`);

    const dir = Path.join(Checkouts, repo);
    const url = new URL(`/git/${path}`, git_base).toString();

    const remote = { http, url, onAuth: git_auth, onAuthFailed: git_auth };

    await FS.rm(dir, {recursive: true, force: true});
    await git.clone({
        fs, dir, ...remote,
        noCheckout:     true,
    });

    const branches = await git.listBranches({fs, dir});
    if (branches.length == 0) {
        /* This is an empty repo. We need to create the branch which the
         * remote considers to be 'default'; there doesn't seem to be
         * any way to find out what this is called. Assume 'main' as
         * that is how acs-git creates repos. */
        git.branch({fs, dir, ref: "main", checkout: true});
        git.commit({fs, dir, author, message: "Initial commit"});
    }

    /* We didn't check out the branch, so our WD is empty. */
    await FS.cp(Path.join(Repos, repo), dir, {recursive: true});
    await git.add({fs, dir, filepath: "."});
    await git.commit({fs, dir, author, message: `ACS service setup ${GIT_VERSION}`});

    await git.push({fs, dir, ...remote});
    await FS.rm(dir, {recursive: true, force: true});
}
