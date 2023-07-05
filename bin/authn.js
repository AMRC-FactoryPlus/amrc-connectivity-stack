#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Main entry point
 * Copyright 2022 AMRC
 */

import { WebAPI, UUIDs } from "@amrc-factoryplus/utilities";

import AuthN from "../lib/authn.js";
import AuthZ from "../lib/authz.js";
import Editor from "../lib/editor.js";

import { GIT_VERSION } from "../lib/git-version.js";

/* This is the F+ service spec version */
const Version = "1.0.0";

const authn = await new AuthN({ }).init();
const authz = await new AuthZ({
    acl_cache:          process.env.ACL_CACHE ?? 5,
    root_principal:     process.env.ROOT_PRINCIPAL,
    verbose:            !!process.env.VERBOSE,
}).init();

const editor = await new Editor({
    services: {
        auth:       process.env.HTTP_API_URL,
        configdb:   process.env.CONFIGDB_URL,
    },
}).init();

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
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,
    http_port:  process.env.PORT ?? 80,
    max_age:    process.env.CACHE_MAX_AGE ?? 60,
    routes: app => {
        app.use("/authn", authn.routes);
        app.use("/authz", authz.routes);
        app.use("/editor", editor.routes);
    },
}).init();
    
api.run();
