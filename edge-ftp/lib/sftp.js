/*
 * ACS FTP driver
 * SFTP transport.
 * Copyright 2026 University of Sheffield AMRC
 */

import SftpClient from "ssh2-sftp-client";

import {
    AuthError, NotFound, TooLarge, UntrustedServer, iso, sha256,
} from "./transport.js";

/* As for FTP: shorter than the library's 30s poll timeout. */
const TIMEOUT = 20000;
/* Notice a dead connection between polls rather than on the next one. */
const KEEPALIVE = 10000;

const TYPES = new Map([["-", "file"], ["d", "dir"], ["l", "link"]]);

/* SFTP status 2 is 'no such file'. ssh2 passes it through as a number;
 * ssh2-sftp-client's stat turns it into ENOENT. */
const missing = e => e.code == 2 || e.code == "ENOENT";

export class SFTPTransport {
    constructor (opts) {
        this.host = opts.host;
        this.port = opts.port ?? 22;
        this.username = opts.username;
        this.password = opts.password;
        this.fingerprint = opts.fingerprint;

        /* These handle events outside any operation. A dropped
         * connection shows up as `closed` and the next operation
         * reconnects, so there's nothing to do here but log. */
        this.sftp = new SftpClient("edge-ftp", {
            error:  e => opts.log("SFTP connection error: %s", e.message),
            end:    () => {},
            close:  () => {},
        });
    }

    /* ssh2-sftp-client drops its channel when the connection closes. */
    get closed () { return !this.sftp.sftp; }

    /* There is no CA for SSH host keys, so a server is only trusted if
     * its key matches the configured fingerprint. */
    async connect () {
        let seen, type;
        const verify = key => {
            seen = sha256(key);
            /* An SSH key blob starts with its length-prefixed type name.
             * Servers have several keys, so say which one this was. */
            type = key.subarray(4, 4 + key.readUInt32BE(0)).toString();
            return !!this.fingerprint?.equals(seen);
        };

        await this.sftp.connect({
            host:               this.host,
            port:               this.port,
            username:           this.username,
            password:           this.password,
            hostVerifier:       verify,
            readyTimeout:       TIMEOUT,
            keepaliveInterval:  KEEPALIVE,
        }).catch(e => {
            if (seen && !this.fingerprint?.equals(seen))
                throw new UntrustedServer(seen, this.fingerprint
                    ? "host key does not match the fingerprint"
                    : "no fingerprint is configured", `${type} host key`);
            if (/authentication methods failed/i.test(e.message))
                throw new AuthError(e.message);
            throw e;
        });
    }

    async read (path, max) {
        const { size } = await this.stat(path);
        if (size > max) throw new TooLarge(path, size, max);
        return this.sftp.get(path).catch(e => {
            throw missing(e) ? new NotFound(path) : e;
        });
    }

    async stat (path) {
        const st = await this.sftp.stat(path).catch(e => {
            throw missing(e) ? new NotFound(path) : e;
        });
        return {
            type:       st.isFile ? "file" : st.isDirectory ? "dir"
                : st.isSymbolicLink ? "link" : "other",
            size:       st.size,
            modified:   iso(new Date(st.modifyTime)),
        };
    }

    async list (dir) {
        const entries = await this.sftp.list(dir).catch(e => {
            throw missing(e) ? new NotFound(dir) : e;
        });
        return entries
            .filter(e => e.name != "." && e.name != "..")
            .map(e => ({
                name:       e.name,
                type:       TYPES.get(e.type) ?? "other",
                size:       e.size,
                modified:   iso(new Date(e.modifyTime)),
            }));
    }

    async modified (path) {
        return (await this.stat(path)).modified;
    }

    async write (path, buf) {
        await this.sftp.put(buf, path);
    }

    /* Plain SFTP rename refuses to overwrite. The OpenSSH extension
     * overwrites in one step, where the server has it. */
    async replace (from, to) {
        try {
            await this.sftp.posixRename(from, to);
        }
        catch (e) {
            if (this.closed) throw e;
            await this.sftp.delete(to, true);
            await this.sftp.rename(from, to);
        }
    }

    async rename (from, to) {
        await this.sftp.rename(from, to);
    }

    async remove (path) {
        await this.sftp.delete(path);
    }

    async close () {
        await this.sftp.end().catch(() => {});
    }
}
