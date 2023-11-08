/* Validate JSON schemas */

import $fsp from "fs/promises";
import $path from "path";
import $process from "process";

import Ajv2020 from "ajv/dist/2020.js";
import formats from "ajv-formats";
import Walk from "@root/walk";

const baseURL = "https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/";

let exit = 0;
function error (...args) {
    console.log(...args);
    exit = 1;
}

function loadJSON (path) {
    return $fsp.readFile(path, { encoding: "utf-8" })
        .then(JSON.parse);
}

function pathFor (id) {
    if (!id.startsWith(baseURL))
        throw `Incorrect schema $id: ${id}`;

    return $path.resolve("..", id.slice(baseURL.length));
}

function loadSchema (id) {
    const path = pathFor(id);
    //console.log(`Loading ${id} from ${path}`);
    return loadJSON(pathFor(id))
        .catch(err => ({}));
}

function schemaWalker (schemas) {
    const cwd = $path.resolve();

    return async (err, path, dirent) => {
        if (err) throw err;
        const abs = $path.resolve(path);

        /* Skip this directory (lots of schema under node_modules) */
        if (dirent.isDirectory())
            return abs != cwd;

        if (!path.endsWith(".json")) return;

        const json = await loadJSON(path)
            .catch(err => {
                error("JSON error in %s: %s",
                    abs, err.message);
            });
        if (!(typeof json == "object" && "$id" in json)) return;

        const id = json.$id;
        if (pathFor(id) != abs)
            error(`Incorrect $id in ${abs}`);

        schemas.push(json);
    };
}

const ajv = new Ajv2020({
    loadSchema,
    addUsedSchema: false,
    /* XXX We may want to revist these exceptions. Currently they are
     * violated everywhere. */
    strictTypes: false,
    allowMatchingProperties: true,
});
formats(ajv);

const schemas = [];
await Walk.walk("..", schemaWalker(schemas));

for (const sch of schemas) {
    //console.log(`Checking ${sch.$id}`);
    await ajv.compileAsync(sch)
        .catch(err => {
            const path = pathFor(sch.$id);
            error(`Error in ${path}: ${err}`);
        });
}

$process.exit(exit);
