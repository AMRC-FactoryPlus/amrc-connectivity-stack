#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Main entry point
 * Copyright 2022 AMRC
 */

import http from "http";
import express from "express";

import { ServiceClient, WebAPI } from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { GitServer } from "../lib/git-server.js";
import { Git } from "../lib/uuids.js";

console.log("Starting acs-git version %s", GIT_VERSION);

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Git.Perm.All,
}).init();

const git = await new GitServer({
    fplus:      fplus,
    data:       process.env.DATA_DIR,
    git_exec:   process.env.GIT_EXEC_PATH,
    http_url:   process.env.HTTP_API_URL,
}).init();

const api = await new WebAPI({
    http_port:  process.env.PORT,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,

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

api.run();
