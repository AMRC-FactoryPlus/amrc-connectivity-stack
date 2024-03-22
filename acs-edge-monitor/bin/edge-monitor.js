/*
 * ACS Edge Monitor service
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { Monitor } from "../lib/monitor.js";
import { SparkplugNode } from "../lib/sparkplug.js";

console.log("Starting ACS edge monitor, revision %s", GIT_VERSION);

const fplus = await new ServiceClient({
    env: process.env,
}).init();

const sparkplug = await new SparkplugNode({
    fplus,
    cluster:    process.env.CLUSTER_UUID,
}).init();

const monitor = await new Monitor({
    fplus, sparkplug,
    namespace: process.env.CLUSTER_NAMESPACE,
}).init();

/* It is important to start the Sparkplug Node first, as it sets the
 * MQTT will to use */
await sparkplug.run();
monitor.run();
