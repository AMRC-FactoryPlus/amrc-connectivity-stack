#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import process from "process";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/utilities";
import { Git, Edge } from "../lib/uuids.js";

const UUID_SOURCES = { FP: UUIDs, G: Git, E: Edge };
const DUMPS = "dumps";

function resolve (str) {
    const cpts = str.split(".");
    let it = UUID_SOURCES;
    for (const c of cpts) {
        if (!(c in it))
            throw `UUID ref ${str} not found`;
        it = it[c];
    }
    return it;
}

const uuidTag = {
    tag:        "!u",
    resolve:    str => resolve(str),
};

const files = (await fs.readdir(DUMPS))
    .filter(f => f.endsWith(".yaml"))
    .map(f => f.slice(0, -5));

for (const f of files) {
    console.log(`Converting ${f}`);
    const yml = await fs.readFile(
        path.join(DUMPS, `${f}.yaml`),
        { encoding: "utf-8" });
    const data = yaml.parse(yml, null, { customTags: [uuidTag] });
    await fs.writeFile(
        path.join(DUMPS, `${f}.json`),
        JSON.stringify(data, null, 2));
}
console.log("Done");
