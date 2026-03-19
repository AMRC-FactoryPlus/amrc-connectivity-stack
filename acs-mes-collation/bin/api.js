#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) MES Collation service
 * Application entrypoint
 */

import { RxClient }         from "@amrc-factoryplus/rx-client";
import { WebAPI }           from "@amrc-factoryplus/service-api";

import { GIT_VERSION } from "../lib/git-version.js";
import { Service, Version } from "../lib/constants.js";

import { Auth } from "../lib/auth.js";
import Model from "../lib/model.js";
import { MESNotify } from "../lib/notify.js";
import { routes } from "../lib/routes.js";

const { env } = process;

const fplus = await new RxClient({ env }).init();
const auth = new Auth({ fplus });
const model = await new Model({ auth, fplus }).init();

const api = await new WebAPI({
    ping: {
        version:    Version,
        service:    Service.MESCollation,
        device:     env.DEVICE_UUID,
        software: {
            vendor:         "AMRC",
            application:    "acs-mes-collation",
            revision:       GIT_VERSION,
        },
    },
    debug:      fplus.debug,
    realm:      env.REALM,
    hostname:   env.HOSTNAME,
    keytab:     env.SERVER_KEYTAB,
    http_port:  env.PORT,
    max_age:    env.CACHE_MAX_AGE,

    routes:     routes({ auth, model, fplus }),
}).init();

const notify = new MESNotify({
    auth, api, model,
    debug: fplus.debug,
});

notify.run();
api.run();
