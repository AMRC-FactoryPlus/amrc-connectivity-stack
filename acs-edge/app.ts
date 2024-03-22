/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {ServiceClient, UUIDs} from "@amrc-factoryplus/utilities";
import {Translator} from "./lib/translator.js";
import {log} from "./lib/helpers/log.js";
import {GIT_VERSION} from "./lib/git-version.js";
import * as dotenv from 'dotenv';
import sourceMapSupport from 'source-map-support'

sourceMapSupport.install()
dotenv.config({path: '../.env'});

run()

async function run() {
    log(`Starting ACS Edge Agent version ${GIT_VERSION}`);

    const pollInt = parseInt(process.env.POLL_INT) || 30;
    const fplus = await new ServiceClient({ env: process.env }).init();

    // Once a configuration has been loaded then start up the translator
    let transApp = new Translator(fplus, pollInt);
    process.once('SIGTERM', () => {
        log('🔪️SIGTERM RECEIVED');
        transApp.stop(true);
    })

    // This restarts the application without killing the container. Mainly used to reload config without the container
    // Entering a backoff reboot loop in K8s
    transApp.on('stopped', (kill) => {
        if (!kill) {
            run()
        }
    })

    await transApp.start();

}

