#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Application entrypoint
 * Copyright 2021 AMRC.
 */

import { ServiceClient }    from "@amrc-factoryplus/service-client";
import { WebAPI }           from "@amrc-factoryplus/service-api";

import { GIT_VERSION } from "../lib/git-version.js";
import { Service, Version } from "../lib/constants.js";

import { Auth } from "../lib/auth.js";
import { BootstrapUUIDs } from "../lib/constants.js";
import Model from "../lib/model.js";
import MQTTCli from "../lib/mqttcli.js";
import { CDBNotify } from "../lib/notify.js";
import { routes } from "../lib/routes.js";

const { env } = process;

const fplus = await new ServiceClient({
    env,
    bootstrap_uuids:    BootstrapUUIDs,
}).init();
const auth = new Auth({ fplus });
const model = await new Model({
    auth,
    debug:  fplus.debug,
}).init();

const mqtt = MQTTCli.fromEnv(fplus, env);

const api = await new WebAPI({
    ping:       {
        version:    Version,
        service:    Service.Registry,
        device:     env.DEVICE_UUID,
        software: {
            vendor:         "AMRC",
            application:    "acs-configdb",
            revision:       GIT_VERSION,
        },
    },
    debug:      fplus.debug,
    realm:      env.REALM,
    hostname:   env.HOSTNAME,
    keytab:     env.SERVER_KEYTAB,
    http_port:  env.PORT,
    max_age:    env.CACHE_MAX_AGE,
    body_limit: env.BODY_LIMIT,

    routes:     routes({ auth, model, fplus, mqtt }),
}).init();

const notify = new CDBNotify({
    auth, api, model,
    debug:  fplus.debug,
});

mqtt?.run();
notify.run();
api.run();
