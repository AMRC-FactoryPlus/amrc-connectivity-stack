/*
 * ACS service setup
 * Move connections between internal and split drivers
 * Copyright 2026 University of Sheffield AMRC
 *
 * This runs in the service-setup Job after edge-helm-charts has
 * written this release's edge charts, because a connection only moves
 * to a split driver when the edge clusters will run those charts (see
 * lib/edge-charts.js). It can't run before: edge-helm-charts needs the
 * chart repo, which service setup creates.
 */

import process from "process";

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { GIT_VERSION }              from "../lib/git-version.js";
import { migrate_split_drivers }    from "../lib/split-drivers.js";

console.log(`ACS split driver migration revision ${GIT_VERSION}`);

const { env } = process;
const fplus = await new ServiceClient({ env }).init();

await migrate_split_drivers({
    fplus,
    config:             JSON.parse(env.SS_CONFIG),
    edge_charts_path:   env.GIT_REPO_PATH,
    checkouts:          env.GIT_CHECKOUTS,
});
