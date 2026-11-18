/*
 * ACS Rust test driver
 * Generate the table that proves edge-test-rs matches the JS edge-test
 * Copyright 2026 University of Sheffield
 *
 * This runs the JS driver's own handler (edge-test/lib/test.js) over a
 * fixed set of addresses and times and writes what it returns, so that
 * tests/equivalence.rs can check the Rust driver gives the same bytes.
 * performance.now() is replaced with a fixed time for each row, so the
 * real poll() code runs unchanged.
 *
 * Run it from the top of the repository with the Node version the JS
 * driver's image uses:
 *
 *   docker run --rm -v "$PWD":/w -w /w node:22-alpine \
 *       node edge-test-rs/tests/equivalence/gen-table.mjs
 */

import fs from "node:fs";

import { TestHandler } from "../../../edge-test/lib/test.js";

const OUT = new URL("./table.json", import.meta.url);

const funcs = ["const", "sin", "saw"];
const packs = ["bd", "ld", "bf", "lf"];
/* Periods and amplitudes as typed in an address, including the forms
 * Number.parseFloat accepts that a strict parser would not. */
const periods = ["1000", "0.5", "7", "-250", "0", "3600000"];
const amplitudes = ["1", "-3.5", "0", "1e300"];
const times = [
    0, 0.001, 1, 250, 999.999, 1000, 12345.678, 86400000.123,
    1e9 + 0.5, 3.1536e10,
];

/* Address spellings that test the parser more than the waves. */
const odd = [
    "sin:1e3:2:bd", "sin: 42:1:bd", "sin:\t42:1:bd", "sin: 42:1:bd",
    "sin:﻿42:1:bd", "sin:10abc:1:bd", "sin:.5:1:bd", "sin:5.:1:bd",
    "sin:+3:1:bd", "sin:-0:1:bd", "sin:0x10:1:bd", "sin:1e:1:bd",
    "sin:1e+2x:1:bd", "sin:1E-1:1:bd", "sin:00012.50:1:bd",
    "sin:Infinity:1:bd", "sin:-Infinity:1:bd", "saw:Infinity:1:bd",
    "const:1:Infinity:bd", "const:1:-Infinity:lf", "const:1:+Infinityx:bd",
    "const:1:1e39:bf", "const:1:-1e39:lf", "const:1:1e-46:bf",
    "const:1:3.4028235677973366e38:bf", "const:1:5e-324:ld",
    "const:1:1.5e-310:bd", "const:1:0.1:bf", "const:1:16777217:lf",
    "saw:1e-300:1e300:bd", "sin:1e-300:1e300:ld",
    "const:1:123456789012345678901234567890:bd",
    "const:1:1.00000000000000011102230246251565404236316680908203125:bd",
    "const:1:4.9406564584124654e-324:bd",
];

/* Sine inputs where V8's fdlibm and glibc's sin round differently, so
 * a port using the platform's sin would fail on these rows. */
const sin_rounding = [
    ["sin:1000:1:bd", 18.221000000000046],
    ["sin:7:1:bd", 3.6990000000000003],
    ["sin:0.5:1:ld", 6.713000000000008],
    ["sin:3600000:1:bd", 3534.8740000012253],
    ["sin:60000:1:ld", 295.5090000000009],
    ["sin:1:1:bd", 5.891000000000005],
];

/* Addresses the JS driver rejects. */
const invalid = [
    "", "sin", "sin:1000:1", "sin:1000:1:bd:x", "sin:1000:1:bd:",
    "cos:1000:1:bd", "SIN:1000:1:bd", " sin:1000:1:bd", "sin:1000:1:BD",
    "sin:1000:1:bd ", "sin:1000:1:dd", "sin::1:bd", "sin:1000::bd",
    "sin:x:1:bd", "sin:1000:x:bd", "sin:-:1:bd", "sin:.:1:bd",
    "sin:e5:1:bd", "sin:NaN:1:bd", "sin:1000:nan:bd", "sin:inf:1:bd",
    "sin:infinity:1:bd", "sin:1000:1:", ":1000:1:bd", ":::",
    "sin:1000:1:b d", "sin:+:1:bd", "sin:\u00851:1:bd",
];

const handler = TestHandler.create(null, {});
let now = 0;
Object.defineProperty(performance, "now", {
    value:          () => now,
    configurable:   true,
});

const hex_of = v => {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(v);
    return b.toString("hex");
};

const rows = [];
async function add (addr, t) {
    const spec = handler.parseAddr(addr);
    if (!spec) throw new Error(`JS rejected ${JSON.stringify(addr)}`);
    now = t;
    const buf = await handler.poll(spec);
    rows.push({ addr, t, tbits: hex_of(t), out: buf.toString("hex") });
}

for (const f of funcs)
    for (const p of periods)
        for (const a of amplitudes)
            for (const k of packs)
                for (const t of times)
                    await add(`${f}:${p}:${a}:${k}`, t);
for (const addr of odd)
    for (const t of [0, 250, 12345.678])
        await add(addr, t);

for (const [addr, t] of sin_rounding)
    await add(addr, t);

for (const addr of invalid)
    if (handler.parseAddr(addr))
        throw new Error(`JS accepted ${JSON.stringify(addr)}`);

const lines = [
    "{",
    `"node": ${JSON.stringify(process.version)},`,
    `"invalid": ${JSON.stringify(invalid)},`,
    `"rows": [`,
    rows.map(r => JSON.stringify(r)).join(",\n"),
    "]}",
    "",
];
fs.writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${rows.length} rows and ${invalid.length} invalid addresses`);
