/*
 * ACS FTP driver
 * Transport tests against real servers.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Skipped unless EDGE_FTP_TEST_SERVERS is set. Start the servers with
 *
 *   docker build -t edge-ftp-testservers test/servers
 *   docker run -d --rm --name edge-ftp-testservers --network host \
 *       edge-ftp-testservers
 *
 * which listens on localhost only: vsftpd (FTP and explicit FTPS on
 * 2121, implicit FTPS on 2990; no MLSD), pure-ftpd (FTP and explicit
 * FTPS on 2122, with MLSD) and OpenSSH (SFTP on 2222). The user is
 * files/secret. The certificate and host keys are generated when the
 * image is built, so each test learns the fingerprint from a refused
 * connection, as an administrator would from the driver's log.
 */

import assert from "node:assert";
import { describe, test } from "node:test";

import { FTPTransport } from "../lib/ftp.js";
import { SFTPTransport } from "../lib/sftp.js";
import { AuthError, NotFound, TooLarge, UntrustedServer } from "../lib/transport.js";

const skip = !process.env.EDGE_FTP_TEST_SERVERS
    && "set EDGE_FTP_TEST_SERVERS to run against the test servers";

const SERVERS = [
    { name: "vsftpd FTP",           protocol: "ftp",            port: 2121, root: "" },
    { name: "vsftpd FTPS",          protocol: "ftps",           port: 2121, root: "" },
    { name: "vsftpd implicit FTPS", protocol: "ftps-implicit",  port: 2990, root: "" },
    { name: "pure-ftpd FTP",        protocol: "ftp",            port: 2122, root: "" },
    { name: "pure-ftpd FTPS",       protocol: "ftps",           port: 2122, root: "" },
    { name: "OpenSSH SFTP",         protocol: "sftp",           port: 2222, root: "/home/files" },
];

const log = () => {};

function make (server, extra) {
    const Transport = server.protocol == "sftp" ? SFTPTransport : FTPTransport;
    return new Transport({
        host: "127.0.0.1", port: server.port, protocol: server.protocol,
        username: "files", password: "secret", log, ...extra,
    });
}

/* Connect, learning the fingerprint first where the server has one. */
async function connect (server) {
    if (server.protocol == "ftp") {
        const remote = make(server);
        await remote.connect();
        return remote;
    }
    const first = make(server);
    const err = await first.connect().catch(e => e);
    await first.close();
    assert.ok(err instanceof UntrustedServer, `expected UntrustedServer, got ${err}`);
    assert.strictEqual(err.digest.length, 32);

    server.fingerprint = err.digest;
    const remote = make(server, { fingerprint: err.digest });
    await remote.connect();
    return remote;
}

for (const server of SERVERS) {
    describe(server.name, { skip }, () => {
        const dir = `${server.root}/edge-ftp-${server.protocol}-${server.port}`;
        const file = `${server.root}/edge-ftp-${server.protocol}-${server.port}.txt`;

        test("files round trip", async () => {
            const r = await connect(server);
            try {
                assert.strictEqual(r.closed, false);
                await r.remove(file).catch(() => {});

                await r.write(file, Buffer.from("first"));
                assert.strictEqual((await r.read(file, 1000)).toString(), "first");
                await assert.rejects(r.read(file, 3), TooLarge);
                /* A TooLarge mid-download closes an FTP connection. These
                 * servers all have SIZE, so it shouldn't happen here. */
                assert.strictEqual(r.closed, false);

                const st = await r.stat(file);
                assert.strictEqual(st.type, "file");
                assert.strictEqual(st.size, 5);
                assert.ok(Date.parse(st.modified) > Date.now() - 600000, st.modified);

                const listing = await r.list(server.root || "/");
                const entry = listing.find(e => e.name == file.split("/").pop());
                assert.strictEqual(entry?.type, "file");
                assert.strictEqual(entry.size, 5);
                assert.ok(!listing.some(e => e.name == "." || e.name == ".."));
                assert.ok(await r.modified(file));

                /* replace overwrites an existing file. */
                await r.write(`${file}.part`, Buffer.from("second"));
                await r.replace(`${file}.part`, file);
                assert.strictEqual((await r.read(file, 1000)).toString(), "second");
                await assert.rejects(r.stat(`${file}.part`), NotFound);

                await r.rename(file, `${file}.moved`);
                await assert.rejects(r.read(file, 1000), NotFound);
                await r.remove(`${file}.moved`);
                await assert.rejects(r.stat(`${file}.moved`), NotFound);
                await assert.rejects(r.list(dir), NotFound);
            }
            finally {
                await r.close();
            }
            assert.strictEqual(r.closed, true);
        });

        test("the root directory stats as a directory", async () => {
            const r = await connect(server);
            try {
                const st = await r.stat(server.root || "/");
                assert.strictEqual(st.type, "dir");
            }
            finally {
                await r.close();
            }
        });

        test("a wrong password is an AuthError", async () => {
            const r = make(server, { password: "wrong", fingerprint: server.fingerprint });
            await assert.rejects(r.connect(), AuthError);
            await r.close();
        });

        if (server.protocol != "ftp")
            test("a wrong fingerprint is refused before logging in", async () => {
                const r = make(server, { fingerprint: Buffer.alloc(32) });
                const err = await r.connect().catch(e => e);
                await r.close();
                assert.ok(err instanceof UntrustedServer, String(err));
                assert.ok(err.digest.equals(server.fingerprint));
            });
    });
}
