/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import fs from "node:fs";

export const read = function ({name}: { name: any }) {
    try {
        return fs.readFileSync(`/run/secrets/${name}`);
    }
    catch (err: any) {
        if (err.code != "ENOENT") {
            console.error("Error reading Docker secret [%s]: %o", name, err);
        }
        return null;
    }
};

export const readUTF8 = function ({name}: { name: any }) {
    const buf = read({name: name});
    if (buf == null) return null;

    return buf.toString("utf8").replace(/\r?\n$/, "");
};

// Read a value from the environment if it exists.
export const env = function ({key}: { key: any }) {
    if (key in process.env)
        return process.env[key];

    throw `No value available for ${key}!`;
}