#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import { App }          from "../lib/app.js";
import { GIT_VERSION }  from "../lib/git-version.js";

console.log("Running Edge Deployment Operator revision %s", GIT_VERSION);

const app = await new App(process.env).init();
app.run();
