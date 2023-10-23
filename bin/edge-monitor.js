/*
 * ACS Edge Monitor service
 * Main entry point
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { Monitor } from "../lib/monitor.js";

const fplus = await new ServiceClient({
    env: process.env,
}).init();

const monitor = await new Monitor({
    fplus,
    node: process.env.AGENT_UUID,
}).init();

monitor.run();
