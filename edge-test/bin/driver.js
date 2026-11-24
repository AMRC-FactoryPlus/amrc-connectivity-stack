/* AMRC Connectivity Stack
 * Testing Edge Agent driver
 * Copyright 2024 AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { NoScoutTestHandler, TestHandler } from "../lib/test.js";

/* SCOUT_UNSUPPORTED=1 makes the driver answer that it can't scan, for
 * testing the Edge Agent. */
const handler = process.env.SCOUT_UNSUPPORTED == "1"
    ? NoScoutTestHandler : TestHandler;

const drv = new PolledDriver({
    env:        process.env,
    handler,
    serial:     false,
});
drv.run();
