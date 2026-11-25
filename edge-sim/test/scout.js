/*
 * ACS simulator driver
 * Edge Scout tests
 * Copyright 2026 University of Sheffield
 *
 * The first tests call the scouter directly. The later ones run the
 * real driver library on a fake MQTT client and check every message
 * against lib/edge-scout-schemas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AsyncDriver } from "@amrc-factoryplus/edge-driver";

import { validateCassette } from "../lib/cassette.js";
import { Player } from "../lib/player.js";
import {
    PLAYER_FOLDER, PlayerItems, build_tree, plain_type, read_cassette, scout_cassette,
} from "../lib/scout.js";
import { SimHandler } from "../lib/sim.js";

import {
    assert_tree, check_value, fake_out, found, items_of, ready_driver, scan,
} from "./lib/harness.js";

const DOC = {
    cassette: { name: "cnc", version: 1, duration_ms: 3000 },
    channels: [
        { id: 0, path: "Axes/X/Position", type: "DoubleLE", engUnit: "mm" },
        { id: 1, path: "Axes/Y/Position", type: "DoubleBE", engUnit: "mm" },
        { id: 2, path: "Spindle/Speed", type: "Float", engUnit: "rpm" },
        { id: 3, path: "Status", type: "String" },
        { id: 4, path: "Spindle", type: "Mystery" },
        { id: 5, path: "Axes/X/Load" },
    ],
    samples: [
        [0, 3, "Idle"],
        [0, 0, 1.5],
        [1000, 0, 2.5],
        [1000, 3, "Running"],
        [2000, 2, 3000],
    ],
};

function loaded_player (doc = DOC) {
    const player = new Player({ emit: () => {}, onState: () => {} });
    player.load(validateCassette(structuredClone(doc)));
    return player;
}

async function run (player, limits = {}, extra = {}) {
    const out = fake_out(limits);
    const end = await scout_cassette({ cassette: player?.cassette, player },
        { root: null, folder_id: null, options: {}, limits: out.limits, ...extra },
        out);
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

/* The scouter on its own */

test("no cassette gives an empty, exhaustive scan", async () => {
    const player = new Player({ emit: () => {} });
    const { end, items } = await run(player);
    assert.deepEqual(end,
        { exhaustive: true, truncated: false, reason: null, excluded: [] });
    assert.equal(items.length, 0);
});

test("a cassette lists its channels in folders and the player", async () => {
    const { end, items } = await run(loaded_player());
    assert.equal(end.exhaustive, true);
    assert.equal(end.truncated, false);
    assert_tree(items);

    const ids = items.map(i => i.id);
    assert.deepEqual(new Set(ids), new Set([
        PLAYER_FOLDER, ...PlayerItems.map(p => `player:${p.verb}`),
        "Axes/", "Axes/X/", "Axes/Y/", "Spindle/",
        "Axes/X/Position", "Axes/Y/Position", "Spindle/Speed", "Status",
        "Spindle", "Axes/X/Load",
    ]));

    const by_id = new Map(items.map(i => [i.id, i]));
    assert.deepEqual(by_id.get("Axes/X/Position"), {
        id: "Axes/X/Position", parent: "Axes/X/", name: "Position",
        kind: "value", address: "Axes/X/Position", path: "$.value",
        type: "Double", access: "r", unit: "mm",
        detail: { channel: 0, cassette_type: "DoubleLE" },
    });
    assert.deepEqual(by_id.get("Axes/X/"), {
        id: "Axes/X/", parent: "Axes/", name: "X", kind: "folder", more: false,
    });
    assert.equal(by_id.get("Status").parent, null);
    assert.equal(by_id.get("Spindle/Speed").type, "Float");
    assert.equal(by_id.get("Spindle").type, null);
    assert.equal(by_id.get("Axes/X/Load").type, null);
    assert.equal(by_id.get("Axes/X/Load").unit, undefined);
});

test("a channel that is also a folder gets a value and a folder", async () => {
    const { items } = await run(loaded_player());
    const value = items.find(i => i.id == "Spindle");
    const folder = items.find(i => i.id == "Spindle/");
    assert.equal(value.kind, "value");
    assert.equal(folder.kind, "folder");
    assert.equal(items.find(i => i.id == "Spindle/Speed").parent, "Spindle/");
});

test("every address parses, and lists in the form the driver uses", async () => {
    const handler = Object.create(SimHandler.prototype);
    const { items } = await run(loaded_player());
    for (const item of items.filter(i => i.kind == "value")) {
        const spec = handler.parseAddr(item.address);
        assert.ok(spec, item.address);
        assert.equal(spec.addr, item.address);
    }
});

test("player addresses say what they do", async () => {
    const { items } = await run(loaded_player());
    const player = items.filter(i => i.parent == PLAYER_FOLDER);
    assert.equal(player.length, 12);
    for (const item of player) {
        assert.ok(item.description.length > 0);
        if (item.access == "w") assert.equal(item.path, null);
        else assert.equal(item.path, "$.value");
    }
    assert.equal(player.find(i => i.id == "player:rate").type, "Double");
    assert.equal(player.find(i => i.id == "player:status").access, "r");
});

test("samples come from the player's position", async () => {
    const player = loaded_player();
    player.seek(1500);
    const { items } = await run(player, { samples: true });
    const by_id = new Map(items.map(i => [i.id, i]));
    assert.equal(by_id.get("Axes/X/Position").sample, "2.5");
    assert.equal(by_id.get("Status").sample, "Running");
    assert.equal(by_id.get("Spindle/Speed").sample, null);
    assert.equal(by_id.get("player:position").sample, "1500");
    assert.equal(by_id.get("player:status").sample, "LOADED");
    assert.equal(by_id.get("player:load").sample, undefined);

    const plain = await run(player);
    assert.ok(plain.items.every(i => !("sample" in i)));
});

test("a branch scan starts with its folder and lists its subtree", async () => {
    const player = loaded_player();
    const full = (await run(player)).items;

    for (const folder of full.filter(i => i.kind == "folder")) {
        const { items } = await run(player, {}, { root: folder.id, folder_id: folder.id });
        assert.deepEqual(items[0], folder);
        assert_tree(items, folder.parent);

        const inside = new Set([folder.id]);
        for (const item of full)
            if (inside.has(item.parent)) inside.add(item.id);
        assert.deepEqual(new Set(items.map(i => i.id)), inside);
    }
});

test("a folder at the depth cap has more and ends truncated", async () => {
    const { end, items } = await run(loaded_player(), { depth: 1 });
    assert.equal(end.truncated, true);
    assert.equal(end.reason, "depth");
    assert.ok(items.filter(i => i.kind == "folder").every(f => f.more));
    assert.ok(items.every(i => i.parent === null));
});

test("bad options and roots give OPTIONS", async () => {
    const player = loaded_player();
    await rejects_with(run(player, {}, { options: { filters: ["#"] } }), "OPTIONS", /filters/);
    await rejects_with(run(player, {}, { root: "Nope/", folder_id: "Nope/" }), "OPTIONS", /Nope/);
    await rejects_with(run(player, {}, { root: "Status", folder_id: "Status" }), "OPTIONS");
    await rejects_with(run(player, {}, { root: "Axes/", folder_id: "Spindle/" }),
        "OPTIONS", /folder_id/);
    await rejects_with(run(new Player({ emit: () => {} }), {},
        { root: "Axes/", folder_id: "Axes/" }), "OPTIONS", /No cassette/);
});

test("clashing ids are listed once", async () => {
    const logged = [];
    const cassette = validateCassette({
        cassette: { name: "odd", version: 1 },
        channels: [
            { id: 0, path: "A/" },
            { id: 1, path: "A/B" },
            { id: 2, path: "C/D" },
            { id: 3, path: "C/" },
        ],
        samples: [],
    });
    const { kids, items } = build_tree({ cassette, log: (...a) => logged.push(a) });
    /* A channel path ending in "/" would share its id with a folder,
     * so the folder wins and the channel is skipped. */
    assert.equal(items.get("A/").kind, "folder");
    assert.equal(items.get("A/B").parent, "A/");
    assert.equal(items.get("C/").kind, "folder");
    assert.equal(items.get("C/D").parent, "C/");
    assert.equal(logged.length, 2);
    assert.ok([...kids.keys()].every(k => k === null || items.get(k).kind == "folder"));
});

test("plain_type drops the byte order", () => {
    assert.equal(plain_type("DoubleLE"), "Double");
    assert.equal(plain_type("Int16BE"), "Int16");
    assert.equal(plain_type("Boolean"), "Boolean");
    assert.equal(plain_type("Float32"), null);
    assert.equal(plain_type(undefined), null);
});

test("a large cassette lists in batches", async () => {
    const channels = Array.from({ length: 1300 }, (_, i) =>
        ({ id: i, path: `Line/Cell${i % 3}/Tag${i}` }));
    const player = loaded_player({
        cassette: { name: "big", version: 1 }, channels, samples: [],
    });
    const { items, out } = await run(player);
    assert.equal(items.length, 1 + 12 + 1 + 3 + 1300);
    assert.ok(out.calls.every(n => n <= 500));
    assert_tree(items);
});

/* Inside the driver library */

test("the driver answers hello with supported", async () => {
    const driver = await ready_driver(AsyncDriver, SimHandler);
    await driver.handleMessage("fpEdge1/Conn/scout",
        Buffer.from(JSON.stringify({ op: "hello", version: 1 })));
    assert.equal(found(driver, "hello")[0].supported, true);
    await driver.handler.close();
});

test("an empty player scans to an empty, exhaustive end", async () => {
    const driver = await ready_driver(AsyncDriver, SimHandler);
    const msgs = await scan(driver, "empty");
    assert.deepEqual(msgs.map(m => m.type), ["accept", "end"]);
    assert.equal(msgs[1].exhaustive, true);
    await driver.handler.close();
});

test("a loaded cassette scans validly on the wire", async () => {
    const driver = await ready_driver(AsyncDriver, SimHandler);
    driver.handler.player.load(validateCassette(structuredClone(DOC)));

    const msgs = await scan(driver, "full", { limits: { samples: true } });
    const items = items_of(msgs);
    assert_tree(items);
    assert.equal(items.length, 13 + 4 + 6);
    assert.equal(msgs.at(-1).truncated, false);

    const branch = items_of(await scan(driver, "branch",
        { root: "Axes/", folder_id: "Axes/" }));
    assert.deepEqual(branch.map(i => i.id).sort(), [
        "Axes/", "Axes/X/", "Axes/X/Load", "Axes/X/Position",
        "Axes/Y/", "Axes/Y/Position",
    ]);

    const bad = await scan(driver, "bad", { options: { x: 1 } });
    assert.equal(bad.at(-1).error.code, "OPTIONS");
    await driver.handler.close();
});

/* Live values */

test("a read gives what the cassette is playing for each channel", () => {
    const player = loaded_player();
    player.play({ start_time: 1_000_000, rate: 1 });
    player.pause();
    player.seek(1500);

    const values = read_cassette({ cassette: player.cassette, player }, [
        "Axes/X/Position", "Status", "Spindle/Speed", "Nope",
        "player:position", "player:status", "player:load",
    ]);
    /* Raw values: the library turns them into text. */
    const by = new Map(values.map(v => [v.address, v]));

    assert.deepEqual(by.get("Axes/X/Position"),
        { address: "Axes/X/Position", value: 2.5, type: "Double", ts: 1_001_000, error: null });
    assert.deepEqual(by.get("Status"),
        { address: "Status", value: "Running", type: "String", ts: 1_001_000, error: null });
    /* Nothing played yet on this channel. */
    assert.deepEqual(by.get("Spindle/Speed"),
        { address: "Spindle/Speed", value: null, type: "Float", ts: null, error: null });
    assert.equal(by.get("Nope").error, "Not a channel of the loaded cassette");
    assert.equal(by.get("player:position").value, 1500);
    assert.equal(by.get("player:status").value, "PAUSED");
    assert.equal(by.get("player:load").error, "This player address can only be written");
    player.stop();
});

test("a read with no cassette loaded says so", () => {
    const player = new Player({ emit: () => {}, onState: () => {} });
    const [ch, st] = read_cassette({ cassette: null, player }, ["Status", "player:status"]);
    assert.equal(ch.error, "No cassette is loaded");
    assert.equal(st.value, "EMPTY");
});

test("the driver reads through the library, as text", async () => {
    const driver = await ready_driver(AsyncDriver, SimHandler);
    await driver.handleMessage("fpEdge1/Conn/scout",
        Buffer.from(JSON.stringify({ op: "hello", version: 1 })));
    assert.equal(found(driver, "hello")[0].reads, true);

    driver.handler.player.load(validateCassette(structuredClone(DOC)));
    driver.handler.player.seek(1000);
    await driver.scouter.handle(Buffer.from(JSON.stringify({
        op: "read", id: "r1", version: 1, addresses: ["Axes/X/Position", "player:status"],
    })));
    const [msg] = found(driver, "r1");
    assert.equal(msg.type, "values");
    for (const v of msg.values) assert.ok(check_value(v), JSON.stringify(v));
    assert.deepEqual(msg.values.map(v => v.value), ["2.5", "LOADED"]);
    await driver.handler.close();
});
