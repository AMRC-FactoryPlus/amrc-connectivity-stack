/*
 * ACS Git server
 * Schema loader hook
 * Copyright 2025 University of Sheffield AMRC
 */

/* XXX The logic in here duplicates that in acs-schemas. As that is not
 * in the monorepo it's more difficult to factor out; probably we would
 * need a full @amrc-factoryplus/schema-loader module on NPM.
 */

import $fs from "fs";
import $fsp from "fs/promises";
import $path from "path";

import Walk from "@root/walk";
import git from "isomorphic-git";
import YAML from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

const App = {
    Schema:         "b16e85fb-53c2-49f9-8d83-cdf6763304ba",
    Metadata:       "32093857-9d29-470e-a897-d2b56d5aa978",
};
///const source = process.env.source_repo;

const path_rx = RegExp(`([\\w/_]+)-v(\\d+).yaml$`);

const load_yaml = async f => YAML.parse(
    await $fsp.readFile(f, { encoding: "utf8" }));

export class Schemas {
    constructor (opts) {
        this.dir    = opts.workdir;
        this.gitdir = opts.gitdir;
        this.source = opts.url;

        this.cdb    = opts.fplus.ConfigDB;
        this.log    = opts.fplus.debug.bound("schemas");
    }

    async run () {
        const yamls = await this.find_yamls();
        const schemas = await this.find_schemas(yamls);
        await this.load_schemas(schemas);
    }

    async find_yamls () {
        const yamls = new Map();

        const schemas = $path.join(this.dir, "schemas");
        await Walk.walk(schemas, async (err, fullpath, dirent) => {
            if (err) throw err;

            if (dirent.isDirectory()) return;

            const path = $path.relative(schemas, fullpath);
            const matches = path.match(path_rx);
            if (!matches)
                throw `Bad schema filename: ${path}`;
            const [, name, version] = matches;
            if (!name || !version)
                throw `Bad name or version for ${path}`;

            yamls.set(path, { name, version });
        });

        return yamls;
    }

    async find_schemas (yamls) {
        const configs = new Map();
        for (const [path, meta] of yamls.entries()) {
            this.log("Processing %s", path);

            const schema = await load_yaml(path);

            const uuid = schema.properties?.Schema_UUID?.const;
            if (schema.$id != `urn:uuid:${uuid}`)
                throw `Schema_UUID mismatch for ${path}`;
            this.log("Found Schema_UUID %s", uuid);

            const changes = (await git.log({
                fs:         $fs,
                gitdir:     this.gitdir,
                filepath:   `schemas/${path}`,
            })).map(l => l.commit.author.timestamp);

            configs.set(uuid, {
                metadata: {
                    ...meta,
                    created:    changes.at(-1),
                    modified:   changes.at(0),
                    source:     this.source,
                },
                schema,
            });
        }

        return configs;
    }

    async load_schemas (schemas) {
        const { cdb } = this;

        for (const [uuid, { metadata, schema }] of schemas.entries()) {
            this.log("Updating schema %s v%s (%s)", 
                metadata.name, metadata.version, uuid);

            const existing = await cdb.get_config(App.Metadata, uuid);
            if (existing && existing.source != this.source) {
                this.log("Schema %s comes from %s, skipping", uuid, existing.source);
                continue;
            }

            await cdb.create_object(UUIDs.Class.Schema, uuid);

            /* XXX It might be better to use the schema title here? But at the
             * moment those aren't unique. */
            const name = `${metadata.name} (v${metadata.version})`;
            await cdb.put_config(UUIDs.App.Info, uuid, { name });
            await cdb.put_config(App.Metadata, uuid, metadata);
            await cdb.put_config(App.Schema, uuid, schema);
        }
    }
}
