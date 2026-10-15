/*
 * ACS FTP driver
 * Address parsing and fingerprint tests.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { glob_rx, join, parse_addr, split } from "../lib/address.js";
import { format_fingerprint, parse_fingerprint } from "../lib/transport.js";

test("read addresses keep everything after the first colon", () => {
    assert.deepStrictEqual(parse_addr("file:/status/cell3.json"),
        { addr: "file:/status/cell3.json", kind: "file", path: "/status/cell3.json" });
    assert.strictEqual(parse_addr("text:md:PROG.LS").path, "md:PROG.LS");
    assert.strictEqual(parse_addr("stat:relative/name").path, "relative/name");
    assert.strictEqual(parse_addr("list:/").path, "/");
});

test("latest splits a directory from a glob", () => {
    const a = parse_addr("latest:/drop/*.csv");
    assert.strictEqual(a.dir, "/drop");
    assert.strictEqual(a.glob, "*.csv");
    assert.ok(a.match.test("export_0930.csv"));
    assert.ok(!a.match.test("export_0930.csv.part"));

    assert.strictEqual(parse_addr("latest:*.json").dir, ".");
    assert.strictEqual(parse_addr("latest:/x?.txt").dir, "/");
});

test("command addresses are a fixed set of words", () => {
    assert.deepStrictEqual(parse_addr("cmd:write"),
        { addr: "cmd:write", kind: "cmd", verb: "write" });
    assert.strictEqual(parse_addr("cmd:result").verb, "result");
    assert.strictEqual(parse_addr("cmd:format"), undefined);
});

test("bad addresses are refused", () => {
    for (const a of ["", "file", "file:", "nope:/x", "latest:/drop/", "cmd:"])
        assert.strictEqual(parse_addr(a), undefined, a);
});

test("globs only treat * and ? as special", () => {
    assert.ok(glob_rx("a.b").test("a.b"));
    assert.ok(!glob_rx("a.b").test("axb"));
    assert.ok(glob_rx("run(?)*").test("run(1)-final"));
    assert.ok(glob_rx("[x]").test("[x]"));
});

test("join and split are inverses", () => {
    assert.strictEqual(join("/drop", "a.csv"), "/drop/a.csv");
    assert.strictEqual(join("/", "a.csv"), "/a.csv");
    assert.strictEqual(join(".", "a.csv"), "a.csv");
    assert.deepStrictEqual(split("/drop/a.csv"), { dir: "/drop", base: "a.csv" });
    assert.deepStrictEqual(split("/a.csv"), { dir: "/", base: "a.csv" });
    assert.deepStrictEqual(split("a.csv"), { dir: ".", base: "a.csv" });
});

test("fingerprints parse in ssh-keygen and openssl styles", () => {
    const digest = Buffer.alloc(32, 0xab);
    const ssh = format_fingerprint(digest, "ssh");
    const hex = format_fingerprint(digest, "hex");

    assert.match(ssh, /^SHA256:[A-Za-z0-9+/]{43}$/);
    assert.match(hex, /^(AB:){31}AB$/);
    assert.ok(parse_fingerprint(ssh).equals(digest));
    assert.ok(parse_fingerprint(hex).equals(digest));
    assert.ok(parse_fingerprint(hex.replaceAll(":", "").toLowerCase()).equals(digest));
    assert.ok(parse_fingerprint(`  ${ssh}=  `).equals(digest));

    assert.strictEqual(parse_fingerprint("SHA256:short"), undefined);
    assert.strictEqual(parse_fingerprint("AB:CD"), undefined);
});
