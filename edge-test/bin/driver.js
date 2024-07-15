/* AMRC Connectivity Stack
 * Testing Edge Agent driver
 * Copyright 2024 AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { handleTest } from "../lib/test.js";

const drv = new PolledDriver({
    env:        process.env,
    handler:    handleTest,
    serial:     false,
});
drv.run();
