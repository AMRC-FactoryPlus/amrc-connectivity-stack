#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * CLI entrypoint to load JSON dumps.
 * Copyright 2022 AMRC.
 */

import fs from "fs";
import path from "path";
import process from "process";

import { Debug } from "@amrc-factoryplus/service-client";

import {Service} from "../lib/constants.js";
import Model from "../lib/model.js";

const debug = new Debug({ verbose: process.env.VERBOSE });
const log = debug.bound("boot");

/* XXX These JSON-loading functions are copied in from the old utilities
 * module; they are largely shared with acs-auth. Probably they should
 * be replaced with the YAML loaded pulled from acs-service-setup.
 */

function loadJsonObj (file) {
    const json = fs.readFileSync(file);
    let rv;
    try {
        rv = JSON.parse(json);
    }
    catch (e) {
        throw `JSON parse error in ${file}: ${e.message}`;
    }
    if (typeof(rv) != "object")
        throw `Not a JSON object: ${file}`;
    return rv;
}

function loadAllJson (files) {
    return files
        .map(f => [f, fs.statSync(f)])
        .filter(([f, s]) => s != undefined)
        .flatMap(([f, s]) => s.isDirectory()
            ? fs.readdirSync(f)
                .filter(f => f[0] != ".")
                .map(e => path.resolve(f, e))
            : [f])
        .map(f => [f, loadJsonObj(f)]);
}

const dumps = loadAllJson(process.argv.slice(2))
    .filter(([, d]) => d.service == Service.Registry);

const model = await new Model({ debug }).init();

for (const [file, dump] of dumps) {
    log(`Loading dump ${file}...`);
    const st = await model.dump_load(dump, false);
    if (st > 299) {
        log(`Dump failed to load: ${st}`);
        process.exit(1);
    }
}
log("Done.");
