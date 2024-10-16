import $fs from "fs/promises";

import { GIT_VERSION }  from "../lib/git-version.js";
import { ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";

const App = {
    Schema:         "b16e85fb-53c2-49f9-8d83-cdf6763304ba",
    Metadata:       "32093857-9d29-470e-a897-d2b56d5aa978",
};
const Class = {
    Private:        "eda329ca-4e55-4a92-812d-df74993c47e2",
};

console.log(`ACS schemas revision ${GIT_VERSION}`);

const schemas = JSON.parse(await $fs.readFile("schemas.json"));

const fplus = await new ServiceClient({ env: process.env }).init();
const cdb = fplus.ConfigDB;
const log = fplus.debug.bound("schemas");

/* Set a ConfigDB entry without allowing overwrite. We must use
 * If-None-Match here to avoid race conditions. */
async function maybe_put (app, obj, conf) {
    const [st] = await cdb.fetch({
        method:     "PUT",
        url:        `/v1/app/${app}/object/${obj}`,
        headers:    {
            "If-None-Match": "*",
        },
        body:       conf,
    });
    /* We succeeded or failed correctly */
    if (st == 201 || st == 412) return;
    /* We overwrote an existing entry */
    if (st == 204)
        throw new Error("Unexpected 204 response from ConfigDB PUT");
    /* Throw as though this was the CDB interface */
    cdb.throw(`Can't set ${app} for ${obj}`, st);
}

log("Creating required Apps");
await cdb.create_object(UUIDs.Class.App, App.Schema);
await cdb.put_config(UUIDs.App.Info, App.Schema,
    { name: "JSON schema" });
await cdb.create_object(UUIDs.Class.App, App.Metadata);
await cdb.put_config(UUIDs.App.Info, App.Metadata,
    { name: "Metric schema info" });

log("Creating required Classes");
await cdb.create_object(UUIDs.Class.Class, Class.Private);
await cdb.put_config(UUIDs.App.Info, Class.Private,
    { name: "Private configuration" });

for (const [uuid, { metadata, schema }] of Object.entries(schemas)) {
    log("Updating schema %s v%s (%s)", 
        metadata.name, metadata.version, uuid);

    await cdb.create_object(UUIDs.Class.Schema, uuid);

    /* XXX It might be better to use the schema title here? But at the
     * moment those aren't unique. */
    const name = `${metadata.name} (v${metadata.version})`;
    await maybe_put(UUIDs.App.Info, uuid, { name });
    await maybe_put(App.Metadata, uuid, metadata);
    await maybe_put(App.Schema, uuid, schema);
}

/* These entries are PUT unconditionally. */

const priv = JSON.parse(await $fs.readFile("private.json"));

for (const [uuid, schema] of Object.entries(priv)) {
    const name = schema.title ?? uuid;
    log("Updating private schema %s", name);
    await cdb.create_object(Class.Private, uuid);
    if (schema.title)
        await cdb.put_config(UUIDs.App.Info, uuid, { name: schema.title });
    await cdb.put_config(App.Schema, uuid, schema);
}

log("Done");
