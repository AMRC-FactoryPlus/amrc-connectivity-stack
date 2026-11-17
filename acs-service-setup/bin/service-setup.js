/* ACS initial service setup
 * Copyright 2023 AMRC
 */

import process from "process";

import { GIT_VERSION }  from "../lib/git-version.js";
import { ServiceSetup } from "../lib/service-setup.js";

console.log(`ACS service setup revision ${GIT_VERSION}`);

const app = await new ServiceSetup({ env: process.env }).init();

/* SS_STEP picks a step that runs on its own, in its own init container
 * of the service-setup Job. Unset runs the main setup. */
switch (process.env.SS_STEP) {
    case undefined:
    case "":
        await app.run();
        break;
    case "split-drivers":
        await app.run_split_drivers();
        break;
    default:
        throw new Error(`Unknown SS_STEP ${process.env.SS_STEP}`);
}
