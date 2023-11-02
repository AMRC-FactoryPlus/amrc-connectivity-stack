/*
 * ACS Edge Monitor service
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { Monitor } from "../lib/monitor.js";

console.log("Starting ACS edge monitor, revision %s", GIT_VERSION);

const fplus = await new ServiceClient({
    env: process.env,
}).init();

const monitor = await new Monitor({
    fplus,
    namespace: process.env.CLUSTER_NAMESPACE,
}).init();

monitor.run();
