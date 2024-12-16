#!/usr/bin/env node

/*
 * ACS Authorisation component
 * Main entry point
 * Copyright 2024 University of Sheffield AMRC
 */

import { App } from "../lib/app.js";

const app = new App(process.env);
await app.init();
app.run();

