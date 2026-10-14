/*
 * ACS FTP driver
 * FTP and FTPS transport.
 * Copyright 2026 University of Sheffield AMRC
 */

import { Readable, Writable } from "stream";

import ftp from "basic-ftp";

import { split } from "./address.js";
import {
    AuthError, NotFound, TooLarge, UntrustedServer, iso, sha256,
} from "./transport.js";

const { Client, FTPError, FileType } = ftp;

/* Inactivity timeout for each operation. Shorter than the driver
 * library's 30s poll timeout, so a hung server fails the operation
 * rather than the whole poll. */
const TIMEOUT = 20000;

const TYPES = new Map([
    [FileType.File,         "file"],
    [FileType.Directory,    "dir"],
    [FileType.SymbolicLink, "link"],
]);

/* 550 is the reply for a missing file. Servers also use it for 'not
 * allowed', and FTP gives no way to tell the two apart. */
const missing = e => e instanceof FTPError && e.code == 550;

/* Node's codes for a certificate that failed verification. */
const cert_error = e => /CERT|SELF_SIGNED|UNABLE_TO_/.test(e.code ?? "");

export class FTPTransport {
    constructor (opts) {
        this.host = opts.host;
        this.secure = opts.protocol == "ftps-implicit" ? "implicit"
            : opts.protocol == "ftps";
        this.port = opts.port ?? (this.secure == "implicit" ? 990 : 21);
        this.username = opts.username;
        this.password = opts.password;
        this.fingerprint = opts.fingerprint;

        this.client = new Client(TIMEOUT);
    }

    get closed () { return this.client.closed; }

    /* As Client.access, but checking the server before the credentials
     * go out. With a fingerprint the certificate is pinned: that is how
     * a device's self-signed certificate gets trusted. Without one the
     * usual CA and hostname checks apply. */
    async connect () {
        const { client } = this;
        const tls = this.fingerprint
            ? { host: this.host, rejectUnauthorized: false }
            : { host: this.host };

        await this.open(client, tls).catch(async e => {
            if (!cert_error(e)) throw e;
            throw new UntrustedServer(await this.probe(), e.message, "certificate");
        });
        if (this.secure && this.fingerprint) {
            const digest = sha256(client.ftp.socket.getPeerCertificate().raw);
            if (!digest.equals(this.fingerprint))
                throw new UntrustedServer(digest,
                    "certificate does not match the fingerprint", "certificate");
        }

        await client.sendIgnoringError("OPTS UTF8 ON");
        await client.login(this.username, this.password).catch(e => {
            throw e instanceof FTPError && e.code == 530
                ? new AuthError(e.message) : e;
        });
        await client.useDefaultSettings();
    }

    /* Connect, and switch to TLS if this is FTPS. */
    async open (client, tls) {
        const { host, port, secure } = this;
        if (secure == "implicit")
            return client.connectImplicitTLS(host, port, tls);
        await client.connect(host, port);
        if (secure)
            await client.useTLS(tls);
    }

    /* Fetch the fingerprint of a certificate that failed verification,
     * so the log can show it. No credentials are sent. */
    async probe () {
        const probe = new Client(TIMEOUT);
        try {
            await this.open(probe, { host: this.host, rejectUnauthorized: false });
            return sha256(probe.ftp.socket.getPeerCertificate().raw);
        }
        catch {
            return;
        }
        finally {
            probe.close();
        }
    }

    async read (path, max) {
        /* SIZE first, to refuse a big file without downloading it. Not
         * every server has SIZE; the download below is capped anyway. */
        const size = await this.client.size(path).catch(e => {
            if (missing(e)) throw new NotFound(path);
            if (e instanceof FTPError) return;
            throw e;
        });
        if (size > max) throw new TooLarge(path, size, max);

        const chunks = [];
        let total = 0;
        const sink = new Writable({
            write (chunk, enc, done) {
                total += chunk.length;
                if (total > max)
                    return done(new TooLarge(path, total, max));
                chunks.push(chunk);
                done();
            },
        });
        /* An error from the sink closes the connection. The next
         * operation reconnects. */
        await this.client.downloadTo(sink, path).catch(e => {
            throw missing(e) ? new NotFound(path) : e;
        });
        return Buffer.concat(chunks);
    }

    async stat (path) {
        const size = await this.client.size(path).catch(e => {
            if (e instanceof FTPError) return;
            throw e;
        });
        if (size != null)
            return { type: "file", size, modified: await this.modified(path) };

        /* No answer to SIZE: a directory, a missing file, or a server
         * without SIZE. Look for it in its directory's listing. */
        if (await this.is_dir(path))
            return { type: "dir", size: 0, modified: await this.modified(path) };
        const { dir, base } = split(path);
        const entries = await this.list(dir).catch(e => {
            throw e instanceof NotFound ? new NotFound(path) : e;
        });
        const entry = entries.find(e => e.name == base);
        if (!entry) throw new NotFound(path);
        if (entry.type == "file")
            entry.modified ??= await this.modified(path);
        return { type: entry.type, size: entry.size, modified: entry.modified };
    }

    /* Listings only carry a usable time where the server has MLSD. */
    async list (dir) {
        const entries = (await this.client.list(dir).catch(e => {
            throw missing(e) ? new NotFound(dir) : e;
        })).filter(e => e.name != "." && e.name != "..");

        /* Some servers, vsftpd among them, list a missing directory as
         * an empty one. */
        if (!entries.length && !await this.is_dir(dir))
            throw new NotFound(dir);

        return entries.map(e => ({
            name:       e.name,
            type:       TYPES.get(e.type) ?? "other",
            size:       e.size,
            modified:   iso(e.modifiedAt),
        }));
    }

    /* Whether a path is a directory we can enter: CWD to it and back. */
    async is_dir (path) {
        const here = await this.client.pwd();
        try {
            await this.client.cd(path);
        }
        catch (e) {
            if (e instanceof FTPError) return false;
            throw e;
        }
        await this.client.cd(here);
        return true;
    }

    async modified (path) {
        const date = await this.client.lastMod(path).catch(e => {
            if (e instanceof FTPError) return;
            throw e;
        });
        return iso(date);
    }

    async write (path, buf) {
        await this.client.uploadFrom(Readable.from([buf]), path);
    }

    async replace (from, to) {
        try {
            await this.client.rename(from, to);
        }
        catch (e) {
            if (!(e instanceof FTPError)) throw e;
            /* Some servers, IIS among them, won't rename over a file. */
            await this.client.remove(to, true);
            await this.client.rename(from, to);
        }
    }

    async rename (from, to) {
        await this.client.rename(from, to);
    }

    async remove (path) {
        await this.client.remove(path);
    }

    async close () {
        this.client.close();
    }
}
