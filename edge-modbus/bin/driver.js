/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { modbusHandler } from "../lib/modbus.js";

const drv = new PolledDriver({
    env:        process.env,
    handler:    modbusHandler,
    serial:     true,
});
drv.run();
