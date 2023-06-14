#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient, WebAPI } from "@amrc-factoryplus/utilities";

import { EdgeDeploy } from "../lib/edge-deploy.js";
import { Edge } from "../lib/uuids.js";

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Edge.Perm.All,
    git_checkouts:      process.env.GIT_CHECKOUTS_DIR,
}).init();

const edge = await new EdgeDeploy({
    fplus:      fplus,
    http_url:   process.env.HTTP_API_URL,
    git_email:  process.env.GIT_EMAIL,
    repo_group: process.env.CLUSTER_REPO_GROUP,
}).init();

const api = await new WebAPI({
    http_port:  process.env.PORT,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,

    ping: { service: Edge.Service.EdgeDeployment },
    routes: app => {
        app.use("/v1", edge.routes);
    },
}).init();

api.run();
