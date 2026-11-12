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
import { Delivery, open_container } from "../lib/delivery.js";
import { Exporter } from "../lib/exporter.js";
import { Store } from "../lib/store.js";

const { env } = process;

const fplus = await new RxClient({ env }).init();
fplus.debug.log("app", "Starting acs-briefcase, revision %s", GIT_VERSION);

const work_dir = env.WORK_DIR ?? os.tmpdir();
const source = {
    organisation:   env.SOURCE_ORGANISATION,
    url:            env.SOURCE_URL,
};

const builder = new Builder({
    fplus, work_dir, source,
    exporter:   GIT_VERSION,
});

/* Briefcases are delivered to the sharing platform only if its ingest
 * container is set. The URL carries a SAS token, or the AZURE_
 * variables name a service principal. */
let delivery;
if (env.DELIVERY_URL) {
    const container = await open_container({
        url:        env.DELIVERY_URL,
        tenant:     env.AZURE_TENANT_ID,
        client:     env.AZURE_CLIENT_ID,
        secret:     env.AZURE_CLIENT_SECRET,
    });
    delivery = new Delivery({ fplus, container, work_dir, source });
    fplus.debug.log("app", "Delivering briefcases to %s",
        container.url.split("?")[0]);
}

const exporter = new Exporter({
    fplus, builder, delivery,
    store:      new Store({ fplus }),
    exporter:   GIT_VERSION,
    /* RETRY_INTERVAL is in seconds. */
    retry:      (Number(env.RETRY_INTERVAL) || 300) * 1000,
});

exporter.run();
