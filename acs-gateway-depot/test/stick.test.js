/*
 * ACS Gateway Depot
 * Tests for what the service reports about the depot stick.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert       from "node:assert/strict";
import fs           from "node:fs";
import os           from "node:os";
import path         from "node:path";
import { test }     from "node:test";

import { DepotError }   from "../lib/errors.js";
import { Stick }        from "../lib/stick.js";

const debug = { bound: () => () => {} };
const NAME = "depot-stick-amd64.iso";

function setup () {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "stick-test-"));
    const dir = path.join(top, "stick");
    const gateway_dir = path.join(top, "gateway");
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(gateway_dir, "agent"), { recursive: true });
    fs.writeFileSync(path.join(gateway_dir, "agent", "agent.py"), "print('scout')\n");
    const stick = new Stick({
        fplus: { debug }, dir, gateway_dir,
        public_url: "https://gateway-depot.example.org",
        versions:   { UBUNTU_VERSION: "24.04.5" },
    });
    return { dir, stick };
}

function bake (dir, made_from) {
    fs.writeFileSync(path.join(dir, NAME), "image");
    fs.writeFileSync(path.join(dir, NAME + ".json"), JSON.stringify({
        arch: "amd64", ubuntu: "24.04.5", size: 5, built_at: 1795082353000, made_from,
    }));
}

test("no stick has been built", () => {
    const { stick } = setup();
    assert.deepEqual(stick.status(), { state: "none" });
    assert.throws(() => stick.path_for(NAME), DepotError);
});

test("a service with no stick volume has no stick", () => {
    const { stick } = setup();
    stick.dir = undefined;
    assert.deepEqual(stick.status(), { state: "none" });
});

test("a build is under way", () => {
    const { dir, stick } = setup();
    fs.writeFileSync(path.join(dir, "building"), `${Math.floor(Date.now() / 1000)}\n`);
    assert.deepEqual(stick.status(), { state: "building" });
});

test("a build that started hours ago has died", () => {
    const { dir, stick } = setup();
    fs.writeFileSync(path.join(dir, "building"), `${Math.floor(Date.now() / 1000) - 7200}\n`);
    assert.deepEqual(stick.status(), { state: "none" });
});

test("a current stick is ready to download", () => {
    const { dir, stick } = setup();
    bake(dir, stick.made_from());
    const st = stick.status();
    assert.equal(st.state, "ready");
    assert.equal(st.current, true);
    assert.equal(st.size, 5);
    assert.equal(st.url, `https://gateway-depot.example.org/v1/payload/${NAME}`);
    assert.equal(stick.path_for(NAME), path.join(dir, NAME));
    assert.throws(() => stick.path_for("other.iso"), DepotError);
});

test("a stick built from other inputs is not current", () => {
    const { dir, stick } = setup();
    bake(dir, "0000");
    const st = stick.status();
    assert.equal(st.state, "ready");
    assert.equal(st.current, false);
});

test("a manifest with no image is no stick", () => {
    const { dir, stick } = setup();
    bake(dir, stick.made_from());
    fs.rmSync(path.join(dir, NAME));
    assert.deepEqual(stick.status(), { state: "none" });
});
