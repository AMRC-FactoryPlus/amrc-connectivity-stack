/* AMRC Connectivity Stack
 * TDMS driver
 * Copyright 2025 AMRC
 */

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { Handler } from "./TDMSHandler.js";

const driver = new AsyncDriver({
  env: process.env,
  handler: Handler,
});

//console.log(`Driver initialized: ${JSON.stringify(driver)}`);

driver.run();
console.log("\n\nDriver running...\n\n");
