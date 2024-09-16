import $fs from "fs/promises";
import $path from "path";

import Walk from "@root/walk";

const ignore = new Set([
    ".git", ".githooks", ".github",
    "deploy", "validate",
]);

const base = "https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main";
const id_rx = RegExp(`^${base}/([\\w/_]+)-v(\\d+).json$`);

/* Walk should be an async iterator really. But meh. */
const schemas = new Map();

const walker = Walk.create({
    sort: des => des
        .filter(d => !(d.parentPath == ".." && ignore.has(d.name))),
});
await walker("..", async (err, path, dirent) => {
    if (err) throw err;

    if (dirent.isDirectory()) return;
    if (!path.match(/\.json$/)) return;

    const data = await $fs.readFile(path);
    const json = JSON.parse(data);

    const id = json.$id;
    if (!id) return;
    if (schemas.has(id))
        throw `Duplicate $id for ${path}`;

    const matches = id.match(id_rx);
    if (!matches)
        throw `Bad $id for ${path}: ${id}`;

    const [, name, version] = matches;
    const uuid = json.properties?.Schema_UUID?.const;
    if (!name || !version)
        throw `Bad name or version for ${path}`;

    schemas.set(id, { uuid, path, name, version, json });
});

function fixup (obj) {
    if (obj == null || typeof(obj) != "object")
        return obj;
    
    if (Array.isArray(obj))
        return obj.map(v => fixup(v));

    const fix = Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, fixup(v)]));

    const ref = obj.$ref;
    if (!ref)
        return fix;

    const sch = schemas.get(ref);
    if (!sch)
        throw `Unknown $ref: ${ref}`;

    if (sch.uuid)
        return { ...fix, $ref: `urn:uuid:${sch.uuid}` };

    /* The Sparkplug_Types and Eng_Units schemas are sub-schemas of
     * Metric. As such they cannot include a Schema_UUID metric. For now
     * just expand them inline (they are only used in Metric). */
    const expand = { ...sch.json, ...fix };
    delete expand.$id;
    delete expand.$ref;
    delete expand.$schema;
    return expand;
}

const configs = {};
for (const sch of schemas.values()) {
    if (!sch.uuid)
        continue;

    configs[sch.uuid] = {
        metadata: {
            name:       sch.name,
            version:    sch.version,
        },
        schema: {
            ...fixup(sch.json),
            $id:        `urn:uuid:${sch.uuid}`,
        },
    };
}

await $fs.writeFile("schemas.json", JSON.stringify(configs, null, 2));
