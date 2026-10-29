#!/usr/bin/env node

/*
 * ACS Briefcase exporter
 * Entry point
 * Copyright 2026 University of Sheffield
 */

import { RxClient } from "@amrc-factoryplus/rx-client";

import { GIT_VERSION } from "../lib/git-version.js";
import { Exporter } from "../lib/exporter.js";

const { env } = process;

const fplus = await new RxClient({ env }).init();
fplus.debug.log("app", "Starting acs-briefcase, revision %s", GIT_VERSION);

const exporter = new Exporter({ fplus });

exporter.run();
