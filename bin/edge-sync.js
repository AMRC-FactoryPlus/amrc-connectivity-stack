#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { Edge } from "../lib/uuids.js";

import { Deployments } from "../lib/deployments.js";
import { Kubeseal } from "../lib/kubeseal.js";
import { Nodes } from "../lib/nodes.js";

const cluster = process.env.CLUSTER_UUID;

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Edge.Perm.All,
}).init();

fplus.debug.log("version", "Starting Edge Sync agent, version %s", GIT_VERSION);

const nodes = await new Nodes({
    fplus, cluster,
}).init();

const kubeseal = await new Kubeseal({
    fplus, cluster,
    namespace:      process.env.SEALED_SECRETS_NAMESPACE,
    controller:     process.env.SEALED_SECRETS_CONTROLLER,
}).init();

const deploy = await new Deployments({
    fplus, cluster,
}).init();

nodes.run();
kubeseal.run();
deploy.run();
