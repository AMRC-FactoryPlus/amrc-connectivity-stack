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
import { config as rxConfig } from "rxjs";

import { ConfigSync } from "../lib/sync.js";
import { Slicer } from "../lib/slicer.js";
import type { EtagChange } from "../lib/sync.js";
import { ObjectTree } from "../lib/object-tree.js";
import { I3xStore } from "../lib/store.js";
import { ValueCache } from "../lib/value-cache.js";
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
    /** App:object keys whose GET waits for the given promise. */
    held = new Map<string, Promise<void>>();
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
                await this.held.get(this.key(app, obj));
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

function stack(cdb: FakeConfigDB, store = new I3xStore(), opts: Partial<{ concurrency: number; retryDelay: number; readyGrace: number }> = {}) {
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
        readyGrace: opts.readyGrace,
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

    it("is not ready, nor recorded as synced, until failed fetches succeed", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, store, sync } = start(stack(cdb, undefined, { retryDelay: 60 }));
            cdb.failing.add(cdb.key(DI, uuids[2]));
            cdb.failing.add(cdb.key(INFO, uuids[5]));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);
            // Every other device is in, but the tree is incomplete.
            expect(tree.getObject(uuids[3])).toBeDefined();
            expect(tree.getObject(uuids[2])).toBeUndefined();
            expect(sync.stats.errors).toBeGreaterThan(0);
            expect(tree.isReady()).toBe(false);
            expect(store.getMeta("synced")).toBeUndefined();

            // Still failing after a retry: still not ready.
            await sleep(120);
            await settle(sync);
            expect(tree.isReady()).toBe(false);

            cdb.failing.clear();
            await sleep(120);
            await settle(sync);
            expect(tree.isReady()).toBe(true);
            expect(store.getMeta("synced")).toBe("1");
            expect(state(tree)).toEqual(state(reference(cdb, uuids)));
        } finally {
            err.mockRestore();
        }
    });

    it("is ready after the grace period despite a failing config, but not recorded as synced", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, store, sync } = start(stack(cdb, undefined, { retryDelay: 60, readyGrace: 300 }));
            cdb.failing.add(cdb.key(DI, uuids[2]));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);
            expect(tree.isReady()).toBe(false);

            await sleep(400);
            await settle(sync);
            expect(tree.isReady()).toBe(true);
            expect(tree.getObject(uuids[3])).toBeDefined();
            expect(store.getMeta("synced")).toBeUndefined();
            const loud = err.mock.calls.filter(c => String(c[0]).includes("serving the tree without them"));
            expect(loud.length).toBe(1);
            expect(loud[0].join(" ")).toContain(`d:${uuids[2]}`);

            // Still retrying: once it succeeds, the sync is recorded.
            cdb.failing.clear();
            await sleep(120);
            await settle(sync);
            expect(tree.getObject(uuids[2])).toBeDefined();
            expect(store.getMeta("synced")).toBe("1");
        } finally {
            err.mockRestore();
        }
    });

    it("times the grace from when fetches began failing without a break", async () => {
        /* A failure early in a long cold sync that recovers must not use
         * up the grace of a later failure. The held fetch keeps the
         * queue busy throughout, as a long sync does. */
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        let releaseC = () => {};
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const [A, B, C] = [uuids[1], uuids[4], uuids[6]];
            cdb.held.set(cdb.key(DI, C), new Promise<void>(r => releaseC = r));
            cdb.failing.add(cdb.key(DI, A));
            const { tree, sync } = start(stack(cdb, undefined, { retryDelay: 30, readyGrace: 300 }));
            cdb.setMembers(uuids);
            cdb.snapshots();

            // A fails, then recovers on retry, while C is still in flight.
            for (let i = 0; i < 200 && sync.stats.errors === 0; i++) await sleep(5);
            expect(sync.stats.errors).toBeGreaterThan(0);
            cdb.failing.delete(cdb.key(DI, A));
            for (let i = 0; i < 200 && !tree.getObject(A); i++) await sleep(5);
            expect(tree.getObject(A)).toBeDefined();

            // Longer than the grace later, B starts failing.
            await sleep(350);
            cdb.failing.add(cdb.key(DI, B));
            cdb.put(DI, B, cdb.configs.get(cdb.key(DI, B))!.config);
            const errors = sync.stats.errors;
            for (let i = 0; i < 200 && sync.stats.errors === errors; i++) await sleep(5);

            // The queue goes idle with B waiting to retry: B has failed for
            // well under the grace, so the tree must not be ready yet.
            releaseC();
            await sleep(60);
            expect(tree.isReady()).toBe(false);

            await sleep(400);
            expect(tree.isReady()).toBe(true);
        } finally {
            releaseC();
            err.mockRestore();
        }
    });

    it("is not ready while a schema fetch is failing", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, sync } = start(stack(cdb, undefined, { retryDelay: 60 }));
            cdb.failing.add(cdb.key(SCHEMA, TOP));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);
            expect(tree.isReady()).toBe(false);
            cdb.failing.clear();
            await sleep(120);
            await settle(sync);
            expect(tree.isReady()).toBe(true);
            expect(tree.getObjectType(TOP)!.displayName).toBe("Traffic Signal v1");
        } finally {
            err.mockRestore();
        }
    });

    it("stops waiting for a failing device that leaves the Device class", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, sync } = start(stack(cdb, undefined, { retryDelay: 10_000 }));
            cdb.failing.add(cdb.key(DI, uuids[2]));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);
            expect(tree.isReady()).toBe(false);
            cdb.setMembers(uuids.filter(u => u !== uuids[2]));
            await settle(sync);
            expect(tree.isReady()).toBe(true);
        } finally {
            err.mockRestore();
        }
    });

    it("fetches again what a failed commit rolled back", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, store, sync } = start(stack(cdb, undefined, { retryDelay: 50 }));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);
            store.commit();

            /* The next group commit fails, as on a full disk. */
            const exec = store.db.exec.bind(store.db);
            let fail = true;
            const spy = jest.spyOn(store.db, "exec").mockImplementation((sql: string) => {
                if (fail && sql === "commit") { fail = false; throw new Error("database or disk is full"); }
                return exec(sql);
            });
            cdb.put(INFO, uuids[4], { name: "Lost then found" });
            await settle(sync);
            expect(tree.getObject(uuids[4])!.displayName).toBe("Lost then found");
            store.commit();
            // The rename was rolled back with the batch...
            expect(fail).toBe(false);
            // ...and is fetched and applied again.
            await sleep(150);
            await settle(sync);
            store.commit();
            spy.mockRestore();
            expect(tree.getObject(uuids[4])!.displayName).toBe("Lost then found");
            expect((store.prepare("select etag_info from sync_device where uuid = ?").get(uuids[4]) as any).etag_info)
                .toBe(cdb.configs.get(cdb.key(INFO, uuids[4]))!.etag);
        } finally {
            err.mockRestore();
        }
    });

    it("logs and counts an exception while handling an update, without crashing", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const unhandled: unknown[] = [];
        const prev = rxConfig.onUnhandledError;
        rxConfig.onUnhandledError = e => unhandled.push(e);
        try {
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const { tree, sync } = start(stack(cdb));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(sync);

            const remove = jest.spyOn(tree, "removeDevice")
                .mockImplementationOnce(() => { throw new Error("database or disk is full"); });
            const before = sync.stats.errors;
            cdb.setMembers(uuids.slice(1));
            const check = jest.spyOn(tree, "isSchemaReferenced")
                .mockImplementationOnce(() => { throw new Error("disk I/O error"); });
            cdb.put(INFO, TOP, { name: "x" });
            await settle(sync);
            remove.mockRestore();
            check.mockRestore();
            await settle(sync);

            expect(unhandled).toEqual([]);
            expect(sync.stats.errors).toBeGreaterThanOrEqual(before + 2);
            // The failed removal is done by the reconcile that follows.
            expect(tree.getObject(uuids[0])).toBeUndefined();
        } finally {
            rxConfig.onUnhandledError = prev;
            err.mockRestore();
        }
    });

    it("drops orphan UNS nodes, empty ISA-95 levels and their values when it reconciles", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-sync-"));
        try {
            const path = join(dir, "i3x.db");
            const cdb = new FakeConfigDB();
            const uuids = seed(cdb);
            const first = start(stack(cdb, new I3xStore({ path })));
            cdb.setMembers(uuids);
            cdb.snapshots();
            await settle(first.sync);

            /* Orphans as an earlier run could leave them: UNS rows under
             * a device that is not in the tree, an empty ISA-95 level,
             * and values for those rows. */
            const st = first.store;
            const put = st.prepare(`insert into object (element_id, parent_id, type_element_id, display_name, is_composition, source)
                values (?, ?, ?, ?, ?, ?)`);
            put.run("orphan-a", "gone-device", "t", "A", 1, "uns");
            put.run("orphan-b", "orphan-a", "t", "B", 0, "uns");
            put.run("empty-level", "/", "isa95-level", "Empty", 1, "config");
            st.prepare(`insert into last_value (element_id, anchor, device_uuid, value_json, timestamp, quality, source)
                values ('orphan-b', 'orphan-a', 'gone-device', '1', 't', 'Good', 'uns')`).run();
            first.sync.stop();
            first.store.close();

            const second = start(stack(cdb, new I3xStore({ path })));
            const removed: string[][] = [];
            (second.sync as any).opts.valueCache.removeElements = (ids: string[]) => removed.push(ids);
            cdb.snapshots();
            await settle(second.sync);
            for (const id of ["orphan-a", "orphan-b", "empty-level"])
                expect(second.tree.getObject(id)).toBeUndefined();
            expect(removed.flat().sort()).toEqual(["empty-level", "orphan-a", "orphan-b"]);
            expect(state(second.tree)).toEqual(state(reference(cdb, uuids)));
            second.store.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("drops the InfluxDB values of a device that loses its ISA-95 hierarchy, not its UNS values", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb);
        const s = start(stack(cdb));
        const vc = new ValueCache({ objectTree: s.tree, store: s.store, staleThreshold: 60_000 });
        (s.sync as any).opts.valueCache = vc;
        cdb.setMembers(uuids);
        cdb.snapshots();
        await settle(s.sync);

        /* A value and a marker kept from InfluxDB, and a UNS value, for
         * two devices. */
        const keep = (uuid: string) => {
            const [a, b, c] = s.tree.getDescendantLeafIds(uuid, 0);
            vc.recordInfluxValues([{ elementId: a, device: uuid, anchor: uuid,
                value: 1, quality: "Good", timestamp: "2026-10-05T11:00:00Z" }]);
            vc.recordInfluxEmpty([{ elementId: b, device: uuid, anchor: uuid }]);
            s.store.prepare(`insert into last_value (element_id, anchor, device_uuid, value_json, timestamp, quality, source)
                values (?, ?, ?, '2', '2026-10-05T12:00:00Z', 'Good', 'uns')`).run(c, uuid, uuid);
        };
        keep(uuids[5]);
        keep(uuids[6]);
        const sources = (uuid: string) => (s.store.prepare(
            "select source from last_value where device_uuid = ? order by source").all(uuid) as any[]).map(r => r.source);

        /* uuids[5] loses its hierarchy; uuids[6] changes but keeps it. */
        const d5 = device(5);
        const om5 = JSON.parse(JSON.stringify(d5.originMap));
        delete om5.Device_Information.ISA95_Hierarchy;
        cdb.put(DI, uuids[5], { schema: TOP, sparkplugName: d5.name, originMap: om5 });
        const d6 = device(6);
        cdb.put(DI, uuids[6], { schema: TOP, sparkplugName: d6.name,
            originMap: { ...d6.originMap, Added_Metric: { Sparkplug_Type: "Double" } } });
        await settle(s.sync);

        expect(sources(uuids[5])).toEqual(["uns"]);
        expect(sources(uuids[6])).toEqual(["empty", "influx", "uns"]);
    });

    it("keeps a device that joins while a reconcile is running", async () => {
        const cdb = new FakeConfigDB();
        const uuids = seed(cdb, N + 1);
        const members = uuids.slice(0, N);
        const joiner = uuids[N];
        const { tree, sync } = start(stack(cdb));
        cdb.setMembers(members);
        cdb.snapshots();
        await settle(sync);
        expect(tree.getObject(joiner)).toBeUndefined();

        /* Make the next reconcile pause for a while at every step, and
         * add a device during its first pause. */
        let first = true;
        const maybe = jest.spyOn(Slicer.prototype, "maybe").mockImplementation(async () => {
            if (first) { first = false; cdb.setMembers([...members, joiner]); }
            await sleep(30);
        });
        try {
            cdb.snapshots();
            await sleep(600);
            await settle(sync);
        } finally {
            maybe.mockRestore();
        }
        await settle(sync);
        expect(tree.getObject(joiner)).toBeDefined();
        expect(state(tree)).toEqual(state(reference(cdb, [...members, joiner])));
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
