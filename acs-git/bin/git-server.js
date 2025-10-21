#!/usr/bin/env node

/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */


import fs from "fs";
import process from "process";

import { ServiceClient }    from "@amrc-factoryplus/service-client";
import { WebAPI }           from "@amrc-factoryplus/service-api";

import { GIT_VERSION }      from "../lib/git-version.js";
import { GitServer }        from "../lib/git-server.js";
import { AutoPull }         from "../lib/auto-pull.js";
import { GitNotify }        from "../lib/notify.js";
import { SparkplugNode }    from "../lib/sparkplug.js";
import { RepoStatus }       from "../lib/status.js";
import { Git }              from "../lib/uuids.js";

console.log("Starting acs-git version %s", GIT_VERSION);

/* sparkplug-app doesn't currently handle failed subscriptions correctly
 * and Node throws an unhandled promise. However for some reason this is
 * not causing Node to exit, but to hang. I don't know why this happens,
 * but in this situation the most important thing is that we actually
 * exit, promptly, so that k8s will restart us. */
process.on("uncaughtException", (err, origin) => {
    const msg = err instanceof Error ? err.stack : err;
    fs.writeSync(process.stderr.fd, `Uncaught exception [${origin}]: ${msg}\n`);
    process.kill(process.pid);
});

const data = process.env.DATA_DIR;

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Git.Perm.All,
}).init();

const status = await new RepoStatus({
    fplus, data,
    pushes:         process.env.DATA_CHANGED_FIFO,
}).init();

const git = await new GitServer({
    fplus, data, status,
    git_exec:   process.env.GIT_EXEC_PATH,
    http_url:   process.env.HTTP_API_URL,
}).init();

const api = await new WebAPI({
    http_port:  process.env.PORT,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,
    debug:      fplus.debug,

    ping: {
        service: Git.Service.Git,
        software: {
            vendor:         "AMRC",
            application:    "acs-git",
            revision:       GIT_VERSION,
        },
    },
    routes: app => {
        app.use("/", git.routes);
    },
}).init();

const pulls = await new AutoPull({
    fplus, data, status,
    secrets_dir: process.env.SECRETS_DIR || "/run/secrets",
}).init();

const sparkplug = await new SparkplugNode({
    fplus, status,
}).init();

const notify = new GitNotify({
    api, status,
    debug:      fplus.debug,
});

/* Sparkplug must run first as it sets the MQTT Will */
await sparkplug.run();

api.run();
status.run();
pulls.run();
notify.run();
