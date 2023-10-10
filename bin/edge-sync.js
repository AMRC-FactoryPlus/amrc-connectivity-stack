#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { Nodes } from "../lib/nodes.js";
import { Edge } from "../lib/uuids.js";

const fplus = await new ServiceClient({
    env:                process.env,
    permission_group:   Edge.Perm.All,
}).init();

fplus.debug.log("version", "Starting Edge Sync agent, version %s", GIT_VERSION);

const nodes = await new Nodes({
    fplus,
    cluster:    process.env.CLUSTER_UUID,
}).init();

nodes.run();
