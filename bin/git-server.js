#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Main entry point
 * Copyright 2022 AMRC
 */

import http from "http";
import express from "express";

import { ServiceClient, WebAPI } from "@amrc-factoryplus/utilities";

import { GitServer, Perm } from "../lib/git-server.js";

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Perm.All,
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

    ping: { service: "7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b" },
    routes: git.routes.bind(git),
}).init();

api.run();
