/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ConfigSync: the ConfigDB sync engine. A fake ConfigDB stands in for
 * the Device class watch, the three ETag SEARCHes and the HTTP GETs,
 * and counts every fetch.
 */

import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as rx from "rxjs";

import { ConfigSync } from "../lib/sync.js";
import type { EtagChange } from "../lib/sync.js";
import { ObjectTree } from "../lib/object-tree.js";
import { I3xStore } from "../lib/store.js";
import { I3xRag } from "../lib/rag/i3x-rag.js";
import {
    DEVICE_INFORMATION_APP_UUID as DI,
    INFO_APP_UUID as INFO,
    SCHEMA_APP_UUID as SCHEMA,
} from "../lib/constants.js";
import { createMockHistory } from "./helpers/mock-rag.js";
// @ts-ignore - plain ESM benchmark fixture
import { device, deviceUuid } from "../bench/dataset.mjs";

/** A ConfigDB in memory, with the feeds ConfigSync subscribes to. */
class FakeConfigDB {
    configs = new Map<string, { config: any; etag: string }>();
    members = new rx.BehaviorSubject<Set<string> | null>(null);
    feeds = new Map<string, rx.Subject<EtagChange>>();
    fetches: Array<[string, string]> = [];
    inFlight = 0;
    maxInFlight = 0;
    /** Set to make GETs wait for `release()`. */
    gate: Promise<void> | null = null;
    private open: (() => void) | null = null;
    /** App:object keys whose GET fails while listed. */
    failing = new Set<string>();
    private n = 0;

    key(app: string, obj: string) { return `${app}:${obj}`; }

    /** The ETags of one app, as the SEARCH holds them. */
    etagMap(app: string): Map<string, string> {
        const m = new Map<string, string>();
        for (const [k, v] of this.configs) {
            const [a, o] = k.split(":");
            if (a === app) m.set(o, v.etag);
        }
        return m;
    }

    feed(app: string): rx.Subject<EtagChange> {
        let f = this.feeds.get(app);
        if (!f) this.feeds.set(app, f = new rx.Subject());
        return f;
    }

    /** Write a config; the ETag SEARCH sends a child update. */
    put(app: string, obj: string, config: any, quiet = false) {
        this.configs.set(this.key(app, obj), { config, etag: `etag-${++this.n}` });
        if (!quiet) this.feed(app).next({ map: this.etagMap(app), child: obj });
    }

    delete(app: string, obj: string) {
        this.configs.delete(this.key(app, obj));
        this.feed(app).next({ map: this.etagMap(app), child: obj });
    }

    /** Send every SEARCH snapshot, as after a (re)connect. */
    snapshots() {
        for (const app of [DI, INFO, SCHEMA])
            this.feed(app).next({ map: this.etagMap(app), child: null });
    }

    setMembers(uuids: string[]) { this.members.next(new Set(uuids)); }

    hold() { this.gate = new Promise(r => this.open = r); }
    release() { this.open?.(); this.gate = null; }

    fetcher = {
        get_config_with_etag: async (app: string, obj: string): Promise<[any?, string?]> => {
            this.fetches.push([app, obj]);
            this.inFlight++;
            this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
            try {
                /* The server answers with the state when the request
                 * arrives; the response may reach us later. */
                const e = this.configs.get(this.key(app, obj));
                const fail = this.failing.has(this.key(app, obj));
                await (this.gate ?? new Promise(r => setImmediate(r)));
                if (fail) throw new Error("HTTP 503");
                /* Return a copy, as a parsed HTTP body is. */
                return e ? [JSON.parse(JSON.stringify(e.config)), e.etag] : [];
            } finally {
                this.inFlight--;
            }
        },
    };

    count(app: string, obj?: string) {
        return this.fetches.filter(([a, o]) => a === app && (obj === undefined || o === obj)).length;
    }
}

const TOP = "a1b2c3d4-0000-4000-8000-0000000000aa";
const N = 12;

function seed(cdb: FakeConfigDB, n = N) {
    for (let i = 0; i < n; i++) {
        const d = device(i);
        cdb.put(DI, d.uuid, { schema: TOP, sparkplugName: d.name, originMap: d.originMap }, true);
        cdb.put(INFO, d.uuid, d.info, true);
    }
    /* Only some of the referenced schemas exist, as on a real cluster. */
    cdb.put(SCHEMA, TOP, { title: "Traffic Signal" }, true);
    cdb.put(INFO, TOP, { name: "Traffic Signal v1" }, true);
    return Array.from({ length: n }, (_, i) => deviceUuid(i) as string);
}

function stack(cdb: FakeConfigDB, store = new I3xStore(), opts: Partial<{ concurrency: number; retryDelay: number }> = {}) {
    const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
    const removed: string[] = [];
    const sync = new ConfigSync({
        objectTree: tree,
        store,
        members: cdb.members.pipe(rx.filter((m): m is Set<string> => m !== null)),
        etags: app => cdb.feed(app),
        fetcher: cdb.fetcher,
        valueCache: { removeDevice: (uuid: string) => removed.push(uuid) },
        concurrency: opts.concurrency ?? 4,
        retryDelay: opts.retryDelay ?? 50,
    });
    return { tree, store, sync, removed };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Wait for the reconcile timer and every fetch to finish. */
async function settle(sync: ConfigSync) {
    await sleep(40);
    for (let i = 0; i < 500 && sync.pending > 0; i++) await sleep(5);
    await sleep(5);
}

/** The tree a full build from the fake's current configs gives. */
function reference(cdb: FakeConfigDB, members: string[]) {
    const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns" });
    const get = (app: string, obj: string) => cdb.configs.get(cdb.key(app, obj))?.config ?? null;
    const devices = new Map(members.map(u => [u, { devInfo: get(DI, u), info: get(INFO, u) }]));
    tree.refreshFromSnapshot({ devices, schemas: new Map() });
    const schemas = new Map(tree.getReferencedSchemaUuids().map(s => [s, { schema: get(SCHEMA, s), info: get(INFO, s) }]));
    tree.refreshFromSnapshot({ devices, schemas });
    return tree;
}

/** Everything the API serves from the tree, order-free. */
function state(tree: ObjectTree) {
    return {
        objects: tree.getObjects().map(o => JSON.stringify(o)).sort(),
        types: tree.getObjectTypes().map(t => JSON.stringify(t)).sort(),
        meta: tree.getObjects().map(o => [o.elementId, tree.getMetricMeta(o.elementId)])
            .filter(([, m]) => m).map(x => JSON.stringify(x)).sort(),
    };
}

let stacks: ConfigSync[] = [];
afterEach(() => { stacks.forEach(s => s.stop()); stacks = []; });
function start(s: ReturnType<typeof stack>) { stacks.push(s.sync.run()); return s; }

describe("ConfigSync", () => {
    it("cold sync fetches each config once and builds the same tree as a full build", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, store, sync } = start(stack(cdb));

        cdb.setMembers(uuids);
        cdb.snapshots();
        expect(tree.isReady()).toBe(false);
        await settle(sync);

        expect(tree.isReady()).toBe(true);
        expect(store.getMeta("synced")).toBe("1");
        for (const u of uuids) {
            expect(cdb.count(DI, u)).toBe(1);
            expect(cdb.count(INFO, u)).toBe(1);
        }
        // Every referenced schema is fetched once, Schema and Info.
        const referenced = tree.getReferencedSchemaUuids();
        expect(cdb.count(SCHEMA)).toBe(referenced.length);
        expect(state(tree)).toEqual(state(reference(cdb, uuids)));
        expect(tree.getObjectType(TOP)!.displayName).toBe("Traffic Signal v1");
    });

    it("waits for the class watch and all three SEARCH snapshots", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.feed(DI).next({ map: cdb.etagMap(DI), child: null });
        cdb.feed(INFO).next({ map: cdb.etagMap(INFO), child: null });
        await settle(sync);
        expect(cdb.fetches).toHaveLength(0);
        expect(tree.isReady()).toBe(false);

        cdb.feed(SCHEMA).next({ map: cdb.etagMap(SCHEMA), child: null });
        await settle(sync);
        expect(tree.isReady()).toBe(true);
    });

    it("warm restart with matching ETags serves at once and fetches nothing", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-sync-"));
        try {
            const path = join(dir, "i3x.db");
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const first = start(stack(cdb, new I3xStore({ path })));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(first.sync);
            const before = state(first.tree);
            first.sync.stop();
            first.store.close();

            cdb.fetches = [];
            const second = start(stack(cdb, new I3xStore({ path })));
            // Ready before any feed has answered.
            expect(second.tree.isReady()).toBe(true);
            expect(state(second.tree)).toEqual(before);

            cdb.snapshots();
            await settle(second.sync);
            expect(cdb.fetches).toHaveLength(0);
            expect(state(second.tree)).toEqual(before);
            second.store.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("refetches only what changed while it was down", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-sync-"));
        try {
            const path = join(dir, "i3x.db");
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const first = start(stack(cdb, new I3xStore({ path })));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(first.sync);
            first.sync.stop();
            first.store.close();

            // While i3X is down: one rename, one new device, one removed.
            cdb.put(INFO, uuids[2], { name: "Renamed" }, true);
            const extra = device(N);
            cdb.put(DI, extra.uuid, { schema: TOP, sparkplugName: extra.name, originMap: extra.originMap }, true);
            const members = [...uuids.slice(1), extra.uuid];

            cdb.fetches = [];
            const second = start(stack(cdb, new I3xStore({ path })));
            cdb.setMembers(members);
            cdb.snapshots();
            await settle(second.sync);

            expect(cdb.fetches.map(f => f.join(" ")).sort()).toEqual([
                `${DI} ${extra.uuid}`, `${INFO} ${extra.uuid}`, `${INFO} ${uuids[2]}`,
            ].sort());
            expect(second.removed).toEqual([uuids[0]]);
            expect(state(second.tree)).toEqual(state(reference(cdb, members)));
            second.store.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("a DeviceInformation change refetches that one config and rebuilds the device", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);

        // A UNS-discovered node under the device survives the rebuild.
        const unsLeaf = tree.addCompositionFromUns([uuids[5]], [TOP], ["Extra", "Reading"])!;

        cdb.fetches = [];
        const d = device(5);
        const om = { ...d.originMap, Added_Metric: { Sparkplug_Type: "Double" } };
        cdb.put(DI, uuids[5], { schema: TOP, sparkplugName: d.name, originMap: om });
        await settle(sync);

        expect(cdb.fetches).toEqual([[DI, uuids[5]]]);
        expect(tree.getChildElementIds(uuids[5]).map(id => tree.getObject(id)!.displayName))
            .toContain("Added_Metric");
        expect(tree.getNodeSource(unsLeaf)).toBe("uns");
        const nonUns = (t: ObjectTree) => ({
            ...state(t),
            objects: state(t).objects.filter(o => !o.includes("Extra") && !o.includes("Reading")),
        });
        expect(nonUns(tree)).toEqual(state(reference(cdb, uuids)));
    });

    it("an Info change renames the device without fetching DeviceInformation", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);
        const children = tree.getChildElementIds(uuids[3]);

        cdb.fetches = [];
        cdb.put(INFO, uuids[3], { name: "New name" });
        await settle(sync);
        expect(cdb.fetches).toEqual([[INFO, uuids[3]]]);
        expect(tree.getObject(uuids[3])!.displayName).toBe("New name");
        expect(tree.getChildElementIds(uuids[3])).toEqual(children);

        // Deleting the Info entry falls back to the Sparkplug name.
        cdb.delete(INFO, uuids[3]);
        await settle(sync);
        expect(tree.getObject(uuids[3])!.displayName).toBe(device(3).name);

        // A later DeviceInformation change keeps the stored Info name.
        cdb.put(INFO, uuids[3], { name: "Named again" });
        await settle(sync);
        cdb.put(DI, uuids[3], { schema: TOP, sparkplugName: "sp", originMap: device(3).originMap });
        await settle(sync);
        expect(tree.getObject(uuids[3])!.displayName).toBe("Named again");
        expect(state(tree)).toEqual(state(reference(cdb, uuids)));
    });

    it("a change back to an earlier config is applied", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);
        cdb.put(INFO, uuids[1], { name: "B" });
        await settle(sync);
        cdb.put(INFO, uuids[1], device(1).info);
        await settle(sync);
        expect(tree.getObject(uuids[1])!.displayName).toBe(device(1).info.name);
    });

    it("removes a device that leaves the Device class, and adds one that joins", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb, N + 1);
        const members = uuids.slice(0, N);
        const { tree, store, sync, removed } = start(stack(cdb));
        cdb.setMembers(members);
        cdb.snapshots();
        await settle(sync);

        cdb.fetches = [];
        cdb.setMembers([...members.slice(1), uuids[N]]);
        await settle(sync);

        expect(tree.getObject(uuids[0])).toBeUndefined();
        expect(removed).toEqual([uuids[0]]);
        expect(store.prepare("select 1 from sync_device where uuid = ?").get(uuids[0])).toBeUndefined();
        expect(cdb.fetches.map(f => f[1])).toEqual([uuids[N], uuids[N]]);
        expect(state(tree)).toEqual(state(reference(cdb, [...members.slice(1), uuids[N]])));

        // The last device goes; so do the ISA-95 levels and the types.
        cdb.setMembers([]);
        await settle(sync);
        expect(tree.objectCount()).toBe(0);
        expect(tree.getObjectTypes()).toEqual([]);
    });

    it("a reconnect with no changes fetches nothing; with one change, one config", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);
        const before = state(tree);

        cdb.fetches = [];
        for (let i = 0; i < 5; i++) cdb.snapshots();
        cdb.setMembers([...uuids]);
        await settle(sync);
        expect(cdb.fetches).toHaveLength(0);
        expect(state(tree)).toEqual(before);

        // A change missed while disconnected arrives in the snapshot.
        cdb.put(INFO, uuids[7], { name: "Missed" }, true);
        cdb.snapshots();
        await settle(sync);
        expect(cdb.fetches).toEqual([[INFO, uuids[7]]]);
        expect(tree.getObject(uuids[7])!.displayName).toBe("Missed");
    });

    it("tracks schema changes, and drops types nothing references", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);

        cdb.fetches = [];
        cdb.put(SCHEMA, TOP, { title: "v2", properties: {} });
        await settle(sync);
        expect(cdb.fetches).toEqual([[SCHEMA, TOP]]);
        expect(tree.getObjectType(TOP)!.schema).toEqual({ title: "v2", properties: {} });
        expect(tree.getObjectType(TOP)!.displayName).toBe("Traffic Signal v1");

        cdb.fetches = [];
        cdb.put(INFO, TOP, { name: "Signal type" });
        await settle(sync);
        expect(cdb.fetches).toEqual([[INFO, TOP]]);
        expect(tree.getObjectType(TOP)!.displayName).toBe("Signal type");
        expect(tree.getObjectType(TOP)!.schema).toEqual({ title: "v2", properties: {} });

        // A schema nothing references is not fetched.
        cdb.fetches = [];
        cdb.put(SCHEMA, "unreferenced", { title: "x" });
        await settle(sync);
        expect(cdb.fetches).toHaveLength(0);
        expect(tree.getObjectType("unreferenced")).toBeUndefined();

        // A schema only one device referenced goes with that reference.
        const d = device(0);
        const om = { ...d.originMap, Special: { Schema_UUID: "only-dev-0", Sparkplug_Type: "Double" } };
        cdb.put(DI, uuids[0], { schema: TOP, sparkplugName: d.name, originMap: om });
        await settle(sync);
        expect(tree.getObjectType("only-dev-0")).toBeDefined();
        cdb.put(DI, uuids[0], { schema: TOP, sparkplugName: d.name, originMap: d.originMap });
        await settle(sync);
        expect(tree.getObjectType("only-dev-0")).toBeUndefined();
        expect(state(tree)).toEqual(state(reference(cdb, uuids)));
    });

    it("keeps at most `concurrency` fetches in flight", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb, 40);
        const { sync } = start(stack(cdb, undefined, { concurrency: 3 }));
        cdb.hold();
        cdb.setMembers(uuids);
        cdb.snapshots();
        await sleep(50);
        // Each device fetches DeviceInformation and Info together.
        expect(cdb.inFlight).toBe(6);
        cdb.release();
        await settle(sync);
        expect(cdb.maxInFlight).toBe(6);
        expect(cdb.count(DI)).toBe(40);
    });

    it("refetches a device that changes again while its fetch is in flight", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);

        cdb.hold();
        cdb.put(INFO, uuids[4], { name: "First" });
        await sleep(30);
        cdb.put(INFO, uuids[4], { name: "Second" });
        cdb.release();
        await settle(sync);
        expect(tree.getObject(uuids[4])!.displayName).toBe("Second");
        expect(cdb.count(INFO, uuids[4])).toBe(3);
    });

    it("ignores a fetch that finishes after its device left the Device class", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);

        cdb.hold();
        cdb.put(INFO, uuids[6], { name: "Late" });
        await sleep(30);
        cdb.setMembers(uuids.filter(u => u !== uuids[6]));
        cdb.release();
        await settle(sync);
        expect(tree.getObject(uuids[6])).toBeUndefined();
    });

    it("retries a failed fetch, and still becomes ready", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, sync } = start(stack(cdb, undefined, { retryDelay: 30 }));
            cdb.failing.add(cdb.key(DI, uuids[2]));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);
            expect(tree.isReady()).toBe(true);
            expect(tree.getObject(uuids[2])).toBeUndefined();
            expect(sync.stats.errors).toBeGreaterThan(0);

            cdb.failing.clear();
            await sleep(60);
            await settle(sync);
            expect(tree.getObject(uuids[2])).toBeDefined();
            expect(state(tree)).toEqual(state(reference(cdb, uuids)));
        } finally {
            err.mockRestore();
        }
    });

    it("marks the RAG index dirty on every tree change, so MCP search sees it", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const { tree, sync } = start(stack(cdb));
        const rag = new I3xRag(tree, { getValue: () => null }, createMockHistory());
        tree.onChange(() => rag.markDirty());
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(sync);
        const renamed = () => rag.search("Renamed Signal", 100)
            .filter(r => r.displayName === "Renamed Signal").map(r => r.elementId);
        expect(renamed()).toEqual([]);

        cdb.put(INFO, uuids[1], { name: "Renamed Signal" });
        await settle(sync);
        expect(renamed()).toEqual([uuids[1]]);

        tree.addCompositionFromUns([uuids[1]], [TOP], ["Brakes", "Brake_Pressure"]);
        expect(rag.search("Brake_Pressure").map(r => r.displayName)).toContain("Brake_Pressure");
    });
});
