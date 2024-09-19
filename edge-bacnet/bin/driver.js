/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { BacnetHandler } from "../lib/bacnet.js";

const drv = new PolledDriver({
    env:        process.env,
    handler:    BacnetHandler,
    serial:     true,
});
drv.run();
