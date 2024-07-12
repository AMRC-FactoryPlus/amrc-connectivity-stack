/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import { PolledDriver } from "../lib/edge-driver.js";
import { modbusHandler } from "../lib/modbus.js";

const drv = new PolledDriver(process.env, modbusHandler);
drv.run();
