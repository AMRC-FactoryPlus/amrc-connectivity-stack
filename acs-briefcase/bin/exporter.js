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

const exporter = new Exporter({ fplus, builder });

exporter.run();
