/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {ServiceClient, UUIDs} from "@amrc-factoryplus/utilities";
import {Translator} from "./lib/translator.js";
import {validateConfig, wait} from './utils/CentralConfig.js';
import {reHashConf} from "./utils/FormatConfig.js";
import {log} from "./lib/helpers/log.js";
import * as dotenv from 'dotenv';
import sourceMapSupport from 'source-map-support'

const EdgeAgentConfig = "aac6f843-cfee-4683-b121-6943bfdf9173"; 

sourceMapSupport.install()
dotenv.config({path: '../.env'});

function requireEnv(key: string) {
    if (!(key in process.env))
        throw new Error(`${key} is not set in the environment!`);
    return process.env[key]!;
}

run()

async function run() {
    const nodeUuid = requireEnv("NODE_ID");
    const fplus = await new ServiceClient({
        directory_url:  requireEnv("DIRECTORY_URL"),
        username:       requireEnv("SERVICE_USERNAME"),
        password:       requireEnv("SERVICE_PASSWORD"),
    }).init();

    // If we've overwritten the server then update it here. This is not used in production but serves to be useful when testing outside of the cluster
    if (process.env.MQTT_URL) {
        console.log(`Overwriting MQTT URL to ${process.env.MQTT_URL}`);
        fplus.set_service_url(UUIDs.Service.MQTT, process.env.MQTT_URL);
    }

    const config = await getNewConfig(fplus, nodeUuid, parseInt(process.env.POLL_INT) || 30)

    // Once a configuration has been loaded then start up the translator
    let transApp = new Translator(fplus, reHashConf(config));
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
async function getNewConfig(fplus: ServiceClient, nodeUuid: string, interval: number) {
    // Loop to try to fetch the configuration from the manager
    while (true) {
        log('Attempting to fetch config...');
        const config = await fplus.fetch_configdb(EdgeAgentConfig, nodeUuid);
        if (config && validateConfig(config)) {
            log('Config fetched.');
            return config;
        }

        log(`Response from config server was not a config. Trying again in ${interval} seconds...`);
        await wait(interval);
    }
}
