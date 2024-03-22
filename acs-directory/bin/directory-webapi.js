#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * Web API application entry point
 * Copyright 2021 AMRC.
 */

import { ServiceClient, WebAPI, UUIDs } from "@amrc-factoryplus/utilities";

import Model from "../lib/model.js";
import APIv1 from "../lib/api_v1.js";
import { Perm } from "../lib/uuids.js";
import { GIT_VERSION } from "../lib/git-version.js";

/* This is the version of the service spec we support. */
const Version = "1.0.0";

const model = await new Model({
    readonly: true,
    verbose: true,
}).init();

const fplus = new ServiceClient({
    root_principal:     process.env.ROOT_PRINCIPAL,
    permission_group:   Perm.All,
});
fplus.set_service_discovery(model.find_service_url.bind(model));

const api = await new APIv1({
    model,
    fplus,
    internal_hostname:  process.env.HOSTNAME,
}).init();

const app = await new WebAPI({
    ping:       {
        version:    Version,
        service:    UUIDs.Service.Directory,
        device:     process.env.DEVICE_UUID,
        software: {
            vendor:         "AMRC",
            application:    "acs-directory",
            revision:       GIT_VERSION,
        },
    },
    keytab:     process.env.SERVER_KEYTAB,
    http_port:  process.env.PORT,
    max_age:    process.env.CACHE_MAX_AGE,

    /* XXX These two should go. They are only used for verifying Basic;
     * we use the realm to canonicalise the user principal, and both to
     * find a server principal to get a ticket for. We can let the GSS
     * library canonicalise the user principal if we use it right, and
     * it's not difficult to parse the keytab sufficiently to extract a
     * principal name we have a key for. */
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,

    routes: app => {
        app.use("/v1", api.routes);
    },
}).init();

app.run();
