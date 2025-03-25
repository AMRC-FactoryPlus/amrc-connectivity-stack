#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Main entry point
 * Copyright 2022 AMRC
 */

import { RxClient } from "@amrc-factoryplus/rx-client";
import { WebAPI } from "@amrc-factoryplus/service-api";
import { UUIDs } from "@amrc-factoryplus/service-client";

import { APIv2 } from "../lib/api_v2.js";
import AuthN from "../lib/authn.js";
import AuthZ from "../lib/authz.js";
import { DataFlow } from "../lib/dataflow.js";
import { Loader } from "../lib/loader.js";
import Model from "../lib/model.js";
import { AuthNotify } from "../lib/notify.js";
import Editor from "../lib/editor.js";

import { GIT_VERSION } from "../lib/git-version.js";

/* This is the F+ service spec version */
const Version = "2.0.0";

const fplus = new RxClient({ env: process.env });
const debug = fplus.debug;

debug.log("app", "Starting acs-auth revision %s", GIT_VERSION);

const model  = await new Model({ debug, }).init();
const data = new DataFlow({
    fplus, model,
    root_principal:     process.env.ROOT_PRINCIPAL,
});

const authn = await new AuthN({ }).init();
const authz = await new AuthZ({ data, debug, model });
const apiv2 = new APIv2({ data, debug });
const loader = new Loader({ 
    data, debug, model,
    realm:              process.env.REALM,
});

const editor = await new Editor({
    services: {
        auth:       process.env.HTTP_API_URL,
        configdb:   process.env.CONFIGDB_URL,
    },
}).init();

const api = await new WebAPI({
    debug,
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
    body_limit: process.env.BODY_LIMIT,
    routes: app => {
        app.use("/authn", authn.routes);
        app.use("/authz", authz.routes);
        app.use("/load", loader.routes);
        app.use("/v2", apiv2.routes);
        app.use("/editor", editor.routes);
    },
}).init();
    
const notify = new AuthNotify({
    api, data,
    debug:      fplus.debug,
});

debug.log("app", "Running data");
data.run();
debug.log("app", "Running notify");
notify.run();
debug.log("app", "Running api");
api.run();
