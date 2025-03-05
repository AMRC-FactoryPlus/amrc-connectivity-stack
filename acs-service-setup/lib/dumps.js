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
    [UUIDs.Service.Directory,       "/load"],
]);

const UUID_SOURCES = { UUIDs, ...local_UUIDs };

export class DumpLoader {
    constructor (opts) {
        this.dumps  = opts.dumps;
        this.fplus  = opts.fplus;
        this.log    = opts.log || console.log;
        
        const acs = opts.acs_config;
        this.url_replacements = {
            NAMESPACE: acs.namespace,
            DOMAIN: acs.domain,
            PROTOCOL: acs.url_protocol,
        };

        this.yamlOpts = {
            customTags: [
                ["u",   this.resolveUUID],
                ["url", this.resolveURL],
            ].map(([t, f]) => ({ tag: `!${t}`, resolve: f.bind(this) })),
        };
    }

    resolveUUID (str) {
        const cpts = str.split(".");
        let it = UUID_SOURCES;
        for (const c of cpts) {
            if (!(c in it))
                throw new Error(`UUID ref ${str} not found`);
            it = it[c];
        }
        return it;
    }


    /**
     * Resolves the namespace in the yaml string with the ACS namespace or domain.
     * @param str The string to resolve.
     * @return {*} The resolved URL.
     */
    resolveURL (str) {
        const { url_replacements } = this;
        return str.replace(/\${(.*?)}/g, (match, key) => {
            if (!(key in url_replacements))
                throw new Error(`URL substitution ${key} not found`);
            return url_replacements[key];
        });
    }

    /**
     * Parses and converts yaml file to JSON.
     * @param file Yaml file to parse.
     * @return {Promise<any[]>} An JSON array of the parsed yaml files.
     */
    async load_yaml (file) {
        const { dumps, yamlOpts } = this;
        const yamlString = await fsp.readFile(`${dumps}/${file}`, { encoding: "utf8" });
        return yaml.parseAllDocuments(yamlString, yamlOpts)
            .map(document => {
                if (document.errors.length)
                    throw new Error(`YAML error in ${file}`, {cause: document.errors});
                return document.toJS();
            });
    }

    async load_dump (dump) {
        const { fplus } = this;
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

    async for_all_dumps (filter, next) {
        const files = await fsp.readdir(this.dumps);
        files.sort();

        for (const file of files) {
            if (!file.endsWith(".yaml")) continue;
            this.log("== %s", file);
            const documents = await this.load_yaml(file);
            for (const document of documents) {
                if (filter(document))
                    await next(file, document);
            }
        }
    }

    load_dumps (early) {
        const { Directory } = UUIDs.Service;

        return this.for_all_dumps(
            d => (d.service == Directory) == early,
            async (file, document) => {
                this.log("=== %s", document.service);
                const status = await this.load_dump(document);
                if (status > 300)
                    throw new Error(`Service dump ${file} failed: ${status}`);
            });
    }
}
