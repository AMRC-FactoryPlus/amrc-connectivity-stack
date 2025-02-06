import process from "process";
import util from "util";

import Ajv from "ajv/dist/2020.js";
import ajv_formats from "ajv-formats";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { read_all_files, parse_yaml } from "../lib/dumps.js";

const ajv = new Ajv();
ajv_formats(ajv);

function load_schema (dir) {
    return import(`../../${dir}/lib/dump-schema.js`)
        .then(sch => ajv.compile(sch.dump_schema))
        .catch(e => {
            console.log("!!! Cannot load dump schema for %s: %s", dir, e);
            return () => true;
        });
}

const schemas = [
    [UUIDs.Service.ConfigDB, "ConfigDB", await load_schema("acs-configdb")],
    [UUIDs.Service.Authentication, "Auth", await load_schema("acs-auth")],
];

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
        for (const [srv, name, validate] of schemas) {
            ds.filter(d => d.service == srv)
                .forEach(d => {
                    if (!validate(d))
                        fail(validate.errors.map(util.inspect),
                            `${name} schema validation failed`);
                });
        }
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
