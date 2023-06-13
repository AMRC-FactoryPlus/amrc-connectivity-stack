#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Main entry point
 * Copyright 2022 AMRC
 */

import http from "http";
import express from "express";

import { ServiceClient, WebAPI } from "@amrc-factoryplus/utilities";

import { GitServer } from "../lib/git-server.js";
import { Git } from "../lib/uuids.js";

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Git.Perm.All,
}).init();

const git = await new GitServer({
    fplus:      fplus,
    data:       process.env.DATA_DIR,
    git_exec:   process.env.GIT_EXEC_PATH,
}).init();

const api = await new WebAPI({
    http_port:  process.env.PORT,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,

    ping: { service: Git.Service.Git },
    routes: app => {
        app.use("/git", git.routes);
    },
}).init();

api.run();
