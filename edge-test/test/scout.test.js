/*
 * Edge Agent testing driver
 * Edge Scout tests
 * Copyright 2026 University of Sheffield
 *
 * The first tests call the handler's scout directly. The later ones
 * run it inside the real driver library, on a fake MQTT client, and
 * check every message against lib/edge-scout-schemas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { PolledDriver } from "@amrc-factoryplus/edge-driver";

import { canonical_addr } from "../lib/addr.js";
import { FANOUT, find_folder, parse_options, value_addr } from "../lib/scout.js";
import { NoScoutTestHandler, TestHandler } from "../lib/test.js";

import {
    assert_tree, fake_out, found, items_of, ready_driver, scan,
} from "./harness.js";

async function run (options = {}, limits = {}, extra = {}) {
    const handler = new TestHandler();
    const out = fake_out(limits);
    const end = await handler.scout(
        { root: null, folder_id: null, options, limits: out.limits, ...extra }, out);
    return { end, items: out.items, out };
}

async function rejects_with (pr, code, pattern) {
    await assert.rejects(pr, e => {
        assert.equal(e.name, "ScoutError");
        assert.equal(e.code, code);
        if (pattern) assert.match(e.message, pattern);
        return true;
    });
}

/* The handler on its own */

test("the default scan lists 100 values in two folder levels", async () => {
    const { end, items, out } = await run();

    assert.deepEqual(end,
        { exhaustive: true, truncated: false, reason: null, excluded: [] });
    assert_tree(items);

    const values = items.filter(i => i.kind == "value");
    const folders = items.filter(i => i.kind == "folder");
    assert.equal(values.length, 100);
    assert.equal(folders.length, FANOUT + FANOUT * FANOUT);
    assert.ok(folders.every(f => f.more === false));
    assert.ok(values.every(v => /^f\/\d\/\d$/.test(v.parent)));
    assert.ok(out.paces > 0);
    assert.ok(out.progressed.length > 0);
});

test("every value has a canonical address the driver parses", async () => {
    const handler = new TestHandler();
    const { items } = await run({ size: 300 });

    for (const item of items.filter(i => i.kind == "value")) {
        assert.equal(item.id, item.address);
        assert.equal(canonical_addr(item.address), item.address);
        assert.ok(handler.parseAddr(item.address), item.address);
        assert.equal(item.path, "0");
        assert.ok(["Double", "Float"].includes(item.type));
        assert.equal(item.access, "r");
        assert.ok(!("sample" in item));
    }
    assert.equal(new Set(items.map(i => i.id)).size, items.length);
});

test("addresses are written in canonical form", () => {
    assert.equal(canonical_addr("sin:3000.0:50:bd"), "sin:3000:50:bd");
    assert.equal(canonical_addr("saw:1e3:0.50:lf"), "saw:1000:0.5:lf");
    assert.equal(canonical_addr("sin:3000:50"), undefined);
    assert.equal(canonical_addr("constructor:1:1:bd"), undefined);
    assert.equal(value_addr(0), "sin:1000:1:bd");
    assert.equal(value_addr(13), "saw:1013:4:ld");
});

test("the tree depends only on the options", async () => {
    const a = await run({ size: 57, depth: 3 });
    const b = await run({ size: 57, depth: 3 });
    assert.deepEqual(a.items, b.items);
});

test("depth 0 lists the values at the top", async () => {
    const { items } = await run({ size: 7, depth: 0 });
    assert.equal(items.length, 7);
    assert.ok(items.every(i => i.kind == "value" && i.parent === null));
});

test("a small tree leaves out empty folders", async () => {
    const { items } = await run({ size: 2, depth: 2 });
    assert_tree(items);
    assert.equal(items.filter(i => i.kind == "value").length, 2);
    for (const folder of items.filter(i => i.kind == "folder"))
        assert.ok(folder.detail.count > 0);
});

test("size 0 lists nothing", async () => {
    const { end, items } = await run({ size: 0 });
    assert.equal(items.length, 0);
    assert.equal(end.exhaustive, true);
});

test("a branch scan lists the same ids as the full scan", async () => {
    const options = { size: 200, depth: 3 };
    const full = (await run(options)).items;
    const by_id = new Map(full.map(i => [i.id, i]));

    for (const folder of full.filter(i => i.kind == "folder")) {
        const { items } = await run(options, {},
            { root: folder.id, folder_id: folder.id });

        assert.equal(items[0].id, folder.id);
        assert.deepEqual(items[0], folder);
        assert_tree(items, folder.parent);

        /* The subtree of the folder in the full scan. */
        const inside = new Set([folder.id]);
        for (const item of full)
            if (inside.has(item.parent)) inside.add(item.id);
        assert.deepEqual(new Set(items.map(i => i.id)), inside);
        for (const item of items)
            assert.deepEqual(item, by_id.get(item.id));
    }
});

test("a root with no folder_id lists the folder's contents", async () => {
    const { items } = await run({}, {}, { root: "f/2" });
    assert.ok(items.length > 0);
    assert.ok(items.every(i => i.id != "f/2"));
    assert.ok(items.some(i => i.parent == "f/2"));
});

test("a folder at the depth cap has more and ends truncated", async () => {
    const { end, items } = await run({ size: 100, depth: 3 }, { depth: 2 });

    assert.deepEqual(end,
        { exhaustive: true, truncated: true, reason: "depth", excluded: [] });
    const folders = items.filter(i => i.kind == "folder");
    assert.equal(folders.length, FANOUT + FANOUT * FANOUT);
    assert.ok(folders.filter(f => f.id.split("/").length == 3).every(f => f.more));
    assert.ok(folders.filter(f => f.id.split("/").length == 2).every(f => !f.more));
    assert.equal(items.filter(i => i.kind == "value").length, 0);
});

test("the depth cap counts from a branch scan's folder", async () => {
    const { end, items } = await run({ size: 100, depth: 3 }, { depth: 1 },
        { root: "f/1", folder_id: "f/1" });
    assert.equal(end.reason, "depth");
    assert.equal(items[0].id, "f/1");
    assert.ok(items.slice(1).every(i => i.kind == "folder" && i.more));
});

test("samples are read only when the limits ask", async () => {
    const { items } = await run({ size: 8, depth: 0 }, { samples: true });
    for (const item of items) {
        assert.equal(typeof item.sample, "string");
        assert.ok(Number.isFinite(Number(item.sample)), item.sample);
    }
});

test("duplicates sends the first ten values again", async () => {
    const { items, out } = await run({ size: 30, depth: 1, duplicates: true });
    const values = items.filter(i => i.kind == "value");
    assert.equal(values.length, 40);
    assert.deepEqual(values.slice(30), values.slice(0, 10));
    assert.equal(out.calls.at(-1), 10);
});

test("fail ends the scan with the code, after the items asked for", async () => {
    await rejects_with(run({ fail: "CONN" }), "CONN", /asked to fail/);

    const handler = new TestHandler();
    const out = fake_out();
    await rejects_with(handler.scout(
        { root: null, folder_id: null, options: { fail: "ERR", after: 10 }, limits: out.limits },
        out), "ERR");
    assert.ok(out.items.length >= 10);
    assert.ok(out.items.length < 100);
});

test("delay_ms waits before each listing and wakes on cancel", async () => {
    const handler = new TestHandler();
    const out = fake_out();
    const started = Date.now();
    const pr = handler.scout(
        { root: null, folder_id: null, options: { delay_ms: 10000 }, limits: out.limits },
        out);
    setTimeout(() => out.abort(), 50);
    await pr;
    assert.ok(Date.now() - started < 2000);
    assert.equal(out.items.length, 0);
});

test("bad options and roots give OPTIONS", async () => {
    await rejects_with(run({ colour: "red" }), "OPTIONS", /colour/);
    await rejects_with(run({ size: -1 }), "OPTIONS", /size/);
    await rejects_with(run({ size: 1.5 }), "OPTIONS", /size/);
    await rejects_with(run({ depth: 33 }), "OPTIONS", /depth/);
    await rejects_with(run({ hang: "yes" }), "OPTIONS", /hang/);
    await rejects_with(run({ duplicates: 3 }), "OPTIONS", /duplicates/);
    await rejects_with(run({ fail: "BUSY" }), "OPTIONS", /fail/);
    await rejects_with(run({}, {}, { root: "f/9", folder_id: "f/9" }), "OPTIONS", /f\/9/);
    await rejects_with(run({}, {}, { root: "sin:1000:1:bd", folder_id: "sin:1000:1:bd" }),
        "OPTIONS", /not a folder/);
    await rejects_with(run({ depth: 1 }, {}, { root: "f/0/0", folder_id: "f/0/0" }),
        "OPTIONS");
    await rejects_with(run({}, {}, { root: "f/1", folder_id: "f/2" }), "OPTIONS", /folder_id/);
});

test("null options take their defaults", () => {
    assert.deepEqual(parse_options({ size: null, fail: null }), parse_options({}));
    assert.equal(parse_options(undefined).size, 100);
});

test("find_folder knows which folders exist", () => {
    const opts = parse_options({ size: 3, depth: 2 });
    assert.ok(find_folder("f/1", opts));
    assert.equal(find_folder("f/0", opts), undefined);
    assert.equal(find_folder("f/1/0/0", opts), undefined);
    assert.equal(find_folder("g/1", opts), undefined);
    assert.equal(find_folder("f", opts), undefined);
    assert.equal(find_folder("f/10", opts), undefined);
});

/* Inside the driver library */

test("the driver answers hello with supported", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    await driver.handleMessage("fpEdge1/Conn/scout",
        Buffer.from(JSON.stringify({ op: "hello", version: 1 })));
    const [hello] = found(driver, "hello");
    assert.equal(hello.supported, true);
    assert.match(hello.library, /^js-edge-driver/);
});

test("a full scan through the library is valid on the wire", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    const msgs = await scan(driver, "scan1", { options: { size: 1200, depth: 1 } });

    assert.equal(msgs[0].type, "accept");
    const end = msgs.at(-1);
    assert.deepEqual(end, { seq: end.seq, type: "end", exhaustive: true,
        truncated: false, reason: null, excluded: [] });
    const items = items_of(msgs);
    assert.equal(items.length, 1200 + FANOUT);
    assert_tree(items);
    assert.ok(msgs.filter(m => m.type == "items").every(m => m.items.length <= 500));
});

test("the item cap truncates the scan", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    const msgs = await scan(driver, "cap", {
        options: { size: 1000 }, limits: { items: 50 } });
    assert.equal(items_of(msgs).length, 50);
    const end = msgs.at(-1);
    assert.equal(end.truncated, true);
    assert.equal(end.reason, "items");
});

test("hang keeps the scan open until the time limit", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    const started = Date.now();
    const msgs = await scan(driver, "hang", {
        options: { hang: true, after: 20 }, limits: { seconds: 1 } });
    assert.ok(Date.now() - started >= 1000);
    assert.ok(items_of(msgs).length >= 20);
    const end = msgs.at(-1);
    assert.equal(end.truncated, true);
    assert.equal(end.reason, "seconds");
});

test("cancel ends a slow scan with CANCELLED", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    const started = Date.now();
    setTimeout(() => driver.handleMessage("fpEdge1/Conn/scout",
        Buffer.from(JSON.stringify({ op: "cancel", id: "slow" }))), 100);
    const msgs = await scan(driver, "slow", { options: { delay_ms: 5000 } });
    assert.ok(Date.now() - started < 2000);
    assert.equal(msgs.at(-1).error.code, "CANCELLED");
});

test("fail options reach the wire as library codes", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    for (const code of ["OPTIONS", "CONN", "AUTH", "ERR", "UNSUPPORTED"]) {
        const id = `fail_${code}`;
        const msgs = await scan(driver, id, { options: { fail: code } });
        assert.equal(msgs.at(-1).error.code, code);
    }
    const bad = await scan(driver, "bad", { options: { size: "lots" } });
    assert.equal(bad.at(-1).error.code, "OPTIONS");
});

test("duplicates reach the wire for the Edge Agent to drop", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    const msgs = await scan(driver, "dups", { options: { size: 20, duplicates: true } });
    const ids = items_of(msgs).map(i => i.id);
    assert.equal(ids.length - new Set(ids).size, 10);
});

test("a branch scan through the library starts with its folder", async () => {
    const driver = await ready_driver(PolledDriver, TestHandler);
    const msgs = await scan(driver, "branch", { root: "f/3", folder_id: "f/3" });
    const items = items_of(msgs);
    assert.equal(items[0].id, "f/3");
    assert.equal(items.filter(i => i.kind == "value").length, 25);
});

test("NoScoutTestHandler answers UNSUPPORTED", async () => {
    const driver = await ready_driver(PolledDriver, NoScoutTestHandler);
    await driver.handleMessage("fpEdge1/Conn/scout",
        Buffer.from(JSON.stringify({ op: "hello", version: 1 })));
    assert.equal(found(driver, "hello")[0].supported, false);

    const msgs = await scan(driver, "nope");
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].error.code, "UNSUPPORTED");
});

/* Polling, which the scan code must not change */

test("parseAddr and poll still pack values", async () => {
    const handler = new TestHandler();
    assert.equal(handler.parseAddr("sin:3000:50"), undefined);
    assert.equal(handler.parseAddr("tan:3000:50:bd"), undefined);
    assert.equal(handler.parseAddr("sin:x:50:bd"), undefined);
    assert.equal(handler.parseAddr("sin:3000:50:xx"), undefined);

    const d = handler.parseAddr("const:1000:2.5:bd");
    assert.equal(d.size, 8);
    assert.equal((await handler.poll(d)).readDoubleBE(0), 2.5);

    const f = handler.parseAddr("const:1000:2.5:lf");
    assert.equal(f.size, 4);
    assert.equal((await handler.poll(f)).readFloatLE(0), 2.5);
});
