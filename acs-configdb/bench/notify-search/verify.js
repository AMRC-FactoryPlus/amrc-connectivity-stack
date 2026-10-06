/*
 * ACS ConfigDB
 * Notify correctness check against the real ConfigDB (bench/notify-search/server.js).
 * Copyright 2026 University of Sheffield AMRC
 *
 * Opens SEARCH (with and without a filter), single-config WATCH, config
 * list WATCH and class member WATCH subscriptions, makes a scripted set
 * of changes, and compares every message each client receives with the
 * exact expected stream. Then it opens a SEARCH on a large app and
 * writes to it while that SEARCH's snapshot is loading, and checks the
 * client ends up with the database state.
 *
 * Usage: DRIVER=verify.js bench/notify-search/run.sh <label>
 * Exits non-zero if any stream differs.
 */

import assert from "assert/strict";
import { parseArgs } from "util";
import { randomUUID } from "crypto";

import WebSocket from "ws";

const { values: opt } = parseArgs({ strict: false, options: {
    base:   { type: "string", default: "http://localhost:8710" },
    token:  { type: "string", default: "benchtoken" },
    out:    { type: "string" },
}});

const R1Class = "04a1c90d-2295-4cbe-b33a-74eded62cbf1";
const AppClass = "d319bd87-f42b-4b66-be4f-f82ff48b93f0";
const DeviceInformation = "a98ffed5-c613-4e70-bfd3-efeee250ade5";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = () => sleep(300);

async function http (method, path, body) {
    const res = await fetch(`${opt.base}${path}`, {
        method,
        headers: {
            "Authorization": `Bearer ${opt.token}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status >= 300)
        throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : undefined;
}

async function client () {
    const ws = new WebSocket(opt.base.replace(/^http/, "ws") + "/notify/v2",
        { maxPayload: 1 << 30 });
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    ws.send(`Bearer ${opt.token}`);
    await new Promise(r => ws.once("message", r));
    const got = new Map();
    ws.on("message", m => {
        const { uuid, ...u } = JSON.parse(m);
        got.get(uuid)?.push(u);
    });
    return {
        ws,
        sub (req) {
            const uuid = randomUUID();
            const msgs = [];
            got.set(uuid, msgs);
            ws.send(JSON.stringify({ ...req, uuid }));
            return msgs;
        },
    };
}

/* Replace object UUIDs with names, etags with "E", sort list bodies. */
function normaliser (names) {
    const nm = s => names.get(s) ?? s;
    const walk = v => {
        if (Array.isArray(v)) return v.map(walk).map(nm).sort();
        if (v && typeof v == "object") {
            return Object.fromEntries(Object.entries(v).map(([k, x]) =>
                k == "etag" ? [k, "E"]
                : k == "child" ? [k, nm(x)]
                : k == "children" ? [k, Object.fromEntries(
                    Object.entries(x).map(([c, r]) => [nm(c), walk(r)]))]
                : [k, walk(x)]));
        }
        return nm(v);
    };
    return walk;
}

const ok = body => ({ status: 200, body });
const okE = body => ({ status: 200, body, headers: { etag: "E" } });
const child = (c, body) => ({ status: 200, child: c, response: ok(body) });

async function main () {
    const names = new Map();
    const mk = async (cls, name) => {
        const o = await http("POST", "/v2/object", { class: cls });
        names.set(o.uuid, name);
        return o.uuid;
    };
    const A = await mk(AppClass, "A");
    const K = await mk(R1Class, "K");
    const O1 = await mk(K, "O1");
    const O2 = await mk(K, "O2");
    const put = (o, body) => http("PUT", `/v2/app/${A}/object/${o}`, body);

    const c = await client();
    const S1 = c.sub({ method: "SEARCH", parent: `v2/app/${A}/object/` });
    const S2 = c.sub({ method: "SEARCH", parent: `v2/app/${A}/object/`,
        filter: { kind: "x" } });
    const W1 = c.sub({ method: "WATCH", request: { url: `v2/app/${A}/object/${O1}` } });
    const L1 = c.sub({ method: "WATCH", request: { url: `v2/app/${A}/object/` } });
    const C1 = c.sub({ method: "WATCH", request: { url: `v2/class/${K}/member/` } });
    await settle();

    await put(O1, { kind: "x", n: 1 });                 await settle();
    await put(O2, { kind: "y", n: 2 });                 await settle();
    await put(O1, { kind: "x", n: 3 });                 await settle();
    await put(O1, { kind: "x", n: 3 });                 await settle();  /* no change */
    await http("DELETE", `/v2/app/${A}/object/${O2}`);  await settle();
    await http("POST", "/bench/acl", { app: A, allow: false });
    await put(O1, { kind: "x", n: 4 });                 await settle();
    await put(O1, { kind: "x", n: 5 });                 await settle();
    await http("POST", "/bench/acl", { app: A, allow: true });
    await put(O2, { kind: "x", n: 6 });                 await settle();
    await put(O1, { kind: "x", n: 7 });                 await settle();
    const O3 = await mk(K, "O3");                       await settle();
    await http("DELETE", `/v2/object/${O3}`);           await settle();

    const norm = normaliser(names);
    const results = {};
    const check = (name, got, want) => {
        const g = norm(got);
        try {
            assert.deepEqual(g, want);
            results[name] = "ok";
        }
        catch (e) {
            results[name] = { got: g, want };
        }
    };

    check("SEARCH", S1, [
        { status: 201, children: {}, response: { status: 204 } },
        child("O1", { kind: "x", n: 1 }),
        child("O2", { kind: "y", n: 2 }),
        child("O1", { kind: "x", n: 3 }),
        { status: 200, child: "O2", response: { status: 404 } },
        { status: 200, response: { status: 403 } },
        { status: 200, response: { status: 204 }, children: {
            O1: okE({ kind: "x", n: 5 }), O2: okE({ kind: "x", n: 6 }),
        } },
        child("O1", { kind: "x", n: 7 }),
    ]);
    check("SEARCH filter", S2, [
        { status: 201, children: {}, response: { status: 204 } },
        child("O1", { kind: "x", n: 1 }),
        child("O1", { kind: "x", n: 3 }),
        { status: 200, response: { status: 403 } },
        { status: 200, response: { status: 204 }, children: {
            O1: okE({ kind: "x", n: 5 }), O2: okE({ kind: "x", n: 6 }),
        } },
        child("O1", { kind: "x", n: 7 }),
    ]);
    check("WATCH config", W1, [
        { status: 201, response: { status: 404 } },
        { status: 200, response: ok({ kind: "x", n: 1 }) },
        { status: 200, response: ok({ kind: "x", n: 3 }) },
        { status: 200, response: { status: 403 } },
        { status: 200, response: ok({ kind: "x", n: 7 }) },
    ]);
    check("WATCH config list", L1, [
        { status: 201, response: ok([]) },
        { status: 200, response: ok(["O1"]) },
        { status: 200, response: ok(["O1", "O2"]) },
        { status: 200, response: ok(["O1"]) },
        /* No 403 here: the list did not change while access was denied,
         * and set_contents drops unchanged lists before the ACL check. */
        { status: 200, response: ok(["O1", "O2"]) },
    ]);
    check("WATCH class members", C1, [
        { status: 201, response: ok(["O1", "O2"]) },
        { status: 200, response: ok(["O1", "O2", "O3"]) },
        { status: 200, response: ok(["O1", "O2"]) },
    ]);

    /* Burst during a pending snapshot of a large app. */
    const devs = await Promise.all(Array.from({ length: 20 }, () =>
        http("POST", "/v2/object", { class: R1Class })));
    const tmpl = await http("GET", `/v2/app/${DeviceInformation}/object/`)
        .then(l => http("GET", `/v2/app/${DeviceInformation}/object/${l[0]}`));
    const S3 = c.sub({ method: "SEARCH", parent: `v2/app/${DeviceInformation}/object/` });
    await Promise.all(devs.map((d, i) =>
        http("PUT", `/v2/app/${DeviceInformation}/object/${d.uuid}`,
            { ...tmpl, node: `n${i}` })));
    const db = new Set(await http("GET", `/v2/app/${DeviceInformation}/object/`));
    for (let i = 0; i < 600; i++) {
        await sleep(100);
        const fulls = S3.filter(u => u.children);
        const last = S3.at(-1);
        if (fulls.length && last && S3.indexOf(fulls.at(-1)) >= 0) {
            /* Build the client's state. */
            let map;
            for (const u of S3) {
                if (u.children) map = new Map(Object.entries(u.children));
                else if (u.child) map.set(u.child, u.response);
            }
            const done = devs.every((d, i) => map.get(d.uuid)?.body?.node == `n${i}`);
            if (done && map.size == db.size) break;
        }
    }
    let map;
    for (const u of S3) {
        if (u.children) map = new Map(Object.entries(u.children));
        else if (u.child) map.set(u.child, u.response);
    }
    const burst = {
        full_messages:  S3.filter(u => u.children).length,
        messages:       S3.length,
        matches_db:     map?.size == db.size && [...db].every(o => map.has(o))
                        && devs.every((d, i) => map.get(d.uuid)?.body?.node == `n${i}`),
    };
    results["SEARCH burst during snapshot"] = burst.matches_db ? "ok" : burst;

    const out = { results, burst };
    console.log(JSON.stringify(out, null, 2));
    if (opt.out) (await import("fs")).writeFileSync(opt.out, JSON.stringify(out, null, 2));
    c.ws.close();
    const failed = Object.values(results).some(r => r != "ok");
    process.exit(failed ? 1 : 0);
}

await main();
