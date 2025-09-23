/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { RTDEHandler } from "../lib/rtde.js";

const drv = new AsyncDriver({
  env: process.env,
  handler: RTDEHandler
});

drv.run();
