/*
 * ACS Gateway Depot
 * Writes a tar archive that is identical every time for the same files.
 *
 * A gateway is told the checksum of the archive when it starts
 * installing and fetches it several minutes later. If this service
 * restarts in between, it must build exactly the same archive again, so
 * nothing that varies (times, owners, the order files come back from the
 * disk) may go into it.
 * Copyright 2026 University of Sheffield AMRC
 */

import fs       from "node:fs";
import path     from "node:path";
import zlib     from "node:zlib";

function header (name, size, mode, type) {
    if (Buffer.byteLength(name) > 100) throw new Error(`Path too long for the archive: ${name}`);
    const buf = Buffer.alloc(512);
    const octal = (value, len) => value.toString(8).padStart(len - 1, "0") + "\0";
    buf.write(name, 0);
    buf.write(octal(mode, 8), 100);
    buf.write(octal(0, 8), 108);            /* owner */
    buf.write(octal(0, 8), 116);            /* group */
    buf.write(octal(size, 12), 124);
    buf.write(octal(0, 12), 136);           /* modified time */
    buf.write("        ", 148);             /* checksum, filled in below */
    buf.write(type, 156);
    buf.write("ustar\0" + "00", 257);
    let sum = 0;
    for (const byte of buf) sum += byte;
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return buf;
}

function walk (root, rel, out) {
    const full = path.join(root, rel);
    if (fs.statSync(full).isDirectory()) {
        out.push({ name: `${rel}/`, dir: true });
        for (const child of fs.readdirSync(full).sort()) {
            /* Editor and interpreter leftovers are not part of the payload. */
            if (child.startsWith(".") || child == "__pycache__") continue;
            walk(root, path.join(rel, child), out);
        }
    }
    else {
        out.push({ name: rel, dir: false });
    }
}

/* Archive the named files and directories under root, as .tar.gz. */
export function tar_gz (root, names) {
    const entries = [];
    for (const name of [...names].sort()) walk(root, name, entries);

    const blocks = [];
    for (const entry of entries) {
        if (entry.dir) {
            blocks.push(header(entry.name, 0, 0o755, "5"));
            continue;
        }
        const data = fs.readFileSync(path.join(root, entry.name));
        /* Scripts must stay runnable. Everything else is plain data. */
        const mode = /\.(sh|py)$/.test(entry.name) ? 0o755 : 0o644;
        blocks.push(header(entry.name, data.length, mode, "0"), data,
            Buffer.alloc((512 - data.length % 512) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}
