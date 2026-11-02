#!/usr/bin/env node

/*
 * ACS Briefcase exporter
 * Entry point
 * Copyright 2026 University of Sheffield
 */

import os from "node:os";

import { RxClient } from "@amrc-factoryplus/rx-client";

import { GIT_VERSION } from "../lib/git-version.js";
import { Builder } from "../lib/builder.js";
import { Exporter } from "../lib/exporter.js";
import { Store } from "../lib/store.js";
import { UNSPublisher } from "../lib/uns.js";

const { env } = process;

const fplus = await new RxClient({ env }).init();
fplus.debug.log("app", "Starting acs-briefcase, revision %s", GIT_VERSION);

const builder = new Builder({
    fplus,
    work_dir:   env.WORK_DIR ?? os.tmpdir(),
    exporter:   GIT_VERSION,
    source: {
        organisation:   env.SOURCE_ORGANISATION,
        url:            env.SOURCE_URL,
    },
});

/* RETRY_INTERVAL is in seconds. */
const retry = (Number(env.RETRY_INTERVAL) || 300) * 1000;

const exporter = new Exporter({
    fplus, builder, retry,
    store:      new Store({ fplus }),
    exporter:   GIT_VERSION,
});

/* Publishing to the UNS is off unless UNS_PUBLISH is "true". */
let uns = null;
if (env.UNS_PUBLISH == "true") {
    if (!env.UNS_FALLBACK_ENTERPRISE)
        throw new Error("UNS_PUBLISH needs UNS_FALLBACK_ENTERPRISE");
    uns = new UNSPublisher({
        fplus, retry,
        enterprise: env.UNS_FALLBACK_ENTERPRISE,
    });
}

exporter.run();
uns?.run();
