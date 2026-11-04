/*
 * ACS ConfigDB
 * Tests for the ISA-95 Placement special app's ancestry check
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { placement_problem } from "../lib/special.js";

/* A lookup over a small in-memory vocabulary:
 * Acme / Site1 / Area1, plus broken nodes. */
const vocab = {
    acme:   { level: "Enterprise", children: ["site1", "skip"] },
    site1:  { level: "Site", children: ["area1", "shared"] },
    site2:  { level: "Site", children: ["shared"] },
    area1:  { level: "Area", children: [] },
    skip:   { level: "Area", children: [] },
    shared: { level: "Area", children: [] },
    orphan: { level: "Area", children: [] },
    device: { level: undefined, children: [] },
};
/* site2 has no Enterprise above it. */

const lookup = {
    level_of: async u => vocab[u]?.level,
    parents_of: async u => Object.entries(vocab)
        .filter(([, n]) => n.children.includes(u))
        .map(([k]) => k),
};

test("a node with a clean chain to its Enterprise is accepted", async () => {
    assert.equal(await placement_problem({ node: "area1" }, lookup), undefined);
    assert.equal(await placement_problem({ node: "acme" }, lookup), undefined);
    assert.equal(await placement_problem({ node: "site1", instances: {} }, lookup), undefined);
});

test("a placement with no node is refused", async () => {
    assert.match(await placement_problem({}, lookup), /no node/);
    assert.match(await placement_problem(null, lookup), /no node/);
});

test("an object that is not a vocabulary node is refused", async () => {
    assert.match(await placement_problem({ node: "device" }, lookup), /no ISA-95 level/);
    assert.match(await placement_problem({ node: "nothing" }, lookup), /no ISA-95 level/);
});

test("a chain that skips a level is refused", async () => {
    assert.match(await placement_problem({ node: "skip" }, lookup), /skips a level/);
});

test("a node with two parents is refused", async () => {
    assert.match(await placement_problem({ node: "shared" }, lookup), /more than one parent/);
});

test("a node with no parent is refused", async () => {
    assert.match(await placement_problem({ node: "orphan" }, lookup), /no Site above it/);
});

test("a cycle in the vocabulary is refused", async () => {
    const loop = {
        level_of: async () => "Area",
        parents_of: async u => [u == "a" ? "b" : "a"],
    };
    assert.ok(await placement_problem({ node: "a" }, loop));
});
