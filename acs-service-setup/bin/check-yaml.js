import process from "process";
import util from "util";

import { v4 as uuidv4 } from "uuid";

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

const local = {};

const dumps = new DumpLoader({
    dumps:      "dumps",
    acs_config: {
        organisation:   "ORG",
        namespace:      "factory-plus",
        secure:         "s",
        domain:         "my.domain",
        k8sdomain:      "cluster.local",
        directory:      "https://directory.my.domain",
        realm:          "MY.DOMAIN",
    },
    local:      str => local[str] ??= uuidv4(),
});

/* XXX */
let exit = 0;

function check_files (msg, files) {
    console.log("=> Checking %s dumps", msg);

    for (const f of files) {
        const fail = (cause, ...args) => {
            throw new Error(`${f.file}: ` + util.format(...args), { cause });
        };

        console.log("==> Checking %s", f.file);
        try { 
            const ds = dumps.parse_yaml(f.yaml, f.file);
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
}

check_files("early", await dumps.sort_files(true));
check_files("late", await dumps.sort_files(false));

process.exit(exit);
