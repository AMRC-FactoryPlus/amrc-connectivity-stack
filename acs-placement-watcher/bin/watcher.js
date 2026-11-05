#!/usr/bin/env node

/*
 * ACS ISA-95 placement watcher
 * Application entrypoint
 * Copyright 2026 University of Sheffield AMRC
 */

import { RxClient }         from "@amrc-factoryplus/rx-client";

import { GIT_VERSION }      from "../lib/git-version.js";
import { PlacementWatcher } from "../lib/watcher.js";

console.log("Starting ACS ISA-95 placement watcher, revision %s", GIT_VERSION);

const { env } = process;

const fplus = await new RxClient({ env }).init();

const watcher = new PlacementWatcher({
    fplus,
    debounce:   env.DEBOUNCE_MS ? Number(env.DEBOUNCE_MS) : undefined,
});

watcher.run();
