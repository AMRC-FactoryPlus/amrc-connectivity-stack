/*
 * ACS Pathfindr driver
 * Entrypoint.
 * Copyright 2026 University of Sheffield AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";

import { PathfindrHandler } from "../lib/pathfindr.js";

/* Serial polling. Requests are cheap once cached, and serialising keeps the
 * rate limiter's accounting simple under a burst of addresses. */
const drv = new PolledDriver({
    env:        process.env,
    handler:    PathfindrHandler,
    serial:     true,
});
drv.run();
