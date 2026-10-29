/*
 * ACS Briefcase exporter
 * Package a directory as a BagIt bag, zipped into one file
 * Copyright 2026 University of Sheffield
 */

import crypto           from "node:crypto";
import fs               from "node:fs";
import fsp              from "node:fs/promises";
import path             from "node:path";
import { Transform }    from "node:stream";
import { pipeline }     from "node:stream/promises";

import yazl             from "yazl";

/* The tag files listed in the tag manifest. */
const TAG_FILES = ["bagit.txt", "bag-info.txt", "manifest-sha256.txt"];

/** The SHA-256 of a file, in lowercase hex. */
export async function sha256_file (file) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file))
        hash.update(chunk);
    return hash.digest("hex");
}

/** List the files under a directory, sorted, as paths relative to it
 * with `/` separators. */
export async function list_files (dir) {
    const entries = await fsp.readdir(dir, {
        recursive: true, withFileTypes: true });
    return entries
        .filter(e => e.isFile())
        .map(e => path.relative(dir, path.join(e.parentPath, e.name))
            .split(path.sep).join("/"))
        .sort();
}

/* A bag-info.txt value must fit on one line. */
function one_line (value) {
    return String(value).replace(/\s+/g, " ").trim();
}

/** Turn a directory into a BagIt 1.0 bag (RFC 8493).
 *
 * The payload must already be in `dir/data`. This writes `bagit.txt`,
 * `bag-info.txt`, a SHA-256 manifest of the payload, and a SHA-256 tag
 * manifest of the other three.
 *
 * @param dir The bag directory.
 * @param info The bag-info.txt fields as `[name, value]` pairs, in
 * order. Fields with no value are left out. Payload-Oxum is added.
 */
export async function write_bag (dir, info) {
    const data = path.join(dir, "data");
    const payload = await list_files(data);

    let octets = 0;
    const manifest = [];
    for (const name of payload) {
        const file = path.join(data, ...name.split("/"));
        octets += (await fsp.stat(file)).size;
        manifest.push(`${await sha256_file(file)}  data/${name}\n`);
    }

    const fields = [...info, ["Payload-Oxum", `${octets}.${payload.length}`]]
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${one_line(v)}\n`);

    await fsp.writeFile(path.join(dir, "bagit.txt"),
        "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n");
    await fsp.writeFile(path.join(dir, "bag-info.txt"), fields.join(""));
    await fsp.writeFile(path.join(dir, "manifest-sha256.txt"),
        manifest.join(""));

    const tags = [];
    for (const name of TAG_FILES)
        tags.push(`${await sha256_file(path.join(dir, name))}  ${name}\n`);
    await fsp.writeFile(path.join(dir, "tagmanifest-sha256.txt"),
        tags.join(""));
}

/** Zip a bag into one file.
 *
 * The bag goes under a single top-level directory, `name`, as BagIt
 * serialisation expects. Every entry gets the same modification time,
 * so the same bag always gives the same zip. Parquet files are already
 * compressed, so they are stored as they are.
 *
 * @param dir The bag directory.
 * @param name The top-level directory name in the zip.
 * @param out The zip file to write.
 * @param mtime The modification time for every entry.
 * @returns `{ size, sha256 }` of the zip.
 */
export async function zip_bag (dir, name, out, mtime) {
    const zip = new yazl.ZipFile();
    for (const file of await list_files(dir))
        zip.addFile(path.join(dir, ...file.split("/")), `${name}/${file}`, {
            mtime,
            compress: !file.endsWith(".parquet"),
        });
    zip.end();

    const hash = crypto.createHash("sha256");
    let size = 0;
    const measure = new Transform({
        transform (chunk, encoding, done) {
            hash.update(chunk);
            size += chunk.length;
            done(null, chunk);
        },
    });

    await pipeline(zip.outputStream, measure, fs.createWriteStream(out));
    return { size, sha256: hash.digest("hex") };
}
