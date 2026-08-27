/*
 * ACS simulator driver
 * Entrypoint.
 * Copyright 2026 University of Sheffield AMRC
 */

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";

import { SimHandler } from "../lib/sim.js";

/* Async: the driver pushes data as the player's virtual clock makes
 * samples due, rather than being polled. */
const drv = new AsyncDriver({
    env:        process.env,
    handler:    SimHandler,
});
drv.run();
