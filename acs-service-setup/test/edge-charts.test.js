/*
 * ACS service setup
 * Tests for the edge chart check
 * Copyright 2026 University of Sheffield AMRC
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { EdgeCharts, VALUES, compare_charts, default_image } from "../lib/edge-charts.js";

import { chart_values } from "./fake-charts.js";

const NEW = chart_values("v9.0.0");

describe("compare_charts", () => {
    test("reads the default image", () => {
        assert.deepEqual(default_image(NEW),
            { registry: "ghcr.io/amrc-factoryplus", tag: "v9.0.0" });
        assert.equal(default_image("image: {}\n"), undefined);
        assert.equal(default_image(""), undefined);
    });

    test("is ready when main deploys acs's image", () => {
        assert.deepEqual(compare_charts(NEW, NEW),
            { ready: true, image: { registry: "ghcr.io/amrc-factoryplus", tag: "v9.0.0" } });
        assert.equal(compare_charts(NEW + "verbosity: ALL\n", NEW).ready, true);
    });

    test("is not ready otherwise, and says why", () => {
        const cases = [
            [chart_values("v8.5.0"), NEW, /main deploys .* tag v8.5.0 but this release is .* tag v9.0.0/],
            [chart_values("v9.0.0", "mirror.example"), NEW, /mirror.example tag v9.0.0/],
            [undefined, NEW, /branch main has no charts\/edge-agent\/values.yaml/],
            [NEW, undefined, /branch acs has no/],
            ["image: {}\n", NEW, /branch main has no default image tag/],
        ];
        for (const [main, acs, reason] of cases) {
            const r = compare_charts(main, acs);
            assert.equal(r.ready, false);
            assert.match(r.reason, reason);
        }
    });

    test("a check that throws is not ready", async () => {
        const charts = new EdgeCharts({
            path: "shared/helm", read: async () => { throw new Error("refused"); },
        });
        assert.deepEqual(await charts.check(),
            { ready: false, reason: "can't read shared/helm: refused" });
    });
});

/* The real fetch, from a git server over HTTP: `git http-backend`
 * behind a small CGI bridge, as the git service serves repos. */
const BACKEND = ["/usr/lib/git-core/git-http-backend", "/usr/libexec/git-core/git-http-backend"]
    .find(p => fs.existsSync(p));

describe("EdgeCharts over HTTP", { skip: !BACKEND && "git http-backend is not installed" }, () => {
    let root, server, url;

    const git = (cwd, ...args) => execFileSync("git", args, {
        cwd, encoding: "utf8",
        env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.org",
            GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.org" },
    });

    /* A bare repo `charts.git` with the given branches, each holding a
     * values file. */
    function make_repo (branches) {
        const repo = path.join(root, "charts.git");
        const work = path.join(root, "work");
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
        git(root, "init", "-q", "--bare", "-b", "main", repo);
        git(root, "init", "-q", "-b", "main", work);
        for (const [branch, text] of Object.entries(branches)) {
            git(work, "checkout", "-q", "--orphan", branch);
            fs.mkdirSync(path.join(work, path.dirname(VALUES)), { recursive: true });
            fs.writeFileSync(path.join(work, VALUES), text);
            git(work, "add", "-A");
            git(work, "commit", "-q", "-m", branch);
            git(work, "push", "-q", repo, `${branch}:${branch}`);
        }
    }

    before(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "edge-charts-"));
        server = http.createServer((req, res) => {
            const u = new URL(req.url, "http://x");
            const cgi = spawn(BACKEND, [], { env: {
                ...process.env,
                GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1",
                REQUEST_METHOD: req.method, PATH_INFO: u.pathname,
                QUERY_STRING: u.search.slice(1),
                CONTENT_TYPE: req.headers["content-type"] ?? "",
                GIT_PROTOCOL: req.headers["git-protocol"] ?? "",
            } });
            req.pipe(cgi.stdin);
            const chunks = [];
            cgi.stdout.on("data", c => chunks.push(c));
            cgi.on("close", () => {
                const out = Buffer.concat(chunks);
                const split = out.indexOf("\r\n\r\n");
                const head = out.subarray(0, split).toString().split("\r\n");
                let status = 200;
                const headers = {};
                for (const line of head) {
                    const [k, ...v] = line.split(": ");
                    if (k.toLowerCase() == "status") status = parseInt(v.join(": "));
                    else headers[k] = v.join(": ");
                }
                res.writeHead(status, headers).end(out.subarray(split + 4));
            });
        });
        await new Promise(r => server.listen(0, "127.0.0.1", r));
        url = `http://127.0.0.1:${server.address().port}/charts.git`;
    });

    after(() => {
        server?.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    const charts = () => new EdgeCharts({
        fplus: { Git: { remote: async () => ({ url }) } },
        path: "shared/helm",
        dir: path.join(root, "check"),
    });

    test("reads both branches and compares them", async () => {
        make_repo({ main: NEW, acs: NEW });
        assert.equal((await charts().check()).ready, true);

        make_repo({ main: chart_values("v8.5.0"), acs: NEW });
        const r = await charts().check();
        assert.equal(r.ready, false);
        assert.match(r.reason, /tag v8.5.0 but this release is .* tag v9.0.0/);
    });

    test("a missing branch is not ready", async () => {
        make_repo({ main: NEW });
        assert.match((await charts().check()).reason, /branch acs has no/);
    });

    test("a server that can't be reached is not ready", async () => {
        const unreachable = new EdgeCharts({
            fplus: { Git: { remote: async () => ({ url: "http://127.0.0.1:1/charts.git" }) } },
            path: "shared/helm",
            dir: path.join(root, "check"),
        });
        assert.match((await unreachable.check()).reason, /^can't read shared\/helm: /);
    });
});
