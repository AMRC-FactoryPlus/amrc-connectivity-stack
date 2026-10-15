/*
 * ACS FTP driver
 * Address parsing.
 * Copyright 2026 University of Sheffield AMRC
 */

import path from "path";

/* Read addresses are <kind>:<remote path>. The path is everything
 * after the first colon, so a device prefix such as md: survives. */
const READS = new Set(["file", "text", "stat", "list", "latest"]);

/* Command addresses must not contain slashes: the edge agent forwards
 * a write on cmd/<address>, and the driver library keeps only the
 * first topic segment after cmd. So the remote path travels in the
 * written value, never in the address. */
const COMMANDS = new Set(["write", "delete", "rename", "result"]);

export function parse_addr (addr) {
    const ix = addr.indexOf(":");
    if (ix < 0) return;
    const kind = addr.slice(0, ix);
    const rest = addr.slice(ix + 1);

    if (kind == "cmd")
        return COMMANDS.has(rest) ? { addr, kind, verb: rest } : undefined;
    if (!READS.has(kind) || rest == "") return;
    if (kind != "latest")
        return { addr, kind, path: rest };

    /* latest:<dir>/<glob>. The glob matches names in one directory. */
    const { dir, base: glob } = split(rest);
    if (glob == "") return;
    return { addr, kind, dir, glob, match: glob_rx(glob) };
}

/* * matches any run of characters and ? matches one. Everything else
 * is literal. */
export function glob_rx (glob) {
    const src = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".");
    return new RegExp(`^${src}$`);
}

export function join (dir, name) {
    return dir == "." ? name : path.posix.join(dir, name);
}

/* The inverse of join: a path's directory and its last component. */
export function split (file) {
    const slash = file.lastIndexOf("/");
    if (slash < 0) return { dir: ".", base: file };
    return { dir: file.slice(0, slash) || "/", base: file.slice(slash + 1) };
}
