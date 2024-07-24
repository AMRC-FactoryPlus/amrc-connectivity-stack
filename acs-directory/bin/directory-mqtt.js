#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * MQTT ingester application entry point
 * Copyright 2021 AMRC.
 */

import { ServiceClient } from "@amrc-factoryplus/service-client";

import MQTTCli from "../lib/mqttcli.js";
import Model from "../lib/model.js";

const model = await new Model({
    isolation: "repeatable read",
    readonly: false,
    verbose: true,
}).init();

const fplus = new ServiceClient({ env: process.env });
fplus.set_service_discovery(model.find_service_url.bind(model));

const app = await new MQTTCli({
    fplus,
    model,
    url: process.env.HTTP_API_URL,
    silent: !!process.env.MQTT_MONITOR_ONLY,
}).init();

app.run();
