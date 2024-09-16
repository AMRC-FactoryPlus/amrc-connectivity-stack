import $fs from "fs/promises";

import { GIT_VERSION }  from "../lib/git-version.js";
import { ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";

const App = {
    Schema:         "b16e85fb-53c2-49f9-8d83-cdf6763304ba",
    Metadata:       "32093857-9d29-470e-a897-d2b56d5aa978",
};

console.log(`ACS schemas revision ${GIT_VERSION}`);

const schemas = JSON.parse(await $fs.readFile("schemas.json"));

const fplus = await new ServiceClient({ env: process.env }).init();
const cdb = fplus.ConfigDB;
const log = fplus.debug.bound("schemas");

log("Creating required Apps");
await cdb.create_object(UUIDs.Class.App, App.Schema);
await cdb.put_config(UUIDs.App.Info, App.Schema,
    { name: "Metric schema" });
await cdb.create_object(UUIDs.Class.App, App.Metadata);
await cdb.put_config(UUIDs.App.Info, App.Metadata,
    { name: "Metric schema metadata" });

for (const [uuid, { metadata, schema }] of Object.entries(schemas)) {
    log("Updating schema %s v%s (%s)", 
        metadata.name, metadata.version, uuid);

    await cdb.create_object(UUIDs.Class.Schema, uuid);

    /* XXX It might be better to use the schema title here? But at the
     * moment those aren't unique. */
    const name = `${metadata.name} (v${metadata.version})`;
    await cdb.put_config(UUIDs.App.Info, uuid, { name });
    await cdb.put_config(App.Metadata, uuid, metadata);
    await cdb.put_config(App.Schema, uuid, schema);
}

log("Done");
