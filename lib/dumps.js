/* ACS service setup
 * Service dumps
 * Copyright 2023 AMRC
 */

import fsp from "fs/promises";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/utilities";

import * as local_UUIDs from "./uuids.js";

/* Grr who made these different? */
const Paths = new Map([
    [UUIDs.Service.Authentication,  "/authz/load"],
    [UUIDs.Service.ConfigDB,        "/v1/load"],
]);

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

async function load_dump (fplus, dump) {
    const { service } = dump;

    const url = Paths.get(service);
    if (url == undefined)
        throw new Error(`Unrecognised service UUID ${service}`);

    /* The ConfigDB should accept this in the dump */
    const query = service == UUIDs.Service.ConfigDB
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
        ss.log("== %s", f);
        const y = await fsp.readFile(`dumps/${f}`, { encoding: "utf8" });
        const ds = yaml.parseAllDocuments(y, yamlOpts)
            .map(d => d.toJS());
        for (const d of ds) {
            ss.log("=== %s", d.service);
            const st = await load_dump(fplus, d);
            if (st > 300)
                throw new Error(`Service dump ${f} failed: ${st}`);
        }
    }
}
