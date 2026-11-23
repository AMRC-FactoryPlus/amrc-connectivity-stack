/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Tests for the git HTTP timeout and retries
 * Copyright 2026 University of Sheffield
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
    DEFAULT_TIMEOUT, git_timeout, http_client, is_retryable, with_retry,
} from "../lib/git-http.js";

const http_error = statusCode => Object.assign(
    new Error(`HTTP Error: ${statusCode}`),
    { code: "HttpError", data: { statusCode } });

const net_error = code => Object.assign(new Error(code), { code });

describe("git_timeout", () => {
    test("defaults to 30 seconds", () => {
        assert.equal(DEFAULT_TIMEOUT, 30000);
        assert.equal(git_timeout(undefined), 30000);
        assert.equal(git_timeout(""), 30000);
    });

    test("reads a value in ms", () => {
        assert.equal(git_timeout("45000"), 45000);
    });

    test("ignores nonsense", () => {
        for (const v of ["abc", "0", "-5"])
            assert.equal(git_timeout(v), 30000, v);
    });
});

describe("is_retryable", () => {
    test("retries a request timeout", () => {
        assert.ok(is_retryable(new Error("Request timed out")));
    });

    test("retries network errors", () => {
        for (const c of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"])
            assert.ok(is_retryable(net_error(c)), c);
    });

    test("retries gateway errors", () => {
        for (const s of [502, 503, 504])
            assert.ok(is_retryable(http_error(s)), s);
    });

    test("doesn't retry definite answers", () => {
        for (const s of [400, 401, 403, 404, 500])
            assert.ok(!is_retryable(http_error(s)), s);
        assert.ok(!is_retryable(net_error("ENOTFOUND")));
        assert.ok(!is_retryable(new Error("Failed to push")));
        assert.ok(!is_retryable(undefined));
    });
});

describe("with_retry", () => {
    const no_sleep = { sleep: async () => {} };

    test("returns the first success", async () => {
        let calls = 0;
        const res = await with_retry(async () => ++calls, no_sleep);
        assert.equal(res, 1);
        assert.equal(calls, 1);
    });

    test("retries timeouts with the given delays", async () => {
        let calls = 0;
        const retries = [];
        const slept = [];
        const res = await with_retry(async () => {
            if (++calls < 3) throw new Error("Request timed out");
            return "ok";
        }, {
            sleep:      async d => slept.push(d),
            on_retry:   (err, attempt, delay) => retries.push([attempt, delay]),
        });
        assert.equal(res, "ok");
        assert.equal(calls, 3);
        assert.deepEqual(slept, [1000, 3000]);
        assert.deepEqual(retries, [[1, 1000], [2, 3000]]);
    });

    test("gives up after the last retry", async () => {
        let calls = 0;
        await assert.rejects(
            with_retry(async () => {
                calls++;
                throw net_error("ECONNRESET");
            }, no_sleep),
            { code: "ECONNRESET" });
        assert.equal(calls, 3);
    });

    test("doesn't retry an auth failure", async () => {
        let calls = 0;
        await assert.rejects(
            with_retry(async () => {
                calls++;
                throw http_error(401);
            }, no_sleep),
            { code: "HttpError" });
        assert.equal(calls, 1);
    });
});

describe("http_client", () => {
    /* A server which takes 300ms to answer. */
    let server, url;

    before(async () => {
        server = http.createServer((req, res) =>
            setTimeout(() => res.end("hello"), 300));
        await new Promise(r => server.listen(0, "127.0.0.1", r));
        url = `http://127.0.0.1:${server.address().port}/`;
    });

    after(() => {
        server.closeAllConnections();
        server.close();
    });

    const body = async res => {
        const chunks = [];
        for await (const c of res.body) chunks.push(c);
        return Buffer.concat(chunks).toString();
    };

    test("times out a slow answer", async () => {
        await assert.rejects(
            http_client(100).request({ url }),
            { message: "Request timed out" });
    });

    test("waits for a slow answer within the timeout", async () => {
        const res = await http_client(2000).request({ url });
        assert.equal(res.statusCode, 200);
        assert.equal(await body(res), "hello");
    });

    test("shares one client per timeout", () => {
        assert.equal(http_client(2000), http_client(2000));
        assert.notEqual(http_client(2000), http_client(100));
    });
});
