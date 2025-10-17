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

const Service_Cmdesc = "78ea7071-24ac-4916-8351-aa3e549d8ccd";
/* This is the service spec version, not the implementation version */
const Version = "1.0.2";

const fplus = new RxClient({ env: process.env });

const cmdesc = new CmdEscD({ fplus });

const v1 = await new ApiV1({ cmdesc });

const web = await new WebAPI({
    ping:       {
        version:    Version,
        service:    Service_Cmdesc,
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

cmdesc.run();
web.run();
