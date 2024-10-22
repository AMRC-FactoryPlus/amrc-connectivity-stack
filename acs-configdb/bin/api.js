#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Application entrypoint
 * Copyright 2021 AMRC.
 */

import url from "url";
import express from "express";

import { Debug, ServiceClient, UUIDs }  from "@amrc-factoryplus/service-client";
import { WebAPI }                       from "@amrc-factoryplus/service-api";

import { GIT_VERSION } from "../lib/git-version.js";
import { Service, Version } from "../lib/constants.js";

import Model from "../lib/model.js";
import APIv1 from "../lib/api-v1.js";
import MQTTCli from "../lib/mqttcli.js";

const Device_UUID = process.env.DEVICE_UUID;

const fplus = await new ServiceClient({ env: process.env }).init();
const model = new Model({ log: fplus.debug.bound("model") });

const api_v1 = await new APIv1({
    fplus_client:   fplus,
    model,
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
    debug:      fplus.debug,
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
        fplus.debug.log("editor", `Serving editor out of ${editor}.`);
        app.use("/editor", express.static(editor));

        app.use("/v1", api_v1.routes);
    },
}).init();

if (process.env.MQTT_DISABLE) {
    fplus.debug.log("mqtt", "Disabling MQTT connection.");
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

const watch = fplus.debug.bound("watch");
model.updates.subscribe(u => watch("UPDATE: %o", u));
api.run();
