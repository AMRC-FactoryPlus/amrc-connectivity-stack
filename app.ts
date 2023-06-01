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

    // If we've overwritten the server then update it here. This is not used in production but serves to be useful when testing outside of the cluster
    if (process.env.MQTT_URL) {
        console.log(`Overwriting MQTT URL to ${process.env.MQTT_URL}`);
        fplus.set_service_url(UUIDs.Service.MQTT, process.env.MQTT_URL);
    }

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

