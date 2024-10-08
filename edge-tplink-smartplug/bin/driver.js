/* AMRC Connectivity Stack
 * TP Link Smartplug driver
 * Copyright 2024 AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { TplinkHandler } from "../lib/tplink.js";

const drv = new PolledDriver({
    env:        process.env,
    handler:    TplinkHandler,
    serial:     true,
});
drv.run();
