import process from "process";
import util from "util";

import Ajv from "ajv/dist/2020.js";
import ajv_formats from "ajv-formats";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { read_all_files, parse_yaml } from "../lib/dumps.js";

const { dump_schema } = await import("../../acs-configdb/lib/dump-schema.js")
    .catch(e => null);
if (!dump_schema)
    console.log("!!! Cannot load ConfigDB dump schema");

const ajv = new Ajv();
ajv_formats(ajv);

const cdb_validate = dump_schema ? ajv.compile(dump_schema) : () => true;

const files = await read_all_files();
let exit = 0;

for (const f of files) {
    const fail = (cause, ...args) => {
        throw new Error(`${f.file}: ` + util.format(...args), { cause });
    };

    try { 
        const ds = parse_yaml(f);
        ds.filter(d => !d.service || !d.version)
            .forEach(d => fail(null, "Missing service or version"));
        ds.filter(d => d.service == UUIDs.Service.ConfigDB)
            .forEach(d => {
                if (!cdb_validate(d)) {
                    fail(cdb_validate.errors.map(util.inspect),
                        "Schema validation failed");
                }
            });
    } 
    catch (e) {
        exit = 1;
        const detail = Array.isArray(e.cause)
            ? ":\n\n" + e.cause.map(c => c.toString()).join("\n")
            : "";
        console.error("===> %s%s", e.message, detail);
    }
}

process.exit(exit);
