/* ACS service setup
 * Service dumps
 * Copyright 2023 AMRC
 */

import fsp from "fs/promises";

import tsort from "tsort";
import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import * as ss_UUIDs from "./uuids.js";


export class DumpLoader {
    constructor (opts) {
        this.dumps  = opts.dumps;
        this.fplus  = opts.fplus;
        this.log    = opts.log || console.log;
        this.local  = opts.local;
        
        this.acs_config = opts.acs_config;

        this.uuid_sources = { UUIDs, ...ss_UUIDs };
        this.yamlOpts = {
            customTags: [
                ["u",   this.resolveUUID],
                ["acs", this.resolveACS],
            ].map(([t, f]) => ({ tag: `!${t}`, resolve: f.bind(this) })),
        };
    }

    /** Resolve a well-known name to a UUID.
     * This uses the uuids defined in service-client and also those
     * defined for service-setup. */
    resolveUUID (str) {
        const cpts = str.split(".");

        /* Override Local UUIDs for linting */
        if (cpts[0] == "Local" && this.local)
            return this.local(str);

        let it = this.uuid_sources;
        for (const c of cpts) {
            if (!(c in it))
                throw new Error(`UUID ref ${str} not found`);
            it = it[c];
        }
        return it;
    }


    /** Expand parameters from the ACS config.
     * Substitutions of the form `${x}` will be expanded from our ACS
     * config.
     * @param str The string to expand.
     * @return {*} The expanded string.
     */
    resolveACS (str) {
        const { acs_config } = this;
        return str.replace(/\${(.*?)}/g, (match, key) => {
            if (!(key in acs_config))
                throw new Error(`ACS config key ${key} not found`);
            return acs_config[key];
        });
    }

    /** Update our local UUIDs.
     * Set the object used to resolve `Local` UUIDs.
     * @param uuids The `Local` UUIDs.
     */
    set_local_uuids (uuids) {
        this.uuid_sources.Local = uuids;
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
        const yamls = await this.read_files(t => /^#-EARLY/m.test(t) == early);

        const graph = tsort();
        [...yamls.entries()]
            .map(([f, t]) => [f, t.match(/^#-REQUIRE:\s+(.*)/m)?.[1]])
            .filter(m => m[1])
            .flatMap(([f, m]) => m.split(/\s+/)
                .map(d => [`${d}.yaml`, f]))
            .forEach(e => graph.add(e));
        [...yamls.keys()]
            .forEach(f => graph.add(f));

        return graph.sort()
            .map(name => ({ name, yaml: yamls.get(name) }));
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

    async load_from_file (yaml, name) {
        this.log("== %s", name);
        const ds = this.parse_yaml(yaml, name);
        for (const d of ds) {
            this.log("=== %s", d.service);
            const st = await this.load_dump(d);
            if (st > 300)
                throw new Error(`Service dump ${name} failed: ${st}`);
        }
    }

    async load_dumps (early) {
        const files = await this.sort_files(early);

        for (const f of files)
            await this.load_from_file(f.yaml, f.name);
    }
}
