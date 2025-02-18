/* ACS service setup
 * Service dumps
 * Copyright 2023 AMRC
 */

import fsp from "fs/promises";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import * as local_UUIDs from "./uuids.js";

/* Grr who made these different? */
const Paths = new Map([
    [UUIDs.Service.Authentication,  "/authz/load"],
    [UUIDs.Service.ConfigDB,        "/v1/load"],
    [UUIDs.Service.Directory,       "/v1/load"],
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

/**
 * Resolves the namespace in the yaml url with the ACS namespace.
 * @param directoryDump Directory json object parsed from the input yaml.
 * @param serviceSetup Instance of service setup.
 * @return {*} The directory dump with resolved URLs.
 */
function resolveNamespace (directoryDump, serviceSetup) {
    const replacements = {
        namespace: serviceSetup.namespace,
        domain: serviceSetup.acs_config.domain,
    }
    directoryDump.advertisements = directoryDump.advertisements.map((advertisement)=> {
        advertisement.url = advertisement.url.replace(/\${(.*?)}/g, (match, key) => {
            return replacements[key] || match; // Replace if key exists, otherwise keep original placeholder
        });
        return advertisement;
    });
    return directoryDump;
}

/**
 * Parses and converts yaml file to JSON.
 * @param file Yaml file to parse.
 * @return {Promise<any[]>} An JSON array of the parsed yaml files.
 */
export async function load_yaml (file) {
    const yamlString = await fsp.readFile(`dumps/${file}`, { encoding: "utf8" });
    return yaml.parseAllDocuments(yamlString, yamlOpts)
        .map(document => {
            if (document.errors.length)
                throw new Error(`YAML error in ${file}`, {cause: document.errors});
            return document.toJS();
        });
}

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

export async function load_dumps (serviceSetup) {
    // service client
    const { fplus } = serviceSetup;

    const files = await fsp.readdir("dumps");
    files.sort();

    for (const file of files) {
        if (!file.endsWith(".yaml")) continue;
        serviceSetup.log("== %s", file);
        const documents = await load_yaml(file);
        for (let document of documents) {
            if(document.service === UUIDs.Service.Directory){
                continue;
            }
            serviceSetup.log("=== %s", document.service);
            const status = await load_dump(fplus, document);
            if (status > 300)
                throw new Error(`Service dump ${file} failed: ${status}`);
        }
    }
}

export async function load_directory_dump (serviceSetup) {
    // service client
    const { fplus } = serviceSetup;
    const documents = await load_yaml("00_service-urls.yaml");
    for (let document of documents) {
        serviceSetup.log("=== %s", document.service);
        if(document.service !== UUIDs.Service.Directory){
            continue;
        }
        document = resolveNamespace(document, serviceSetup);
        const status = await load_dump(fplus, document);
        if (status > 300)
            throw new Error(`Service dump failed: ${status}`);
    }
}
