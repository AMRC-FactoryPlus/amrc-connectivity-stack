/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { ADSHandler } from "../lib/ads.js";

const drv = new AsyncDriver({
    env: process.env,
    handler: ADSHandler,
});

drv.run();
