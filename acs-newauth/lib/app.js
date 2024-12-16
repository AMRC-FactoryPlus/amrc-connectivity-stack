/*
 * ACS Auth service
 * Main app class
 * Copyright 2024 University of Sheffield AMRC
 */

import { WebAPI }           from "@amrc-factoryplus/service-api";
import { Debug, UUIDs }     from "@amrc-factoryplus/service-client";
import { RxClient }         from "@amrc-factoryplus/rx-client";

import { GIT_VERSION }      from "./git-version.js";

import { Auth }             from "./authz.js";
import { Model }            from "./model.js";
import { AuthNotify }       from "./notify.js";
import { TemplateEngine }   from "./templates.js";

/* This is the F+ service spec version */
const Version = "1.0.0";

export class App {
    constructor (env) {

        const fplus = this.fplus = new RxClient({ env });
        const { debug } = fplus;

        const auth = new Auth();
        const model = this.model = new Model({ auth, debug });

        const api = this.api = new WebAPI({
            ping:       {
                version:    Version,
                service:    UUIDs.Service.Authentication,
                software: {
                    vendor:         "AMRC",
                    application:    "acs-auth",
                    revision:       GIT_VERSION,
                },
            },
            debug,
            realm:      process.env.REALM,
            hostname:   process.env.HOSTNAME,
            keytab:     process.env.SERVER_KEYTAB,
            http_port:  process.env.PORT ?? 80,
            max_age:    process.env.CACHE_MAX_AGE ?? 60,
            routes: app => {
            },
        });

        this.engine = new TemplateEngine({ fplus });

        this.notify = new AuthNotify({
            auth, api, fplus,
            log:    debug.bound("notify"),
        });
    }

    async init () {
        await this.model.init();
        await this.api.init();
    }

    run () {
        this.api.run();
        this.engine.run();
        this.notify.run();
    }
}
