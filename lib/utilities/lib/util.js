/* 
 * Factory+ NodeJS Utilities
 * Utility functions.
 * Copyright 2022 AMRC.
 */

import fs from "fs";
import path from "path";
import url from "url";

import find_pkg from "find-package-json";

function resolve (meta, file) {
    return url.fileURLToPath(new URL(file, meta.url));
}

function pkgVersion (meta) {
    const dir = resolve(meta, ".");
    const finder = find_pkg(dir);
    return finder.next().value.version;
}

function loadJsonObj (file) {
    const json = fs.readFileSync(file);
    let rv;
    try {
        rv = JSON.parse(json);
    }
    catch (e) {
        throw `JSON parse error in ${file}: ${e.message}`;
    }
    if (typeof(rv) != "object")
        throw `Not a JSON object: ${file}`;
    return rv;
}

function loadAllJson (files) {
    return files
        .map(f => [f, fs.statSync(f)])
        .filter(([f, s]) => s != undefined)
        .flatMap(([f, s]) => s.isDirectory()
            ? fs.readdirSync(f)
                .filter(f => f[0] != ".")
                .map(e => path.resolve(f, e))
            : [f])
        .map(f => [f, loadJsonObj(f)]);
}

export { 
    resolve, loadAllJson, loadJsonObj, pkgVersion
};
