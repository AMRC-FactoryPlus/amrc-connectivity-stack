/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Devices are placed in the tree from their ISA-95 placement, not from
 * the hierarchy in their origin map: the vocabulary's chain for a
 * placement, the placements' change reports, and the sync engine
 * placing and moving devices.
 */

import * as rx from "rxjs";

import { ConfigSync } from "../lib/sync.js";
import type { EtagChange } from "../lib/sync.js";
import { Isa95Vocabulary } from "../lib/isa95.js";
import type { VocabNode } from "../lib/isa95.js";
import { Isa95Placements } from "../lib/placements.js";
import { ObjectTree } from "../lib/object-tree.js";
import { I3xStore } from "../lib/store.js";
import {
    DEVICE_INFORMATION_APP_UUID as DI,
    INFO_APP_UUID as INFO,
    SCHEMA_APP_UUID as SCHEMA,
} from "../lib/constants.js";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const TOP = "a1b2c3d4-0000-4000-8000-0000000000aa";

/* Acme > Site1 > Area1, Acme > Site2; Other Co. */
function nodes(site1 = "Site1"): VocabNode[] {
    return [
        { uuid: "acme", name: "Acme", level: "Enterprise", aliases: [], children: ["site1", "site2"], root: true },
        { uuid: "site1", name: site1, level: "Site", aliases: [], children: ["area1"], root: false },
        { uuid: "site2", name: "Site2", level: "Site", aliases: [], children: [], root: false },
        { uuid: "area1", name: "Area1", level: "Area", aliases: [], children: [], root: false },
        { uuid: "other", name: "Other Co", level: "Enterprise", aliases: [], children: [], root: true },
    ];
}

function vocabulary(site1?: string) {
    const v = new Isa95Vocabulary();
    v.set(nodes(site1));
    return v;
}

describe("Isa95Vocabulary.placementSegments", () => {
    it("gives the names from the Enterprise down to the placed node", () => {
        const v = vocabulary();
        expect(v.placementSegments({ node: "area1" })).toEqual(["Acme", "Site1", "Area1"]);
        expect(v.placementSegments({ node: "other" })).toEqual(["Other Co"]);
    });

    it("is null with no placement, an unknown node or a broken chain", () => {
        const v = vocabulary();
        expect(v.placementSegments(null)).toBeNull();
        expect(v.placementSegments({})).toBeNull();
        expect(v.placementSegments({ node: "nope" })).toBeNull();
        v.set([...nodes(), { uuid: "lost", name: "Lost", level: "Area", aliases: [], children: [], root: false }]);
        expect(v.placementSegments({ node: "lost" })).toBeNull();
    });

    it("is null for a name that cannot go in a topic, or one not read yet", () => {
        expect(vocabulary("Site/1").placementSegments({ node: "area1" })).toBeNull();
        const v = new Isa95Vocabulary();
        v.set(nodes().map(n => n.uuid === "site1" ? { ...n, name: "site1", named: false } : n));
        expect(v.placementSegments({ node: "area1" })).toBeNull();
        expect(v.placementSegments({ node: "acme" })).toEqual(["Acme"]);
    });
});

describe("Isa95Placements", () => {
    it("is ready once both the placements and the vocabulary have arrived", () => {
        const v = new Isa95Vocabulary();
        const p = new Isa95Placements({ vocabulary: v });
        const seen: string[][] = [];
        p.changes.subscribe(c => seen.push(c));

        p.set(new Map([["d1", { node: "site1" }]]));
        expect(p.isReady()).toBe(false);
        expect(p.segments("d1")).toBeNull();

        v.set(nodes());
        expect(p.isReady()).toBe(true);
        expect(p.segments("d1")).toEqual(["Acme", "Site1"]);
        expect(seen).toEqual([["d1"]]);
    });

    it("reports only the devices whose position changed", () => {
        const v = vocabulary();
        const p = new Isa95Placements({ vocabulary: v });
        p.set(new Map([["d1", { node: "site1" }], ["d2", { node: "site2" }]]));
        const seen: string[][] = [];
        p.changes.subscribe(c => seen.push(c));

        p.set(new Map([["d1", { node: "area1" }], ["d2", { node: "site2" }], ["d3", { node: "other" }]]));
        p.set(new Map([["d1", { node: "area1" }], ["d3", { node: "other" }]]));
        expect(seen).toEqual([["d1", "d3"], ["d2"]]);
    });

    it("reports every device at or under a renamed node", () => {
        const v = vocabulary();
        const p = new Isa95Placements({ vocabulary: v });
        p.set(new Map([["d1", { node: "site1" }], ["d2", { node: "area1" }], ["d3", { node: "site2" }]]));
        const seen: string[][] = [];
        p.changes.subscribe(c => seen.push(c));

        v.set(nodes("Site One"));
        expect(seen).toEqual([["d1", "d2"]]);
        expect(p.segments("d2")).toEqual(["Acme", "Site One", "Area1"]);
    });
});

/** A ConfigDB in memory with the feeds ConfigSync subscribes to. */
class FakeConfigDB {
    configs = new Map<string, { config: any; etag: string }>();
    members = new rx.BehaviorSubject<Set<string>>(new Set());
    feeds = new Map<string, rx.Subject<EtagChange>>();
    fetches: Array<[string, string]> = [];
    private n = 0;

    feed(app: string) {
        let f = this.feeds.get(app);
        if (!f) this.feeds.set(app, f = new rx.Subject());
        return f;
    }
    etagMap(app: string) {
        const m = new Map<string, string>();
        for (const [k, v] of this.configs) {
            const [a, o] = k.split(":");
            if (a === app) m.set(o, v.etag);
        }
        return m;
    }
    put(app: string, obj: string, config: any) {
        this.configs.set(`${app}:${obj}`, { config, etag: `etag-${++this.n}` });
    }
    snapshots() {
        for (const app of [DI, INFO, SCHEMA])
            this.feed(app).next({ map: this.etagMap(app), child: null });
    }
    fetcher = {
        get_config_with_etag: async (app: string, obj: string): Promise<[any?, string?]> => {
            this.fetches.push([app, obj]);
            await new Promise(r => setImmediate(r));
            const e = this.configs.get(`${app}:${obj}`);
            return e ? [JSON.parse(JSON.stringify(e.config)), e.etag] : [];
        },
    };
}

const hierarchy = (...levels: string[]) => ({
    Schema_UUID: HIERARCHY,
    ...Object.fromEntries(levels.map((v, i) =>
        [["Enterprise", "Site", "Area"][i], { Sparkplug_Type: "String", Value: v }])),
});

/* d-root has a root hierarchy in its origin map, d-nested a nested
 * one, d-none none at all. */
const DEVICES: Record<string, any> = {
    "d-root": { Device_Information: { Schema_UUID: "x", ISA95_Hierarchy: hierarchy("Other Co") } },
    "d-nested": { Device_Information: { Base_Device_Information: { ISA95_Hierarchy: hierarchy("Acme", "Site1") } } },
    "d-none": { Temperature: { Sparkplug_Type: "Float" } },
};

function setup(placements: Map<string, any>) {
    const cdb = new FakeConfigDB();
    for (const [uuid, originMap] of Object.entries(DEVICES)) {
        cdb.put(DI, uuid, { schema: TOP, sparkplugName: uuid, originMap: { Schema_UUID: TOP, ...originMap } });
        cdb.put(INFO, uuid, { name: uuid });
    }
    const store = new I3xStore();
    const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
    const vocab = vocabulary();
    const source = new Isa95Placements({ vocabulary: vocab });
    source.set(placements);
    const sync = new ConfigSync({
        objectTree: tree, store,
        members: cdb.members,
        etags: app => cdb.feed(app),
        fetcher: cdb.fetcher,
        placements: source,
        retryDelay: 50,
    });
    return { cdb, tree, vocab, source, sync };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle(sync: ConfigSync) {
    await sleep(40);
    for (let i = 0; i < 500 && sync.pending > 0; i++) await sleep(5);
    await sleep(5);
}

/* The names of the levels above a device in the tree. */
function pathOf(tree: ObjectTree, uuid: string): string[] | null {
    const dev = tree.getObject(uuid);
    if (!dev) return null;
    const out: string[] = [];
    for (let id = dev.parentId; id && id !== "/"; id = tree.getObject(id)?.parentId ?? null)
        out.unshift(tree.getObject(id)!.displayName);
    return out;
}

describe("ConfigSync with placements", () => {
    let syncs: ConfigSync[] = [];
    afterEach(() => { syncs.forEach(s => s.stop()); syncs = []; });

    it("places devices by their placement and ignores origin-map hierarchies", async () => {
        const s = setup(new Map([["d-nested", { node: "site1" }], ["d-none", { node: "area1" }]]));
        syncs.push(s.sync.run());
        s.cdb.members.next(new Set(Object.keys(DEVICES)));
        s.cdb.snapshots();
        await settle(s.sync);

        expect(s.tree.isReady()).toBe(true);
        /* A nested hierarchy is not read; the placement puts it there. */
        expect(pathOf(s.tree, "d-nested")).toEqual(["Acme", "Site1"]);
        expect(pathOf(s.tree, "d-none")).toEqual(["Acme", "Site1", "Area1"]);
        /* A root hierarchy with no placement is not enough. */
        expect(s.tree.getObject("d-root")).toBeUndefined();
    });

    it("waits for the placements before building", async () => {
        const s = setup(new Map([["d-nested", { node: "site1" }]]));
        const v = new Isa95Vocabulary();
        const source = new Isa95Placements({ vocabulary: v });
        source.set(new Map([["d-nested", { node: "site1" }]]));
        const sync = new ConfigSync({
            objectTree: s.tree, store: s.tree.store,
            members: s.cdb.members, etags: app => s.cdb.feed(app),
            fetcher: s.cdb.fetcher, placements: source,
        });
        syncs.push(sync.run());
        s.cdb.members.next(new Set(Object.keys(DEVICES)));
        s.cdb.snapshots();
        await settle(sync);
        expect(s.cdb.fetches).toHaveLength(0);
        expect(s.tree.isReady()).toBe(false);

        v.set(nodes());
        await settle(sync);
        expect(s.tree.isReady()).toBe(true);
        expect(pathOf(s.tree, "d-nested")).toEqual(["Acme", "Site1"]);
    });

    it("moves a device when its placement changes, and drops it when removed", async () => {
        const s = setup(new Map([["d-nested", { node: "site1" }]]));
        syncs.push(s.sync.run());
        s.cdb.members.next(new Set(Object.keys(DEVICES)));
        s.cdb.snapshots();
        await settle(s.sync);
        const fetched = s.cdb.fetches.length;

        s.source.set(new Map([["d-nested", { node: "other" }], ["d-root", { node: "site2" }]]));
        await settle(s.sync);
        expect(pathOf(s.tree, "d-nested")).toEqual(["Other Co"]);
        expect(pathOf(s.tree, "d-root")).toEqual(["Acme", "Site2"]);
        /* The DeviceInformation of the two moved devices, and no device
         * Info. (d-root's new subtree references a schema, which is
         * fetched as for any newly built device.) */
        const devFetches = s.cdb.fetches.slice(fetched)
            .filter(([, o]) => o.startsWith("d-"));
        expect(devFetches.sort()).toEqual([[DI, "d-nested"], [DI, "d-root"]]);

        s.source.set(new Map([["d-root", { node: "site2" }]]));
        await settle(s.sync);
        expect(s.tree.getObject("d-nested")).toBeUndefined();
        expect(pathOf(s.tree, "d-root")).toEqual(["Acme", "Site2"]);
    });

    it("moves every device under a renamed vocabulary node", async () => {
        const s = setup(new Map([["d-nested", { node: "site1" }], ["d-none", { node: "area1" }], ["d-root", { node: "other" }]]));
        syncs.push(s.sync.run());
        s.cdb.members.next(new Set(Object.keys(DEVICES)));
        s.cdb.snapshots();
        await settle(s.sync);

        s.vocab.set(nodes("Site One"));
        await settle(s.sync);
        expect(pathOf(s.tree, "d-nested")).toEqual(["Acme", "Site One"]);
        expect(pathOf(s.tree, "d-none")).toEqual(["Acme", "Site One", "Area1"]);
        expect(pathOf(s.tree, "d-root")).toEqual(["Other Co"]);
    });
});
