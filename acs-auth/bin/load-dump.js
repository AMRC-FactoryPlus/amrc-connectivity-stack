#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * CLI entrypoint to load JSON dumps
 * Copyright 2022 AMRC.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Debug, UUIDs } from "@amrc-factoryplus/service-client";

import Model from "../lib/model.js";

function loadJSONobj (file) {
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

const dumps = process.argv.slice(2)
    .map(f => [f, fs.statSync(f)])
    .filter(([f, s]) => s != undefined)
    .flatMap(([f, s]) => s.isDirectory()
        ? fs.readdirSync(f)
            .filter(f => f[0] != ".")
            .map(e => path.resolve(f, e))
        : [f])
    .map(f => [f, loadJSONobj(f)])
    .filter(([f, d]) => d.service == UUIDs.Service.Authentication);

const debug = new Debug({ verbose: process.env.VERBOSE });
const model = await new Model({ debug }).init();

for (const [file, dump] of dumps) {
    console.log(`Loading dump ${file}...`);
    const st = await model.dump_load(dump);
    if (st > 299)
        console.log(`Dump failed to load: ${st}`);
}
console.log("Done.");
