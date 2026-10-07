/*
 * ACS Edge Agent driver library
 * Redaction tests.
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Run with `node --test test/`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { redact } from "../lib/redact.js";

test("masks sensitive keys but keeps the rest", () => {
    const conf = {
        host: "10.0.0.1",
        port: 502,
        username: "operator",
        password: "not-a-real-password",
    };
    assert.deepEqual(redact(conf), {
        host: "10.0.0.1",
        port: 502,
        username: "operator",
        password: "***",
    });
});

test("matches key names case-insensitively", () => {
    const out = redact({
        Password: "x", clientSecret: "x", API_TOKEN: "x",
        apiKey: "x", credentials: "x", passwd: "x", pwd: "x",
    });
    for (const v of Object.values(out))
        assert.equal(v, "***");
});

test("recurses into objects and arrays", () => {
    const out = redact({
        auth: { user: "u", password: "x" },
        servers: [{ host: "a", token: "x" }, { host: "b" }],
    });
    assert.deepEqual(out, {
        auth: { user: "u", password: "***" },
        servers: [{ host: "a", token: "***" }, { host: "b" }],
    });
});

test("masks a whole subtree under a sensitive key", () => {
    assert.deepEqual(
        redact({ credentials: { user: "u", pass: "x" } }),
        { credentials: "***" });
});

test("leaves empty values visible", () => {
    /* Knowing a password is missing is useful, and reveals nothing. */
    assert.deepEqual(
        redact({ password: "", secret: null }),
        { password: "", secret: null });
});

test("masks credentials embedded in URLs", () => {
    const out = redact({
        url: "mqtt://user:pa@ss@broker:1883/path",
        plain: "http://broker:8080/a@b",
    });
    assert.equal(out.url, "mqtt://user:***@broker:1883/path");
    assert.equal(out.plain, "http://broker:8080/a@b");
});

test("does not modify the original", () => {
    const conf = { password: "x", nested: { token: "y" } };
    redact(conf);
    assert.deepEqual(conf, { password: "x", nested: { token: "y" } });
});

test("passes non-objects through", () => {
    assert.equal(redact(undefined), undefined);
    assert.equal(redact(null), null);
    assert.equal(redact(42), 42);
    assert.equal(redact("plain"), "plain");
});
