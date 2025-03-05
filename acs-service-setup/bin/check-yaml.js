import process from "process";
import util from "util";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";

function load_schema (dir) {
    return import(`../../${dir}/lib/dump-schema.js`)
        .then(sch => sch.dump_schema)
        .catch(e => {
            console.log("!!! Cannot load dump schema for %s: %s", dir, e);
            return () => true;
        });
}

const schemas = [
    [UUIDs.Service.ConfigDB, "ConfigDB", await load_schema("acs-configdb")],
    [UUIDs.Service.Authentication, "Auth", await load_schema("acs-auth")],
];

const dumps = new DumpLoader({
    dumps:      "dumps",
    acs_config: {
        namespace:      "factory-plus",
        url_protocol:   "https",
        domain:         "my.domain",
    }});

const files = await dumps.read_files(() => true);
let exit = 0;

for (const [file, text] of files.entries()) {
    const fail = (cause, ...args) => {
        throw new Error(`${file}: ` + util.format(...args), { cause });
    };

    try { 
        const ds = dumps.parse_yaml(text, file);
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
