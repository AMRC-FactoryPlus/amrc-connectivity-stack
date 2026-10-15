/*
 * ACS FTP driver
 * Command tests: writes, deletes, renames and Files service fetches.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { FTPHandler } from "../lib/handler.js";

import { fake_driver, fake_server } from "./fake.js";

const UUID = "0e3f4b1c-9a2d-4c5e-8f6a-7b8c9d0e1f2a";
const PROGRAM = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a]);

async function setup ({ files, agent, atomic = true } = {}) {
    const server = fake_server(files);
    const driver = fake_driver(agent);
    const h = new FTPHandler(driver, {
        protocol: "ftp", host: "robot.example", atomic,
        transport: server.Transport,
    });
    await h.connect();
    const send = (verb, value) => h.cmd(`cmd:${verb}`,
        Buffer.from(typeof value == "string" ? value : JSON.stringify(value)));
    const result = async () => {
        const buf = await h.poll(h.parseAddr("cmd:result"));
        return buf && JSON.parse(buf);
    };
    return { server, driver, h, send, result };
}

test("write puts text in place through a temporary file", async () => {
    const { server, send, result } = await setup();
    await send("write", { path: "/programs/PICK.LS", content: "/PROG PICK\n" });

    assert.strictEqual(server.files.get("/programs/PICK.LS").data.toString(),
        "/PROG PICK\n");
    assert.deepStrictEqual([...server.files.keys()], ["/programs/PICK.LS"]);
    const [[op, tmp], [op2, from, to]] = server.log;
    assert.strictEqual(op, "write");
    assert.match(tmp, /^\/programs\/\.PICK\.LS\.[0-9a-f]{8}\.part$/);
    assert.deepStrictEqual([op2, from, to], ["replace", tmp, "/programs/PICK.LS"]);

    const r = await result();
    assert.deepStrictEqual({ ...r, at: undefined }, {
        id: "", command: "write",
        path: "/programs/PICK.LS", from: "", to: "", file: "", size: 11,
        ok: true, error: "", at: undefined,
    });
    assert.ok(!isNaN(Date.parse(r.at)));
});

test("write can go straight to the path", async () => {
    const { server, send } = await setup({ atomic: false });
    await send("write", { path: "md:PICK.LS", content: "x" });
    assert.deepStrictEqual(server.log, [["write", "md:PICK.LS"]]);
});

test("write fetches a file from the Files service through the agent", async () => {
    const asked = [];
    const { server, driver, send, result } = await setup({
        agent: async uuid => {
            asked.push(uuid.toString());
            return { uuid: uuid.toString(), size: PROGRAM.length,
                content: PROGRAM.toString("base64") };
        },
    });
    await send("write", { path: "/programs/PICK.TP", file: UUID, id: "job-17" });

    assert.deepStrictEqual(asked, [UUID]);
    assert.strictEqual(driver.published[0][0], "fpEdge1/test/req/file");
    assert.ok(server.files.get("/programs/PICK.TP").data.equals(PROGRAM));
    const r = await result();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.id, "job-17");
    assert.strictEqual(r.file, UUID);
    assert.strictEqual(r.size, PROGRAM.length);
});

test("an agent-side error fails the write", async () => {
    const { server, send, result } = await setup({
        agent: async uuid => ({ uuid: uuid.toString(),
            error: "Files service refused: 403" }),
    });
    await send("write", { path: "/p", file: UUID });
    assert.strictEqual(server.files.size, 0);
    const r = await result();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /403/);
});

test("an agent too old to fetch files fails the write quickly", async () => {
    const { send, result } = await setup({
        agent: async () => ({ error: "Unknown request: file" }),
    });
    await send("write", { path: "/p", file: UUID });
    assert.match((await result()).error, /Unknown request: file/);
});

test("no reply from the agent times out", async () => {
    const { h, send, result } = await setup();
    h.fetch_timeout = 20;
    await send("write", { path: "/p", file: UUID });
    assert.match((await result()).error, /timed out/);
});

test("every result has every field, so old values are cleared", async () => {
    const { send, result } = await setup();
    await send("write", { path: "/p", content: "x", id: 42 });
    await send("delete", { path: "/missing" });
    const r = await result();
    assert.deepStrictEqual(Object.keys(r),
        ["id", "command", "path", "from", "to", "file", "size", "ok", "error", "at"]);
    assert.strictEqual(r.id, "");
    assert.strictEqual(r.size, 0);
    assert.strictEqual(r.ok, false);

    await send("write", { path: "/p", content: "x", id: 42 });
    const ok = await result();
    assert.strictEqual(ok.id, "42");
    assert.strictEqual(ok.error, "");
});

test("delete and rename", async () => {
    const { server, send, result } = await setup({
        files: { "/drop/a.csv": { data: "a" }, "/drop/b.csv": { data: "b" } },
    });
    await send("rename", { from: "/drop/a.csv", to: "/drop/processed/a.csv" });
    assert.ok(server.files.has("/drop/processed/a.csv"));
    assert.deepStrictEqual(await result().then(r => [r.ok, r.from, r.to]),
        [true, "/drop/a.csv", "/drop/processed/a.csv"]);

    await send("delete", { path: "/drop/b.csv" });
    assert.ok(!server.files.has("/drop/b.csv"));

    await send("delete", { path: "/drop/b.csv" });
    const r = await result();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /not found/);
});

test("bad values are reported, not thrown", async () => {
    const { send, result, h } = await setup();
    const cases = [
        ["write", "not json", /not JSON/],
        ["write", "[1, 2]", /JSON object/],
        ["write", { content: "x" }, /'path'/],
        ["write", { path: "/p" }, /exactly one/],
        ["write", { path: "/p", content: "x", file: UUID }, /exactly one/],
        ["write", { path: "/p", content: 7 }, /'content' must be a string/],
        ["write", { path: "/p", file: "cassette" }, /not a UUID/],
        ["rename", { from: "/a" }, /'to'/],
    ];
    for (const [verb, value, rx] of cases) {
        await send(verb, value);
        const r = await result();
        assert.strictEqual(r.ok, false, JSON.stringify(value));
        assert.match(r.error, rx);
    }

    /* A write to a read address arrives truncated at its first slash. */
    await h.cmd("file:", Buffer.from("x"));
    assert.match((await result()).error, /not a command address/);
    await send("result", {});
    assert.match((await result()).error, /not a command address/);
});

test("commands run in the order they arrive", async () => {
    let release;
    const { server, send } = await setup({
        agent: uuid => new Promise(resolve => {
            release = () => resolve({ uuid: uuid.toString(),
                content: Buffer.from("from files").toString("base64") });
        }),
    });
    const first = send("write", { path: "/p", file: UUID });
    const second = send("write", { path: "/p", content: "inline" });
    await new Promise(r => setTimeout(r, 10));
    release();
    await Promise.all([first, second]);
    assert.strictEqual(server.files.get("/p").data.toString(), "inline");
});

test("polls carry on while a fetch is waiting", async () => {
    let release;
    const { h, send } = await setup({
        files: { "/f": { data: "1" } },
        agent: uuid => new Promise(resolve => {
            release = () => resolve({ uuid: uuid.toString(), content: "" });
        }),
    });
    const write = send("write", { path: "/p", file: UUID });
    assert.strictEqual((await h.poll(h.parseAddr("file:/f"))).toString(), "1");
    release();
    await write;
});

test("the command addresses themselves read as nothing", async () => {
    const { h, result } = await setup();
    assert.strictEqual(await h.poll(h.parseAddr("cmd:write")), undefined);
    assert.strictEqual(await result(), undefined);
});

test("closing fails fetches in flight", async () => {
    const { h, send, result } = await setup({ agent: () => new Promise(() => {}) });
    const write = send("write", { path: "/p", file: UUID });
    await new Promise(r => setTimeout(r, 10));
    await h.close();
    await write;
    assert.match(h.result.error, /closing/);
});
