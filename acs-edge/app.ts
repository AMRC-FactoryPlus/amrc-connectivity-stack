/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import * as dotenv from 'dotenv';
import sourceMapSupport from 'source-map-support'

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { DriverBroker } from "./lib/driverBroker.js";
import { GIT_VERSION } from "./lib/git-version.js";
import { log } from "./lib/helpers/log.js";
import { Translator } from "./lib/translator.js";

sourceMapSupport.install()
dotenv.config({ path: '../.env' });

/* run() is called again for every in-process restart, so process-wide
 * handlers are registered once, here, and act on the current
 * translator. */
let transApp: Translator | undefined;
let terminating = false;
process.once('SIGTERM', () => {
    log('🔪️SIGTERM RECEIVED');
    terminating = true;
    transApp?.stop(true);
})

run()

async function run() {
    log(`Starting ACS Edge Agent version ${GIT_VERSION}`);

    const pollInt = parseInt(process.env.POLL_INT) || 30;
    const fplus = await new ServiceClient({ env: process.env }).init();
    const broker = new DriverBroker(process.env);

    // Once a configuration has been loaded then start up the translator
    transApp = new Translator(fplus, pollInt, broker);

    // This restarts the application without killing the container. Mainly used to reload config without the container
    // Entering a backoff reboot loop in K8s
    transApp.once('stopped', (kill) => {
        if (!kill && !terminating) {
            run()
        }
    })

    await transApp.start();

}

