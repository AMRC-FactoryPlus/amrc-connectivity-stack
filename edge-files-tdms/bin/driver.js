/* AMRC Connectivity Stack
 * TDMS driver
 * Copyright 2025 AMRC
 */

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { TDMSHandler } from "./TDMSHandler.js";

const driver = new AsyncDriver({
  env: process.env,
  handler: TDMSHandler,
});

console.log(`Driver initialized: ${JSON.stringify(driver)}`);
driver.run();
console.log("\n\nDriver running...\n\n");
//driver.data("TestTDMS", JSON.stringify({timestamp: "2025-01-01T00:00:00Z", value: 123}));
// console.log(driver);
