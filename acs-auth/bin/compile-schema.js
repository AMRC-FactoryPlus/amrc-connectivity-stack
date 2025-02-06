/* Compile dump schema using AJV */

import fsp from "fs/promises";
import yaml from "yaml";

import Ajv from "ajv";
import ajv_sa from "ajv/dist/standalone/index.js";
import ajv_formats from "ajv-formats";

const schema = await fsp.readFile("dump-schema.yaml", { encoding: "utf8" })
    .then(d => yaml.parse(d));

schema.$id = "dump_schema";

const ajv = new Ajv({
    schemas: [schema],
    code: { source: true, esm: true },
});
ajv_formats(ajv);

await fsp.writeFile("lib/dump-schema.js", ajv_sa(ajv));
