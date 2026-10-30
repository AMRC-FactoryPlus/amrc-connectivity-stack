/*
 * ACS Briefcase exporter
 * Build a sample briefcase from fake services, for check.py
 * Copyright 2026 University of Sheffield
 *
 * Usage: node test/validate/make-sample.js <output dir>
 */

import { Readable } from "node:stream";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { Builder } from "../../lib/builder.js";
import { App } from "../../lib/constants.js";

const DATASET = "11111111-1111-4111-8111-111111111111";
const LATHE = "a0000000-0000-4000-8000-000000000000";
const OVEN = "b0000000-0000-4000-8000-000000000000";

const META = {
    uuid: DATASET,
    name: "Sample trial",
    from: "2026-10-14T08:00:00.000Z",
    to: "2026-10-14T12:00:00.000Z",
    metadata: {
        [App.ReleasePolicy]: {
            tier: "approved-project",
            data_owner: {
                organisation: "AMRC",
                contact: { name: "Data Owner", email: "owner@example.ac.uk" },
            },
            terms: { agreement: "DSA-2026-014" },
            permitted_use: "Non-commercial research.",
            review_by: "2027-10-29",
        },
        [App.Tags]: { tags: ["sample"] },
        [App.RunMetadata]: { description: "A sample of every value type" },
    },
};

/* Every value type, with the awkward cases: nanosecond timestamps that
 * InfluxDB trims, 64-bit integers past 2^53, and strings that need
 * quoting. */
function csv () {
    const rows = ["device,metric,timestamp,value,unit,device_uuid,path,type"];
    for (let i = 0; i < 500; i++) {
        const s = String(i % 60).padStart(2, "0");
        rows.push(`Lathe,Actual,2026-10-14T09:${s}:00.${i}Z,${(i / 7).toFixed(4)},mm,${LATHE},Axes/X/Position,double`);
        rows.push(`Oven,Door_Open,2026-10-14T09:${s}:01.123456789Z,${i % 2 == 0},,${OVEN},,boolean`);
    }
    rows.push(`Lathe,Count,2026-10-14T10:00:00Z,18446744073709551615,,${LATHE},,uint`);
    rows.push(`Lathe,Offset,2026-10-14T10:00:00.000000001Z,-9007199254740993,mm,${LATHE},,int`);
    rows.push(`Oven,Note,2026-10-14T10:00:00.5Z,"a, ""quoted""\nnote",,${OVEN},Log,string`);
    return rows.join("\n") + "\n";
}

const fplus = {
    debug: { bound: () => () => {} },
    DataAccess: {
        get_single_metadata: async () => META,
        fetch: async () => [200, Readable.from([csv()])],
    },
    ConfigDB: {
        get_config: async (app, obj) => {
            if (app == UUIDs.App.Info)
                return { name: obj == LATHE ? "Lathe 3" : "Oven 1" };
            return { originMap: obj == LATHE
                ? { Axes: { X: { Position: { Actual: {
                    Sparkplug_Type: "Double", Record_To_Historian: true, Eng_Unit: "mm",
                } } } } }
                : { Door_Open: { Sparkplug_Type: "Boolean", Record_To_Historian: true } } };
        },
    },
};

const built = await new Builder({
    fplus,
    work_dir:   process.argv[2],
    exporter:   "sample",
    source:     { organisation: "AMRC", url: "https://factoryplus.example.ac.uk" },
}).build(DATASET);

console.log(built.file);
