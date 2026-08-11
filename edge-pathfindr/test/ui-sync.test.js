/*
 * ACS Pathfindr driver
 * The inlined metric panel must match its source.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 *
 * The panel lives twice: as an editable HTML file, and inlined into the
 * service-setup dump that seeds the driver definition into ConfigDB. Drift
 * between them would ship an interface nobody had reviewed, so this fails
 * the build instead.
 */

import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { SOURCE, DUMP, extract } from "../tools/inline-ui.js";

/* The ConfigDB body limit, which the whole driver definition must fit
 * inside. See deploy/values.yaml, configdb.bodyLimit. */
const CONFIGDB_BODY_LIMIT = 100 * 1024;

test("the inlined panel matches ui/metric-panel.html", () => {
    const html = fs.readFileSync(SOURCE, "utf8");
    const inlined = extract(fs.readFileSync(DUMP, "utf8"));

    assert.ok(inlined, "markers missing from edge.yaml");
    assert.equal(inlined, html,
        "edge.yaml is out of date; run `node tools/inline-ui.js`");
});

test("the panel fits inside the ConfigDB body limit", () => {
    const html = fs.readFileSync(SOURCE, "utf8");
    /* The rest of the driver definition (schema, presentation) shares the
     * budget, so leave real headroom rather than creeping up on it. */
    assert.ok(html.length < CONFIGDB_BODY_LIMIT / 2,
        `panel is ${html.length} bytes; the whole driver definition must fit `
        + `in ${CONFIGDB_BODY_LIMIT}`);
});

test("the panel is self-contained", () => {
    const html = fs.readFileSync(SOURCE, "utf8");

    /* The frame is served with `default-src 'none'`, so any external
     * reference would silently fail to load at runtime. */
    assert.equal(/<script[^>]+\ssrc=/i.test(html), false,
        "external script would be blocked by the frame's CSP");
    assert.equal(/<link[^>]+stylesheet/i.test(html), false,
        "external stylesheet would be blocked by the frame's CSP");
    assert.equal(/https?:\/\/(?!www\.w3\.org)/i.test(
        html.replace(/<!--[\s\S]*?-->/g, "")), false,
        "absolute URL in the panel would be blocked by the frame's CSP");
});

test("the panel speaks the contract version the Manager expects", () => {
    const html = fs.readFileSync(SOURCE, "utf8");
    assert.match(html, /ENVELOPE\s*=\s*"fpDriverUi"/);
    assert.match(html, /VERSION\s*=\s*1/);
    /* It must announce itself, or the Manager falls back after the
     * handshake timeout. */
    assert.match(html, /type:\s*"ready"/);
});
