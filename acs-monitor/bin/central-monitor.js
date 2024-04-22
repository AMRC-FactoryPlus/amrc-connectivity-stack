/*
 * ACS Edge Monitor service
 * Central monitor entry point
 * Copyright 2024 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { GIT_VERSION } from "../lib/git-version.js";
import { CentralMonitor } from "../lib/central.js";
//import { SparkplugNode } from "../lib/sparkplug.js";

console.log("Starting ACS central monitor, revision %s", GIT_VERSION);

const fplus = await new ServiceClient({
    env: process.env,
}).init();

//const sparkplug = await new SparkplugNode({
//    fplus,
//    cluster:    process.env.CLUSTER_UUID,
//}).init();

const monitor = await new CentralMonitor({
    fplus,
}).init();

/* It is important to start the Sparkplug Node first, as it sets the
 * MQTT will to use */
//await sparkplug.run();
monitor.run();
