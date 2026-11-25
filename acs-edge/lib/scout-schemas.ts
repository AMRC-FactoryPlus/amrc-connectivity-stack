/*
 * ACS Edge Agent
 * Compiled validators for the Edge Scout JSON Schemas
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import { createRequire } from "module";
import path from "path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const PACKAGE = "@amrc-factoryplus/edge-scout-schemas";

/* The schemas this agent validates against, by short name. The
 * package's lib/index.js lists the same names, but it is an ES module
 * that uses import.meta, which the jest build of this agent can't
 * load, so the agent reads the schema files itself. */
const NAMES = [
    "common", "addr", "ncmd", "request", "found", "item", "status", "values",
    "snapshot-header", "snapshot-end", "snapshot-line",
];

export type Validator = ((data: unknown) => boolean) & { errors?: any };

/* Where the schema files are. SCOUT_SCHEMA_DIR overrides it, for a
 * build that puts them somewhere else. The package is found from the
 * working directory, as the agent runs from its own directory. */
export function schema_dir (): string {
    if (process.env.SCOUT_SCHEMA_DIR)
        return process.env.SCOUT_SCHEMA_DIR;
    const req = createRequire(path.join(process.cwd(), "index.js"));
    return path.join(path.dirname(req.resolve(`${PACKAGE}/package.json`)), "schemas");
}

export class ScoutSchemas {
    #ajv: any
    #cache: Map<string, Validator> = new Map()

    constructor (dir: string = schema_dir()) {
        const ajv = this.#ajv = new Ajv2020({ allErrors: false });
        addFormats(ajv);
        for (const name of NAMES) {
            const file = path.join(dir, `${name}.schema.json`);
            ajv.addSchema(JSON.parse(fs.readFileSync(file, "utf8")));
        }
        /* Compile every validator now, so a broken schema stops the
         * agent at start-up rather than at the first scan. */
        for (const name of NAMES)
            this.get(name);
    }

    get (name: string): Validator {
        let v = this.#cache.get(name);
        if (!v) {
            v = this.#ajv.getSchema(`urn:edge-scout:${name}`) as Validator;
            if (!v) throw new Error(`No Edge Scout schema ${name}`);
            this.#cache.set(name, v);
        }
        return v;
    }

    /* Validate, and return null or the first error as text. */
    check (name: string, data: unknown): string | null {
        const v = this.get(name);
        if (v(data)) return null;
        return this.#ajv.errorsText(v.errors, { dataVar: name });
    }
}

let shared: ScoutSchemas | undefined;

/* One set of compiled validators for the process. */
export function scout_schemas (): ScoutSchemas {
    return shared ??= new ScoutSchemas();
}
