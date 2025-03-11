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

    /** Resolve a well-known name to a UUID.
     * This uses the uuids defined in service-client and also those
     * defined for service-setup. */
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
     * @param yaml The YAML string to parse.
     * @param file The filename, for error messages.
     * @return A JSON array of the parsed yaml files.
     */
    parse_yaml (text, file) {
        const { yamlOpts } = this;
        return yaml.parseAllDocuments(text, yamlOpts)
            .map(document => {
                if (document.errors.length)
                    throw new Error(`YAML error in ${file}`, {cause: document.errors});
                return document.toJS();
            });
    }

    /** Read all YAML files.
     * Reads all YAML files from the dumps dir. Filters based on the
     * supplied condition.
     * @param filter A condition applied to the file contents.
     * @returns A Map from filename to contents.
     */
    read_files (filter) {
        const { dumps } = this;
        return fsp.readdir(dumps)
            .then(l => l
                .filter(f => f.endsWith(".yaml"))
                .map(f => fsp.readFile(`${dumps}/${f}`, { encoding: "utf8" })
                    .then(c => [f, c])))
            .then(ps => Promise.all(ps))
            .then(es => es.filter(([f, t]) => filter(t)))
            .then(es => new Map(es));
    }

    /** Select and sort YAML files.
     * Reads all YAML files. Selects files based on `early` and `EARLY`
     * comments. Sorts based on `REQUIRE` comments.
     * @param early Include `EARLY`, or not-`EARLY`?
     * @returns A list of {file, yaml} objects.
     */
    async sort_files (early) {
        const yamls = await this.read_files(t => /^# EARLY/m.test(t) == early);

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

    /** Load a dump into the appropriate service.
     * We only support service versions which use the `/load` endpoint.
     */
    async load_dump (dump) {
        const { fplus } = this;
        const { service } = dump;

        if (!service)
            throw new Error("Dump is missing service!");

        const res = await fplus.Fetch.fetch({
            service,
            method:         "POST",
            url:            "/load",
            body:           JSON.stringify(dump),
            headers:        { "Content-Type": "application/json" },
        });
        return res.status;
    }

    async load_dumps (early) {
        const files = await this.sort_files(early);

        for (const f of files) {
            this.log("== %s", f.file);
            const ds = this.parse_yaml(f.yaml, f.file);
            for (const d of ds) {
                this.log("=== %s", d.service);
                const st = await this.load_dump(d);
                if (st > 300)
                    throw new Error(`Service dump ${f.file} failed: ${st}`);
            }
        }
    }
}
