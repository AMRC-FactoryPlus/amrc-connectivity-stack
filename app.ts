/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {ServiceClient, UUIDs} from "@amrc-factoryplus/utilities";
import {Translator} from "./lib/translator.js";
import {validateConfig, wait} from './utils/CentralConfig.js';
import {reHashConf} from "./utils/FormatConfig.js";
import {log} from "./lib/helpers/log.js";
import {GIT_VERSION} from "./lib/git-version.js";
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
    log(`Starting ACS Edge Agent version ${GIT_VERSION}`);

    const pollInt = parseInt(process.env.POLL_INT) || 30;

    const fplus = await new ServiceClient({
        directory_url:  requireEnv("DIRECTORY_URL"),
        username:       requireEnv("SERVICE_USERNAME"),
        password:       requireEnv("SERVICE_PASSWORD"),
    }).init();

    /* Fetch our identities (UUID, Sparkplug) from the Auth service. */
    const ids = await retry("identities", pollInt, async () => {
        const ids = await fplus.Auth.find_principal();
        if (!ids || !ids.uuid || !ids.sparkplug) return;
        return ids;
    });
    log(`Found my identities: UUID ${ids.uuid}, Sparkplug ${ids.sparkplug}`);

    // If we've overwritten the server then update it here. This is not used in production but serves to be useful when testing outside of the cluster
    if (process.env.MQTT_URL) {
        console.log(`Overwriting MQTT URL to ${process.env.MQTT_URL}`);
        fplus.set_service_url(UUIDs.Service.MQTT, process.env.MQTT_URL);
    }

    const config = await retry("config", pollInt, async () => {
        const config = await fplus.fetch_configdb(EdgeAgentConfig, ids.uuid!);
        if (!config || !validateConfig(config)) return;
        return config;
    });

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

async function retry<RV> (what: string, interval: number, 
    fetch: () => Promise<RV | undefined>): Promise<RV>
{
    while (true) {
        log(`Attempting to fetch ${what}...`);
        const rv = await fetch();
        if (rv != undefined) {
            log(`Fetched ${what}.`);
            return rv;
        }

        log(`Failed to fetch ${what}. Trying again in ${interval} seconds...`);
        await wait(interval);
    }
}
