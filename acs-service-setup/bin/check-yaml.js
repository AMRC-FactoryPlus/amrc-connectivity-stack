import fsp from "fs/promises";
import process from "process";
import util from "util";

import Ajv from "ajv/dist/2020.js";
import ajv_formats from "ajv-formats";

import { UUIDs } from "@amrc-factoryplus/service-client";

import {load_yaml} from "../lib/dumps.js";

const { dump_schema } = await import("../../acs-configdb/lib/dump-schema.js")
    .catch(e => null);
if (!dump_schema)
    console.log("!!! Cannot load ConfigDB dump schema");

const ajv = new Ajv();
ajv_formats(ajv);

const cdb_validate = dump_schema ? ajv.compile(dump_schema) : () => true;

const files = await fsp.readdir("dumps");
let exit = 0;

for (const f of files) {
    if (!f.endsWith(".yaml"))
        continue;
    try { 
        const ds = await load_yaml(f);
        ds.filter(d => d.service == UUIDs.Service.ConfigDB)
            .forEach(d => {
                if (!cdb_validate(d)) {
                    throw new Error(`Schema validation failed for ${f}`, { 
                        cause: cdb_validate.errors.map(util.inspect),
                    });
                }
            });
    } 
    catch (e) {
        exit = 1;
        console.error("===> %s:\n\n%s", e.message, 
            e.cause.map(c => c.toString()).join("\n"));
    }
}

process.exit(exit);
