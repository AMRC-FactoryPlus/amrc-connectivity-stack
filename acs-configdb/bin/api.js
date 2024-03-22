#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Application entrypoint
 * Copyright 2021 AMRC.
 */

import url from "url";
import express from "express";

import { Debug, ServiceClient, WebAPI, UUIDs, pkgVersion } 
    from "@amrc-factoryplus/utilities";

import { GIT_VERSION } from "../lib/git-version.js";
import { Service, Version } from "../lib/constants.js";
import APIv1 from "../lib/api-v1/controller.js";
import MQTTCli from "../lib/mqttcli.js";

const Device_UUID = process.env.DEVICE_UUID;

const debug = new Debug();

const fplus = await new ServiceClient({
    directory_url: process.env.DIRECTORY_URL,
    root_principal: process.env.ROOT_PRINCIPAL,
}).init();

const api_v1 = await new APIv1({
    fplus_client:   fplus,
    verbose:        !!process.env.VERBOSE,
}).init();

const api = await new WebAPI({
    ping:       {
        version:    Version,
        service:    Service.Registry,
        device:     Device_UUID,
        software: {
            vendor:         "AMRC",
            application:    "acs-configdb",
            revision:       GIT_VERSION,
        },
    },
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,
    http_port:  process.env.PORT,
    max_age:    process.env.CACHE_MAX_AGE,

    routes: app => {
        /* No fancy query-string parsing */
        app.set("query parser", "simple");

        /* Serve the editor */
        const editor = url.fileURLToPath(new URL("../editor", import.meta.url));
        debug.log("editor", `Serving editor out of ${editor}.`);
        app.use("/editor", express.static(editor));

        app.use("/v1", api_v1.routes);
    },
}).init();

if (process.env.MQTT_DISABLE) {
    debug.log("mqtt", "Disabling MQTT connection.");
}
else {
    const mqtt = await new MQTTCli({
        fplus,
        sparkplug_address:  process.env.SPARKPLUG_ADDRESS,
        device_uuid:        Device_UUID,
        url:                process.env.HTTP_API_URL,
        silent:             !!process.env.MQTT_MONITOR_ONLY,
    }).init();

    api_v1.setup_mqtt_link(mqtt);
    mqtt.run();
}

api.run();
