/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";
import { RTDEHandler } from "../lib/rtde.js";

const drv = new PolledDriver({
  env: process.env,
  handler: RTDEHandler,
  serial: true,
});

drv.run();
