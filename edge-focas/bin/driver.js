/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { FocasHandler } from "../lib/focas.js";

const drv = new PolledDriver({
    env:        process.env,
    handler:    FocasHandler,
    serial:     true,
});
drv.run();
