/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {Translator} from "./lib/translator.js";
import {fetchConfig, wait} from './utils/CentralConfig.js';
import {reHashConf} from "./utils/FormatConfig.js";
import {log} from "./lib/helpers/log.js";
import * as dotenv from 'dotenv';
import sourceMapSupport from 'source-map-support'
sourceMapSupport.install()

dotenv.config({path: '../.env'});

//Make sure we have out env variables set before we do anything
if (!process.env.CONFIG_URL) {
    throw new Error("CONFIG_URL is not set!");
}
if (!process.env.keytab) {
    throw new Error("Keytab (keytab) is not set!");
}
if (!process.env.NODE_ID) {
    throw new Error("NODE_ID is not set!");
}

run()

async function run() {
    const config = await getNewConfig(parseInt(process.env.POLL_INT) || 30)

    // Once a configuration has been loaded then start up the translator
    let transApp = new Translator(reHashConf(config));
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


/**
 * loops until we have new config
 */
async function getNewConfig(interval: number) {
    // Loop to try to fetch the configuration from the manager
    log('Attempting to fetch config...');
    let config = await fetchConfig();
    while (!config) {
        log('Response from config server was not a config. Trying again in ' + parseInt(process.env.POLL_INT).toString() + ' seconds...');
        await wait(interval);
        log('Attempting to fetch config...');
        config = await fetchConfig();
    }
    log('Config fetched.');
    return config;
}