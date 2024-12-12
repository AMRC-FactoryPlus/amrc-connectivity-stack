#!/usr/bin/env node

/*
 * ACS Authorisation component
 * Main entry point
 * Copyright 2024 University of Sheffield AMRC
 */

import { WebAPI } from "@amrc-factoryplus/service-api";
import { Debug, UUIDs } from "@amrc-factoryplus/service-client";
import { RxClient } from "@amrc-factoryplus/rx-client";

import { GIT_VERSION } from "../lib/git-version.js";

import { Auth } from "../lib/authz.js";
import { AuthNotify } from "../lib/notify.js";
import { TemplateEngine } from "../lib/templates.js";

/* This is the F+ service spec version */
const Version = "1.0.0";

const fplus = new RxClient({ env: process.env });
const { debug } = fplus;

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

const engine = new TemplateEngine({ fplus });

const notify = new AuthNotify({
    auth, api, fplus,
    log:    debug.bound("notify"),
});
    
api.run();
engine.run();
notify.run();
