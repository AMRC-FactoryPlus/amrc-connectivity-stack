/*
 * ACS Gateway Depot
 * Tests for the repeatable archive of the gateway's setup scripts.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert       from "node:assert/strict";
import crypto       from "node:crypto";
import fs           from "node:fs";
import os           from "node:os";
import path         from "node:path";
import { test }     from "node:test";
import zlib         from "node:zlib";

import { tar_gz }   from "../lib/tar.js";

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");

function tree () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "depot-tar-"));
    fs.mkdirSync(path.join(dir, "sh"));
    fs.writeFileSync(path.join(dir, "sh", "b.sh"), "echo b\n");
    fs.writeFileSync(path.join(dir, "sh", "a.sh"), "echo a\n");
    fs.writeFileSync(path.join(dir, "versions.env"), "K3S_VERSION=\"x\"\n");
    fs.mkdirSync(path.join(dir, "sh", "__pycache__"));
    fs.writeFileSync(path.join(dir, "sh", "__pycache__", "junk.pyc"), "junk");
    return dir;
}

test("the archive is the same whatever order the files are named in, and whenever it is built", () => {
    const dir = tree();
    const one = tar_gz(dir, ["sh", "versions.env"]);
    fs.utimesSync(path.join(dir, "sh", "a.sh"), new Date(0), new Date(0));
    const two = tar_gz(dir, ["versions.env", "sh"]);
    assert.equal(sha(one), sha(two));
});

test("the archive holds the files, keeps scripts runnable and leaves out interpreter leftovers", () => {
    const tar = zlib.gunzipSync(tar_gz(tree(), ["sh", "versions.env"]));
    const entries = [];
    for (let off = 0; off + 512 <= tar.length;) {
        const name = tar.subarray(off, off + 100).toString().replace(/\0.*$/, "");
        if (!name) break;
        const size = parseInt(tar.subarray(off + 124, off + 135).toString(), 8);
        const mode = parseInt(tar.subarray(off + 100, off + 107).toString(), 8);
        entries.push({ name, mode });
        off += 512 + Math.ceil(size / 512) * 512;
    }
    assert.deepEqual(entries.map(e => e.name), ["sh/", "sh/a.sh", "sh/b.sh", "versions.env"]);
    assert.equal(entries.find(e => e.name == "sh/a.sh").mode, 0o755);
    assert.equal(entries.find(e => e.name == "versions.env").mode, 0o644);
});
