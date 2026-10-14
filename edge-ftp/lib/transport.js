/*
 * ACS FTP driver
 * Errors and server fingerprints shared by the transports.
 * Copyright 2026 University of Sheffield AMRC
 */

import crypto from "crypto";

/* Every transport has the same methods:
 *
 *  connect()               log in, or throw
 *  closed                  true once the connection has gone
 *  read(path, max)         Buffer; NotFound, TooLarge
 *  stat(path)              { type, size, modified }; NotFound
 *  list(dir)               [{ name, type, size, modified }]; NotFound
 *  modified(path)          ISO string, or null if the server can't say
 *  write(path, buf)
 *  replace(from, to)       rename, overwriting `to`
 *  rename(from, to)
 *  remove(path)
 *  close()
 *
 * type is "file", "dir", "link" or "other". modified is an ISO string
 * or null. */

export class NotFound extends Error {
    constructor (path, detail) {
        super(`${path}: not found` + (detail ? ` (${detail})` : ""));
    }
}

export class TooLarge extends Error {
    constructor (path, size, max) {
        super(`${path}: ${size} bytes is over the ${max} byte limit`);
    }
}

/* The server refused the credentials. The driver reports AUTH. */
export class AuthError extends Error { }

/* The server isn't the one the connection config trusts. Carries the
 * fingerprint the server presented and what it was a fingerprint of,
 * so the log can say what to put in the config if this is the right
 * server after all. */
export class UntrustedServer extends Error {
    constructor (digest, reason, what) {
        super(`server is not trusted: ${reason}`);
        this.digest = digest;
        this.what = what;
    }
}

/* A Date as an ISO string, or null if there isn't a valid one. */
export function iso (date) {
    return date instanceof Date && !isNaN(date) ? date.toISOString() : null;
}

export function sha256 (buf) {
    return crypto.createHash("sha256").update(buf).digest();
}

/* Accept a SHA-256 fingerprint as ssh-keygen prints it (SHA256:base64)
 * or as openssl and browsers do (hex, with or without colons). Returns
 * the 32-byte digest, or undefined if the string is neither. */
export function parse_fingerprint (str) {
    const s = str.trim();
    const b64 = s.match(/^SHA256:([A-Za-z0-9+/]+=*)$/i);
    const buf = b64
        ? Buffer.from(b64[1], "base64")
        : /^[0-9a-f]{64}$/i.test(s.replaceAll(":", ""))
            ? Buffer.from(s.replaceAll(":", ""), "hex")
            : undefined;
    return buf?.length == 32 ? buf : undefined;
}

export function format_fingerprint (digest, style) {
    if (style == "ssh")
        return "SHA256:" + digest.toString("base64").replace(/=+$/, "");
    return digest.toString("hex").toUpperCase().match(/../g).join(":");
}
