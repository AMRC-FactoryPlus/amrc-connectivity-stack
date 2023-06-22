#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient, WebAPI } from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { EdgeDeploy } from "../lib/edge-deploy.js";
import { Edge } from "../lib/uuids.js";

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Edge.Perm.All,
    git_checkouts:      process.env.GIT_CHECKOUTS_DIR,
    git_email:          process.env.GIT_EMAIL,
}).init();

const edge = await new EdgeDeploy({
    fplus:      fplus,
    realm:      process.env.REALM,
    http_url:   process.env.HTTP_API_URL,
    repo_group: process.env.CLUSTER_REPO_GROUP,
    cert_dir:   process.env.KUBESEAL_TEMP,
    flux_class: process.env.FLUX_ACCOUNT_CLASS,
}).init();

const api = await new WebAPI({
    http_port:  process.env.PORT,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,

    ping: {
        service:    Edge.Service.EdgeDeployment,
        version:    "0.0.1",
        software:   {
            vendor:         "AMRC",
            application:    "acs-edge-deployment",
            revision:       GIT_VERSION,
        },
    },
    routes: app => {
        app.use("/v1", edge.routes);
    },
}).init();

api.run();
