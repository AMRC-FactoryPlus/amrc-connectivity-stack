#!/usr/bin/env node

/*
 * ACS Authorisation component
 * Main entry point
 * Copyright 2024 University of Sheffield AMRC
 */

import { Debug, WebAPI } from "@amrc-factoryplus/service-api";
import { UUIDs } from "@amrc-factoryplus/service-client";

import { GIT_VERSION } from "../lib/git-version.js";

import { Auth } from "../lib/auth.js";
import { AuthNotify } from "../lib/notify.js";

/* This is the F+ service spec version */
const Version = "1.0.0";

const debug = new Debug({ verbose: process.env.VERBOSE });
const auth = new Auth();

const api = await new WebAPI({
    ping:       {
        version:    Version,
        service:    UUIDs.Service.Authentication,
        software: {
            vendor:         "AMRC",
            application:    "acs-auth",
            revision:       GIT_VERSION,
        },
    },
    debug,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,
    http_port:  process.env.PORT ?? 80,
    max_age:    process.env.CACHE_MAX_AGE ?? 60,
    routes: app => {
    },
}).init();

const notify = new AuthNotify({
    auth, api,
    log:    debug.bound("notify"),
});
    
api.run();
notify.run();
