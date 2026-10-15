/*
 * ACS FTP driver
 * Handler tests: connection handling and polled reads.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { FTPHandler, MAX_READ, check_conf } from "../lib/handler.js";
import { FTPTransport } from "../lib/ftp.js";
import { SFTPTransport } from "../lib/sftp.js";

import { fake_driver, fake_server } from "./fake.js";

const nolog = () => {};

async function setup (files) {
    const server = fake_server(files);
    const driver = fake_driver();
    const h = new FTPHandler(driver, {
        protocol: "ftp", host: "files.example", atomic: true,
        transport: server.Transport,
    });
    assert.strictEqual(await h.connect(), "UP");
    const poll = async addr => {
        const buf = await h.poll(h.parseAddr(addr));
        return buf && JSON.parse(buf);
    };
    return { server, driver, h, poll };
}

test("config: protocol picks the transport", () => {
    assert.strictEqual(check_conf({ host: "h" }, nolog).transport, FTPTransport);
    assert.strictEqual(check_conf({ host: "h", protocol: "ftps-implicit" }, nolog).transport,
        FTPTransport);
    assert.strictEqual(check_conf({ host: "h", protocol: "sftp", username: "u" }, nolog).transport,
        SFTPTransport);
    assert.strictEqual(check_conf({ host: "h" }, nolog).atomic, true);
    assert.strictEqual(check_conf({ host: "h", atomicWrites: false }, nolog).atomic, false);
});

test("config: unusable configs are refused", () => {
    for (const conf of [
        {},
        { host: "" },
        { host: "h", protocol: "tftp" },
        { host: "h", port: 70000 },
        { host: "h", port: "x" },
        { host: "h", fingerprint: "not one" },
        { host: "h", protocol: "sftp" },
    ])
        assert.strictEqual(check_conf(conf, nolog), undefined, JSON.stringify(conf));
});

test("config: a blank or zero port, or a blank fingerprint, means none", () => {
    const opts = check_conf({ host: "h", port: "", fingerprint: "", username: "" }, nolog);
    assert.strictEqual(opts.port, undefined);
    assert.strictEqual(check_conf({ host: "h", port: 0 }, nolog).port, undefined);
    assert.strictEqual(check_conf({ host: "h", port: 2121 }, nolog).port, 2121);
    assert.strictEqual(opts.fingerprint, undefined);
    assert.strictEqual(opts.username, undefined);
});

test("connect reports AUTH and CONN", async () => {
    const server = fake_server();
    const h = new FTPHandler(fake_driver(), {
        protocol: "ftp", host: "h", transport: server.Transport,
    });
    server.fail = "auth";
    assert.strictEqual(await h.connect(), "AUTH");
    server.fail = "conn";
    assert.strictEqual(await h.connect(), "CONN");
    server.fail = null;
    assert.strictEqual(await h.connect(), "UP");
});

test("file returns the raw bytes; a missing file publishes nothing", async () => {
    const { poll, h } = await setup({ "/s.json": { data: '{"state":"RUN"}' } });
    assert.deepStrictEqual(await poll("file:/s.json"), { state: "RUN" });
    assert.strictEqual(await h.poll(h.parseAddr("file:/nope")), undefined);
});

test("text wraps the content", async () => {
    const { poll } = await setup({ "/notes.txt": { data: "line 1\nline 2" } });
    assert.deepStrictEqual(await poll("text:/notes.txt"),
        { path: "/notes.txt", content: "line 1\nline 2" });
});

test("files over the read limit are not read", async () => {
    const { h } = await setup({ "/big": { data: "x".repeat(MAX_READ + 1) } });
    assert.strictEqual(await h.poll(h.parseAddr("file:/big")), undefined);
});

test("stat reports files, directories and absences", async () => {
    const { poll } = await setup({
        "/programs/PICK.TP": { data: "12345", modified: "2026-10-14T09:30:00.000Z" },
    });
    assert.deepStrictEqual(await poll("stat:/programs/PICK.TP"), {
        path: "/programs/PICK.TP", exists: true,
        type: "file", size: 5, modified: "2026-10-14T09:30:00.000Z",
    });
    assert.strictEqual((await poll("stat:/programs")).type, "dir");
    assert.deepStrictEqual(await poll("stat:/programs/NOPE.TP"), {
        path: "/programs/NOPE.TP", exists: false,
        type: "", size: 0, modified: null,
    });
});

test("list sorts entries by name and counts them", async () => {
    const { poll } = await setup({
        "/drop/b.csv": { data: "bb" },
        "/drop/a.csv": { data: "a" },
    });
    const list = await poll("list:/drop");
    assert.strictEqual(list.exists, true);
    assert.strictEqual(list.count, 2);
    assert.deepStrictEqual(list.entries.map(e => [e.name, e.size]),
        [["a.csv", 1], ["b.csv", 2]]);
    assert.deepStrictEqual(await poll("list:/missing"),
        { path: "/missing", exists: false, count: 0, entries: [] });
});

test("latest waits for a file to hold still, then reads the newest", async () => {
    const { poll, server } = await setup({
        "/drop/export_0900.csv": { data: "old", modified: "2026-10-14T09:00:00.000Z" },
        "/drop/export_0930.csv": { data: "new", modified: "2026-10-14T09:30:00.000Z" },
        "/drop/readme.txt": { data: "not a csv", modified: "2026-10-14T10:00:00.000Z" },
    });

    /* First sight: nothing has held still yet. */
    assert.strictEqual(await poll("latest:/drop/*.csv"), undefined);

    const v = await poll("latest:/drop/*.csv");
    assert.deepStrictEqual(v, {
        path: "/drop/export_0930.csv", name: "export_0930.csv", size: 3,
        modified: "2026-10-14T09:30:00.000Z", content: "new",
    });

    /* An unchanged answer isn't downloaded again. */
    const reads = server.reads;
    assert.deepStrictEqual(await poll("latest:/drop/*.csv"), v);
    assert.strictEqual(server.reads, reads);

    /* A newer file mid-upload is skipped until it stops changing. */
    server.files.set("/drop/export_1000.csv",
        { data: Buffer.from("par"), modified: "2026-10-14T10:00:00.000Z" });
    assert.strictEqual((await poll("latest:/drop/*.csv")).name, "export_0930.csv");
    server.files.set("/drop/export_1000.csv",
        { data: Buffer.from("partial plus more"), modified: "2026-10-14T10:00:05.000Z" });
    assert.strictEqual((await poll("latest:/drop/*.csv")).name, "export_0930.csv");
    assert.strictEqual((await poll("latest:/drop/*.csv")).content, "partial plus more");
});

test("latest uses names to order files with the same time", async () => {
    const { poll } = await setup({
        "/d/a1": { data: "1", modified: "2026-10-14T09:00:00.000Z" },
        "/d/a2": { data: "2", modified: "2026-10-14T09:00:00.000Z" },
    });
    await poll("latest:/d/a*");
    assert.strictEqual((await poll("latest:/d/a*")).name, "a2");
});

test("a dropped connection is reopened quietly", async () => {
    const { h, poll, server, driver } = await setup({ "/f": { data: "1" } });
    h.remote.closed = true;
    assert.strictEqual(await poll("file:/f"), 1);
    assert.strictEqual(server.connects, 2);
    assert.deepStrictEqual(driver.status, []);
});

test("a failed reconnect is reported to the driver", async () => {
    const { h, server, driver } = await setup({ "/f": { data: "1" } });
    h.remote.closed = true;
    server.fail = "conn";
    assert.strictEqual(await h.poll(h.parseAddr("file:/f")), undefined);
    server.fail = "auth";
    assert.strictEqual(await h.poll(h.parseAddr("file:/f")), undefined);
    assert.deepStrictEqual(driver.status, ["CONN", "AUTH"]);
});

test("close stops further operations", async () => {
    const { h, server } = await setup({ "/f": { data: "1" } });
    await h.close();
    assert.strictEqual(await h.poll(h.parseAddr("file:/f")), undefined);
    assert.strictEqual(server.connects, 1);
});
