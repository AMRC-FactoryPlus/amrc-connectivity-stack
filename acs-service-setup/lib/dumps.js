/* ACS service setup
 * Service dumps
 * Copyright 2023 AMRC
 */

import fsp from "fs/promises";

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

export async function load_yaml (f) {
    const y = await fsp.readFile(`dumps/${f}`, { encoding: "utf8" });
    const ds = yaml.parseAllDocuments(y, yamlOpts)
        .map(d => {
            if (d.errors.length)
                throw new Error(`YAML error in ${f}`, { cause: d.errors });
            return d.toJS();
        });
    return ds;
}

export async function load_dump (fplus, dump) {
    const { service, version } = dump;
    const { Authentication, ConfigDB } = UUIDs.Service;

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

    const files = await fsp.readdir("dumps");
    files.sort();

    for (const f of files) {
        if (!f.endsWith(".yaml")) continue;
        ss.log("== %s", f);
        const ds = await load_yaml(f);
        for (const d of ds) {
            ss.log("=== %s", d.service);
            const st = await load_dump(fplus, d);
            if (st > 300)
                throw new Error(`Service dump ${f} failed: ${st}`);
        }
    }
}
