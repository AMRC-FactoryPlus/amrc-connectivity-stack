import fs from "fs";
import $fs from "fs/promises";
import $path from "path";

import Walk from "@root/walk";
import git from "isomorphic-git";
import YAML from "yaml";

const schemas = "../schemas";
const path_rx = RegExp(`^${schemas}/([\\w/_]+)-v(\\d+).yaml$`);

const load_yaml = async f => YAML.parse(
    await $fs.readFile(f, { encoding: "utf8" }));

const yamls = new Map();
await Walk.walk("../schemas", async (err, path, dirent) => {
    if (err) throw err;
    /* grr win32 */
    path = path.replaceAll("\\", "/");

    if (dirent.isDirectory()) return;

    const matches = path.match(path_rx);
    if (!matches)
        throw `Bad schema filename: ${path}`;
    const [, name, version] = matches;
    if (!name || !version)
        throw `Bad name or version for ${path}`;

    yamls.set(path, { name, version });
});

const configs = {};
for (const [path, meta] of yamls.entries()) {
    console.log("Processing %s", path);

    const schema = await load_yaml(path);

    const uuid = schema.properties?.Schema_UUID?.const;
    if (schema.$id != `urn:uuid:${uuid}`)
        throw `Schema_UUID mismatch for ${path}`;
    console.log("Found Schema_UUID %s", uuid);

    const changes = (await git.log({
        fs, 
        dir:        "..", 
        filepath:   $path.posix.relative("..", path),
    })).map(l => l.commit.author.timestamp);

    configs[uuid] = {
        metadata: {
            ...meta,
            created:    changes.at(-1),
            modified:   changes.at(0),
        },
        schema,
    };
}

await $fs.writeFile("schemas.json", JSON.stringify(configs, null, 2));

const priv = {};
await Walk.walk("../private",  async (err, path, dirent) => {
    if (err) throw err;
    if (dirent.isDirectory()) return;

    console.log("Processing %s", path);
    const schema = await load_yaml(path);
    const matches = schema.$id?.match(/^urn:uuid:([-a-f0-9]{36})$/);
    if (!matches) return;
    const [, uuid] = matches;
    if (!uuid) return;

    priv[uuid] = schema;
    console.log("Found private schema %s", uuid);
});
await $fs.writeFile("private.json", JSON.stringify(priv, null, 2));
