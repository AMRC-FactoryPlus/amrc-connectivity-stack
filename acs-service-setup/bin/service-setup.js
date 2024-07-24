/* ACS initial service setup
 * Copyright 2023 AMRC
 */

import process from "process";

import { GIT_VERSION }  from "../lib/git-version.js";
import { ServiceSetup } from "../lib/service-setup.js";

console.log(`ACS service setup revision ${GIT_VERSION}`);

const app = await new ServiceSetup({ env: process.env }).init();
await app.run();
