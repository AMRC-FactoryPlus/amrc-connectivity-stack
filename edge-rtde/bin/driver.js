/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

// Load environment variables from .env file if available (for local development)
//import dotenv from 'dotenv';
//dotenv.config();

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { RTDEHandler } from "../lib/rtde.js";

const drv = new AsyncDriver({
  env: process.env,
  handler: RTDEHandler
});

console.log("Starting driver...");
drv.run();
