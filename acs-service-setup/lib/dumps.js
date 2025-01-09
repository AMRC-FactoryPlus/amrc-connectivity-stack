/* ACS service setup
 * Service dumps
 * Copyright 2023 AMRC
 */

import fsp from "fs/promises";

import tsort from "tsort";
import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import * as local_UUIDs from "./uuids.js";

const UUID_SOURCES = { UUIDs, ...local_UUIDs };

function resolve (str) {
    const cpts = str.split(".");
    let it = UUID_SOURCES;
    for (const c of cpts) {
        if (!(c in it))
            throw new Error(`UUID ref ${str} not found`);
        it = it[c];
    }
    return it;
}

const yamlOpts = {
    customTags: [
        {
            tag:        "!u",
            resolve:    str => resolve(str),
        },
    ],
};

export function parse_yaml (f) {
    const ds = yaml.parseAllDocuments(f.yaml, yamlOpts)
        .map(d => {
            if (d.errors.length)
                throw new Error(`YAML error in ${f.file}`, { cause: d.errors });
            return d.toJS();
        });
    return ds;
}

export async function read_all_files () {
    const yamls = await fsp.readdir("dumps")
        .then(l => l
            .filter(f => f.endsWith(".yaml"))
            .map(f => fsp.readFile(`dumps/${f}`, { encoding: "utf8" })
                .then(c => [f, c])))
        .then(ps => Promise.all(ps))
        .then(es => new Map(es));

    const graph = tsort();
    [...yamls.entries()]
        .map(([f, t]) => [f, t.match(/^# REQUIRE:\s+(.*)/m)?.[1]])
        .filter(m => m[1])
        .flatMap(([f, m]) => m.split(/\s+/)
            .map(d => [`${d}.yaml`, f]))
        .forEach(e => graph.add(e));
    [...yamls.keys()]
        .forEach(f => graph.add(f));

    return graph.sort()
        .map(file => ({ file, yaml: yamls.get(file) }));
}

export async function load_dump (fplus, dump) {
    const { service, version } = dump;
    const { Authentication, ConfigDB } = UUIDs.Service;

    if (!service || !version)
        throw new Error("Dump is missing service or version!");

    /* I am standardising a new /load endpoint. Legacy dumps need to
     * be loaded via the legacy endpoints. */
    const url = 
        service == Authentication && version == 1   ? "/authz/load"
        : service == ConfigDB && version == 1       ? "/v1/load"
        : "/load";

    const query = service == ConfigDB && version == 1
        ? { overwrite: dump.overwrite ? "true" : "false" }
        : {};

    const res = await fplus.Fetch.fetch({
        service, url, query,
        method:         "POST",
        body:           JSON.stringify(dump),
        headers:        { "Content-Type": "application/json" },
    });
    return res.status;
}

export async function load_dumps (ss) {
    const { fplus } = ss;

    const files = await read_all_files();

    for (const f of files) {
        ss.log("== %s", f.file);
        const ds = parse_yaml(f);
        for (const d of ds) {
            ss.log("=== %s", d.service);
            const st = await load_dump(fplus, d);
            if (st > 300)
                throw new Error(`Service dump ${f.file} failed: ${st}`);
        }
    }
}
