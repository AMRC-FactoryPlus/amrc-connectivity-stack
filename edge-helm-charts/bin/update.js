/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import fs from "fs";
import path from "path";

import git from "isomorphic-git";
import http from "isomorphic-git/http/node/index.js";

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { GIT_VERSION } from "../lib/git-version.js";

const repoPath = process.env.GIT_REPO_PATH;
const chartSources = JSON.parse(process.env.CHART_SOURCES || "[]");

const fplus = await new ServiceClient({ env: process.env }).init();
const repo = await fplus.Git.remote({ path: repoPath });
const princ = await fplus.Auth.find_principal();

const log = fplus.debug.bound("charts");
log("ACS Edge Helm Charts update rev %s", GIT_VERSION);

// Create merged directory
const mergedDir = "/tmp/merged-charts";
fs.mkdirSync(mergedDir, { recursive: true });
fs.mkdirSync(path.join(mergedDir, "charts"), { recursive: true });

// Always copy the local charts directory first
log("Copying local charts directory");
if (fs.existsSync("charts")) {
    fs.cpSync("charts", path.join(mergedDir, "charts"), { recursive: true });
} else {
    log("Warning: Local charts directory not found");
}

// Process additional chart sources
for (const [index, source] of chartSources.entries()) {
    if (!source.enabled) continue;

    log(`Processing chart source: ${source.name}`);

    // Require source URL to be specified
    if (!source.url) {
        log(`Error: No URL specified for chart source ${source.name}, skipping`);
        continue;
    }

    const sourceUrl = source.url;
    const sourceBranch = source.branch || "main";

    // Set up auth if provided
    const auth = {};
    if (source.auth) {
        if (source.auth.type === "basic") {
            const password = process.env[`SOURCE_${index}_PASSWORD`];
            if (password) {
                auth.onAuth = () => ({ username: source.auth.username, password });
            }
        }
        // Add other auth types as needed
    }

    // Clone source to temp directory
    const sourceDir = `/tmp/source-${index}`;
    log(`Cloning ${sourceUrl} (${sourceBranch}) to ${sourceDir}`);

    try {
        await git.clone({
            fs, http,
            dir: sourceDir,
            url: sourceUrl,
            ref: sourceBranch,
            depth: 1,
            ...auth
        });

        // Copy charts from this source
        if (fs.existsSync(path.join(sourceDir, "charts"))) {
            log(`Copying charts from ${source.name}`);
            fs.cpSync(
                path.join(sourceDir, "charts"),
                path.join(mergedDir, "charts"),
                { recursive: true }
            );
        } else {
            log(`No charts directory found in ${source.name}`);
        }
    } catch (error) {
        log(`Error processing source ${source.name}: ${error.message}`);
    }
}

// Now push the merged charts to the internal Git repo
const opts = {
    fs, http,
    ...repo,
    dir: mergedDir,
    remote: "origin",
    author: {
        name: "ACS installer",
        email: princ.kerberos,
    },
};

const get_ref = ref => git.resolveRef({ ...opts, ref })
    .catch(e => e instanceof git.Errors.NotFoundError
        ? null : Promise.reject(e));

// Initialize the repo
await git.init({ ...opts, defaultBranch: "main" });
await git.addRemote(opts);

// Fetch existing repo
log("Fetching from %s", repoPath);
await git.fetch(opts);

// Get existing refs
const main = await get_ref("origin/main");
const acs = (await get_ref("origin/acs")) ?? main;

// Add all files and commit
await git.add({ ...opts, filepath: "." });
const sha1 = await git.commit({
    ...opts,
    ref: "acs",
    parent: (acs ? [acs] : []),
    message: "ACS install with merged charts",
});
log("Committed %s to branch acs", sha1);

// Push to the repo
const push_ref = async ref => {
    log("Pushing branch %s to %s", ref, repoPath);
    await git.push({ ...opts, ref, remoteRef: ref });
};

await push_ref("acs");

if (!main || main == acs) {
    await git.branch({ ...opts, ref: "main", object: "acs", force: true });
    await push_ref("main");
}

log("Done.");

