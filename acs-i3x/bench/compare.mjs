#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Send identical value requests to two bench servers (old build and
 * new build, same InfluxDB, same fleet) and compare the raw response
 * bodies byte for byte, plus the HTTP status.
 *
 *   node bench/compare.mjs --a http://127.0.0.1:58102 --b http://127.0.0.1:58101 --devices 2000
 *
 * Device requests are kept to 10 devices (--batch), and the two
 * servers are called one after the other, so the old build does not
 * hit the InfluxDB client's 10 s query timeout. At 50 devices it
 * already fails with "Request timed out" or ECONNRESET, which would
 * hide what it returns. A 5xx from the old build is retried up to
 * 5 times, 20 s apart; one that never succeeds is counted separately
 * as oldFailed, not as a content difference.
 */

import { parseArgs } from "node:util";
import { device, deviceUuid } from "./dataset.mjs";

const { values: a } = parseArgs({
    options: {
        a: { type: "string", default: "http://127.0.0.1:58102" },
        b: { type: "string", default: "http://127.0.0.1:58101" },
        devices: { type: "string", default: "2000" },
        batch: { type: "string", default: "10" },
    },
});
const n = Number(a.devices);
const batch = Number(a.batch);

async function call(base, method, path, body) {
    try {
        const res = await fetch(base + path, {
            method,
            headers: { "content-type": "application/json", "accept-encoding": "identity" },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, text: await res.text() };
    } catch (e) {
        return { status: 599, text: String(e.cause ?? e) };
    }
}

/* All objects, to pick leaves and inner compositions. */
const objs = JSON.parse((await call(a.b, "GET", "/v1/objects")).text);
const all = objs.result ?? objs;
const leaves = all.filter((o) => !o.isComposition).map((o) => o.elementId);
/* Skip compositions above 1,500 leaves (the ISA-95 levels, which span
 * the whole fleet): the old build fires one query per leaf and takes
 * minutes on them. test/history-influx.test.ts covers those levels on
 * a 120-device fleet. */
const kids = new Map();
for (const o of all) {
    if (!kids.has(o.parentId)) kids.set(o.parentId, []);
    kids.get(o.parentId).push(o);
}
const leafCount = (id) => (kids.get(id) ?? []).reduce((n, c) => n + (c.isComposition ? leafCount(c.elementId) : 1), 0);
const comps = all.filter((o) => o.isComposition && leafCount(o.elementId) <= 1500).map((o) => o.elementId);
const skipped = all.filter((o) => o.isComposition).length - comps.length;

const requests = [];
const devs = Array.from({ length: n }, (_, i) => deviceUuid(i));
for (const depth of [undefined, 0, 1, 2, 3]) {
    for (let i = 0; i < devs.length; i += batch) {
        const body = { elementIds: devs.slice(i, i + batch) };
        if (depth !== undefined) body.maxDepth = depth;
        requests.push(["POST", "/v1/objects/value", body]);
    }
}
/* Every leaf in the tree, in batches. */
for (let i = 0; i < leaves.length; i += 400) {
    requests.push(["POST", "/v1/objects/value", { elementIds: leaves.slice(i, i + 400) }]);
}
/* Every composition (ISA-95 levels, devices, sub-objects), mixed with
 * unknown ids and duplicates. */
for (let i = 0; i < comps.length; i += 200) {
    const ids = comps.slice(i, i + 200);
    requests.push(["POST", "/v1/objects/value", { elementIds: [...ids, "no-such-id", ids[0]], maxDepth: 0 }]);
}
/* Single-id GETs for a spread of devices, sub-objects and leaves. */
for (let i = 0; i < n; i += 37) {
    requests.push(["GET", `/v1/objects/${devs[i]}/value`]);
    const d = device(i);
    requests.push(["GET", `/v1/objects/${d.originMap.Status.Instance_UUID}/value`]);
}
for (let i = 0; i < leaves.length; i += 97) requests.push(["GET", `/v1/objects/${leaves[i]}/value`]);
requests.push(["GET", "/v1/objects/no-such-id/value"]);

let same = 0, differ = 0, bytes = 0, ok = 0, notOk = 0, retried = 0, oldFailed = 0;
for (const [method, path, body] of requests) {
    let ra = await call(a.a, method, path, body);
    for (let k = 0; k < 5 && ra.status >= 500; k++) {
        retried++;
        await new Promise((r) => setTimeout(r, 20_000));
        ra = await call(a.a, method, path, body);
    }
    if (ra.status >= 500) { oldFailed++; continue; }
    const rb = await call(a.b, method, path, body);
    bytes += ra.text.length;
    if (ra.status === 200 || ra.status === 206) ok++; else notOk++;
    if (ra.status === rb.status && ra.text === rb.text) { same++; continue; }
    differ++;
    if (differ <= 5) {
        console.log(`DIFF ${method} ${path} ${JSON.stringify(body ?? {}).slice(0, 120)}`);
        console.log(`  a ${ra.status} ${ra.text.slice(0, 300)}`);
        console.log(`  b ${rb.status} ${rb.text.slice(0, 300)}`);
    }
}
console.log(JSON.stringify({ requests: requests.length, identical: same, different: differ, bytesCompared: bytes, status2xx: ok, statusOther: notOk, oldRetried: retried, oldFailed, skippedLargeCompositions: skipped }));
process.exit(differ === 0 ? 0 : 1);
