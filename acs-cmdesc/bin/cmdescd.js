/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * Main entrypoint
 * Copyright 2022 AMRC
 */

import { RxClient }     from "@amrc-factoryplus/rx-client";
import { WebAPI }       from "@amrc-factoryplus/service-api";

import { GIT_VERSION } from "../lib/git-version.js";
import ApiV1 from "../lib/api_v1.js";
import CmdEscD from "../lib/cmdescd.js";
import MqttCli from "../lib/mqttcli.js";

const Service_Cmdesc = "78ea7071-24ac-4916-8351-aa3e549d8ccd";
/* This is the service spec version, not the implementation version */
const Version = "1.0.2";

const Device_UUID = process.env.DEVICE_UUID;

const fplus = await new RxClient({ env: process.env }).init();

const cmdesc = await new CmdEscD({
    fplus,
}).init();

const mqtt = await new MqttCli({
    fplus,
    sparkplug_address:  process.env.SPARKPLUG_ADDRESS,
    device_uuid:        Device_UUID,
    service:            Service_Cmdesc,
    http_url:           process.env.HTTP_API_URL,
}).init();

const v1 = await new ApiV1({
    cmdesc,
}).init();

const web = await new WebAPI({
    ping:       {
        version:    Version,
        service:    Service_Cmdesc,
        device:     Device_UUID,
        software: {
            vendor:         "AMRC",
            application:    "acs-cmdesc",
            revision:       GIT_VERSION,
        },
    },
    verbose:    process.env.VERBOSE,
    realm:      process.env.REALM,
    hostname:   process.env.HOSTNAME,
    keytab:     process.env.SERVER_KEYTAB,
    http_port:  process.env.PORT,
    max_age:    process.env.CACHE_MAX_AGE,

    routes: app => {
        app.use("/v1", v1.routes);
    },
}).init();

mqtt.set_cmdesc(cmdesc);
cmdesc.set_mqtt(mqtt);
mqtt.run();
web.run();
