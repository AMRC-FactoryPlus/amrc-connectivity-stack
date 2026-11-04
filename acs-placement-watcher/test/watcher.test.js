/*
 * ACS ISA-95 placement watcher
 * Tests for the watcher
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { PlacementWatcher, changed_devices, vocabulary_feed } from "../lib/watcher.js";

const { App } = UUIDs;
const P = "Device_Information/ISA95_Hierarchy";

const NODE = "aaaaaaaa-0000-4000-8000-000000000001";
const D1 = "dddddddd-0000-4000-8000-000000000001";
const D2 = "dddddddd-0000-4000-8000-000000000002";
const D3 = "dddddddd-0000-4000-8000-000000000003";
const NOTAG = "dddddddd-0000-4000-8000-000000000004";

const nodes = (site = "Site1") => [
    { uuid: "acme", name: "Acme", level: "Enterprise", aliases: [], children: ["site1", "site2"] },
    { uuid: "site1", name: site, level: "Site", aliases: [], children: ["area1"] },
    { uuid: "site2", name: "Site2", level: "Site", aliases: [], children: [] },
    { uuid: "area1", name: "Area1", level: "Area", aliases: [], children: [] },
];

const entry = (name, device, extra = []) => ({
    deviceId: name,
    tags: [
        { Name: "Schema_UUID", type: "UUID", value: "s" },
        ...(device ? [{ Name: "Instance_UUID", type: "UUID", value: device }] : []),
        { Name: "Temperature", type: "Float", address: "1" },
        ...extra,
    ],
});

/* A ConfigDB holding one node's Edge Agent config. */
class FakeCDB {
    constructor () {
        this.etag = 1;
        this.config = { deviceConnections: [{ name: "c1", devices: [
            /* Same deviceId as D2's entry: the match must be by UUID. */
            entry("Machine", D1, [{ Name: `${P}/Enterprise`, value: "Hand set" }]),
            entry("Other", D2),
            entry("Machine", D3),
            entry("No Instance"),
        ] }] };
        this.puts = [];
        this.fail_next = 0;
    }

    async get_config (app, obj) {
        assert.equal(app, App.DeviceInformation);
        return { node: NODE };
    }
    async get_config_with_etag (app, obj) {
        assert.equal(app, App.EdgeAgentConfig);
        assert.equal(obj, NODE);
        return [structuredClone(this.config), `etag-${this.etag}`];
    }
    async put_config (app, obj, config, opts) {
        this.puts.push({ app, obj, etag: opts?.etag });
        if (this.fail_next) {
            this.fail_next--;
            /* Someone else wrote first. */
            this.etag++;
            throw new ServiceError(UUIDs.Service.ConfigDB, "stale", 412);
        }
        if (opts?.etag != `etag-${this.etag}`)
            throw new ServiceError(UUIDs.Service.ConfigDB, "stale", 412);
        this.config = config;
        this.etag++;
    }

    tags (i) {
        return this.config.deviceConnections[0].devices[i].tags;
    }
    isa95 (i) {
        return Object.fromEntries(this.tags(i)
            .filter(t => t.Name.startsWith(`${P}/`) && t.type == "String")
            .map(t => [t.Name.slice(P.length + 1), t.value]));
    }
}

function harness () {
    const cdb = new FakeCDB();
    const placements = new rx.BehaviorSubject(new Map());
    const vocabulary = new rx.BehaviorSubject(nodes());
    const logs = [];
    const watcher = new PlacementWatcher({
        cdb, placements, vocabulary,
        log: (...a) => logs.push(a),
        debounce: 1, retry_delay: 1,
    }).run();
    return { cdb, placements, vocabulary, watcher, logs };
}

/* Let debounce and the patches run. */
const settle = () => new Promise(r => setTimeout(r, 30));

describe("the placement watcher", () => {
    test("patches the device found by its Instance_UUID tag, and nothing else", async () => {
        const h = harness();
        h.placements.next(new Map([[D1, { node: "area1" }]]));
        await settle();

        assert.deepEqual(h.cdb.isa95(0), { Enterprise: "Acme", Site: "Site1", Area: "Area1" });
        /* The hand-set value is gone. */
        assert.equal(h.cdb.tags(0).filter(t => t.Name == `${P}/Enterprise`).length, 1);
        /* The other "Machine" entry, and every other entry, are untouched. */
        assert.deepEqual(h.cdb.tags(2), entry("Machine", D3).tags);
        assert.deepEqual(h.cdb.tags(1), entry("Other", D2).tags);
        assert.deepEqual(h.cdb.puts.map(p => p.app), [App.EdgeAgentConfig]);
        h.watcher.stop();
    });

    test("skips a device whose entry has no Instance_UUID tag", async () => {
        const h = harness();
        const before = structuredClone(h.cdb.config);
        h.placements.next(new Map([[NOTAG, { node: "acme" }]]));
        await settle();

        assert.deepEqual(h.cdb.config, before);
        assert.equal(h.cdb.puts.length, 0);
        assert.ok(h.logs.some(l => /no entry with an Instance_UUID tag/.test(l[0])));
        h.watcher.stop();
    });

    test("writes with If-Match and retries when the config changed under it", async () => {
        const h = harness();
        h.cdb.fail_next = 2;
        h.placements.next(new Map([[D2, { node: "site2" }]]));
        await settle();

        assert.deepEqual(h.cdb.puts.map(p => p.etag), ["etag-1", "etag-2", "etag-3"]);
        assert.deepEqual(h.cdb.isa95(1), { Enterprise: "Acme", Site: "Site2" });
        h.watcher.stop();
    });

    test("a vocabulary rename re-renders every device placed under the node", async () => {
        const h = harness();
        h.placements.next(new Map([
            [D1, { node: "area1" }],
            [D3, { node: "site1" }],
            [D2, { node: "site2" }],
        ]));
        await settle();
        const puts = h.cdb.puts.length;
        assert.equal(puts, 3);

        h.vocabulary.next(nodes("Site One"));
        await settle();

        assert.equal(h.cdb.puts.length, puts + 2);
        assert.equal(h.cdb.isa95(0).Site, "Site One");
        assert.equal(h.cdb.isa95(2).Site, "Site One");
        assert.equal(h.cdb.isa95(1).Site, "Site2");
        h.watcher.stop();
    });

    test("a removed placement removes the hierarchy tags", async () => {
        const h = harness();
        h.placements.next(new Map([[D2, { node: "acme" }]]));
        await settle();
        assert.deepEqual(h.cdb.isa95(1), { Enterprise: "Acme" });

        h.placements.next(new Map());
        await settle();
        assert.deepEqual(h.cdb.tags(1).filter(t => t.Name.includes("ISA95_Hierarchy")), []);
        h.watcher.stop();
    });

    test("a placement that does not render leaves the tags alone", async () => {
        const h = harness();
        h.placements.next(new Map([[D1, { node: "no-such-node" }]]));
        await settle();

        assert.equal(h.cdb.puts.length, 0);
        assert.ok(h.logs.some(l => /Can't render/.test(l[0])));
        h.watcher.stop();
    });

    test("an unchanged rendering writes nothing", async () => {
        const h = harness();
        h.placements.next(new Map([[D1, { node: "acme" }]]));
        await settle();
        const puts = h.cdb.puts.length;

        /* A new emission with the same content. */
        h.placements.next(new Map([[D1, { node: "acme" }]]));
        h.vocabulary.next(nodes());
        await settle();
        assert.equal(h.cdb.puts.length, puts);
        h.watcher.stop();
    });
});

describe("vocabulary_feed", () => {
    test("builds nodes from level members, vocabulary configs and names", async () => {
        const { LevelClass } = await import("../lib/constants.js");
        const members = {
            [LevelClass.Enterprise]: ["acme"],
            [LevelClass.Site]: ["site1", "unnamed"],
        };
        const cdb = {
            watch_members: k => rx.of(new Set(members[k] ?? [])),
            search_app: () => rx.of(new Map([["acme", { aliases: ["A"], children: ["site1"] }]])),
            watch_config: (app, u) => rx.of(u == "unnamed" ? null : { name: u.toUpperCase() }),
        };
        const got = await rx.firstValueFrom(vocabulary_feed(cdb));
        assert.deepEqual(got, [
            { uuid: "acme", level: "Enterprise", name: "ACME", aliases: ["A"], children: ["site1"] },
            { uuid: "site1", level: "Site", name: "SITE1", aliases: [], children: [] },
        ]);
    });
});

describe("changed_devices", () => {
    const ok = node => ({ tags: [node], stamp: [] });

    test("lists new, changed and removed devices", () => {
        const prev = new Map([["a", ok(1)], ["b", ok(2)], ["c", ok(3)]]);
        const next = new Map([["a", ok(1)], ["b", ok(9)], ["d", ok(4)]]);
        assert.deepEqual(changed_devices(prev, next).map(j => [j.device, j.rendered && j.rendered.tags[0]]),
            [["b", 9], ["d", 4], ["c", null]]);
    });

    test("leaves out devices that do not render", () => {
        const next = new Map([["a", { error: "broken" }]]);
        assert.deepEqual(changed_devices(new Map(), next), []);
    });
});
