#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * CLI entrypoint to load JSON dumps.
 * Copyright 2022 AMRC.
 */

import process from "node:process";

import {loadAllJson} from "@amrc-factoryplus/utilities";

import {Service} from "../lib/constants.js";
import Model from "../lib/model.js";

const log = process.env.VERBOSE ? console.log : () => {};

const dumps = loadAllJson(process.argv.slice(2))
    .filter(([f, d]) => d.service == Service.Registry);

const model = await new Model({ log }).init();

for (const [file, dump] of dumps) {
    console.log(`Loading dump ${file}...`);
    const st = await model.dump_load(dump, false);
    if (st > 299)
        console.log(`Dump failed to load: ${st}`);
}
console.log("Done.");
