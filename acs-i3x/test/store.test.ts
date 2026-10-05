/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * The SQLite store and the ObjectTree rows it holds.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, truncateSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jest } from "@jest/globals";
import { I3xStore, SCHEMA_VERSION } from "../lib/store.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";

function devInfo(name: string, isa: string[], extra: Record<string, any> = {}) {
    const levels = ["Enterprise", "Site", "Area", "Work Center", "Work Unit"];
    return {
        schema: "schema-top",
        sparkplugName: name,
        originMap: {
            Schema_UUID: "schema-top",
            Instance_UUID: `inst-${name}`,
            Device_Information: {
                Schema_UUID: "schema-di",
                ISA95_Hierarchy: {
                    Schema_UUID: HIERARCHY,
                    ...Object.fromEntries(isa.map((v, i) => [levels[i], { Value: v }])),
                },
            },
            Phases: {
                Schema_UUID: "schema-phases",
                Instance_UUID: `phases-${name}`,
                "1": {
                    Schema_UUID: "schema-phase",
                    True_RMS_Current: { Schema_UUID: "schema-metric", Sparkplug_Type: "FloatLE" },
                },
            },
            Status: { Schema_UUID: "schema-metric", Sparkplug_Type: "String" },
            ...extra,
        },
    };
}

function tree(store?: I3xStore) {
    return new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
}

function rows(store: I3xStore, table: string): number {
    return (store.prepare(`select count(*) n from ${table}`).get() as any).n;
}

describe("I3xStore", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "i3x-store-")); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("creates the schema, then reopens it warm with the rows intact", () => {
        const path = join(dir, "i3x.db");
        const s1 = new I3xStore({ path, fingerprint: "ns" });
        expect(s1.warm).toBe(false);
        tree(s1).addDevice("dev-1", devInfo("D1", ["AMRC"]), { name: "Device 1" });
        const count = rows(s1, "object");
        s1.close();

        const s2 = new I3xStore({ path, fingerprint: "ns" });
        expect(s2.warm).toBe(true);
        expect(rows(s2, "object")).toBe(count);
        expect(tree(s2).getObject("dev-1")!.displayName).toBe("Device 1");
        s2.close();
    });

    it("rebuilds the database when the schema version or fingerprint changes", () => {
        const path = join(dir, "i3x.db");
        const s1 = new I3xStore({ path, fingerprint: "ns" });
        tree(s1).addDevice("dev-1", devInfo("D1", ["AMRC"]), { name: "Device 1" });
        s1.close();

        const s2 = new I3xStore({ path, fingerprint: "other-ns" });
        expect(s2.warm).toBe(false);
        expect(rows(s2, "object")).toBe(0);
        tree(s2).addDevice("dev-1", devInfo("D1", ["AMRC"]), { name: "Device 1" });
        s2.db.exec(`pragma user_version = ${SCHEMA_VERSION + 100}`);
        s2.close();

        const s3 = new I3xStore({ path, fingerprint: "other-ns" });
        expect(s3.warm).toBe(false);
        expect(rows(s3, "object")).toBe(0);
        expect((s3.db.prepare("pragma user_version").get() as any).user_version).toBe(SCHEMA_VERSION);
        s3.close();
    });

    it("starts a new database in place of a file that is not one", () => {
        const path = join(dir, "i3x.db");
        writeFileSync(path, "this is not a database ".repeat(500));
        writeFileSync(`${path}-wal`, "garbage");
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const s = new I3xStore({ path });
            expect(err).toHaveBeenCalled();
            expect(s.warm).toBe(false);
            tree(s).addDevice("dev-1", devInfo("D1", ["AMRC"]), { name: "Device 1" });
            s.close();
            expect(readFileSync(path).subarray(0, 15).toString()).toBe("SQLite format 3");
        } finally {
            err.mockRestore();
        }
    });

    it("starts a new database in place of a truncated one", () => {
        const path = join(dir, "i3x.db");
        const s1 = new I3xStore({ path });
        const t1 = tree(s1);
        for (let i = 0; i < 200; i++) t1.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
        s1.close();
        truncateSync(path, Math.floor(statSync(path).size / 2));
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const s2 = new I3xStore({ path });
            expect(err).toHaveBeenCalled();
            expect(s2.warm).toBe(false);
            expect(tree(s2).objectCount()).toBe(0);
            s2.close();
        } finally {
            err.mockRestore();
        }
    });

    it("uses WAL and the configured page cache", () => {
        const s = new I3xStore({ path: join(dir, "i3x.db"), cacheMb: 16 });
        expect((s.db.prepare("pragma journal_mode").get() as any).journal_mode).toBe("wal");
        expect((s.db.prepare("pragma cache_size").get() as any).cache_size).toBe(-16 * 1024);
        expect((s.db.prepare("pragma synchronous").get() as any).synchronous).toBe(1);
        s.close();
    });

    it("group-commits writes after commitInterval, or on commit() and close()", async () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 50 });
        const other = new (process.getBuiltinModule("node:sqlite") as any).DatabaseSync(path);
        const seen = (k: string) => other.prepare("select value from meta where key = ?").get(k)?.value;

        s.setMeta("a", "1");
        // This connection sees its own write at once; others do not yet.
        expect(s.getMeta("a")).toBe("1");
        expect(seen("a")).toBeUndefined();
        await new Promise(r => setTimeout(r, 120));
        expect(seen("a")).toBe("1");

        s.setMeta("b", "2");
        s.commit();
        expect(seen("b")).toBe("2");

        s.setMeta("c", "3");
        s.close();
        expect(seen("c")).toBe("3");
        other.close();
    });

    it("commits a batch early once it holds maxBatchChanges rows", () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 60_000, maxBatchChanges: 50 });
        const other = new (process.getBuiltinModule("node:sqlite") as any).DatabaseSync(path);
        const seen = () => other.prepare("select count(*) n from meta where key like 'k%'").get().n;
        s.transaction(() => { for (let i = 0; i < 10; i++) s.setMeta(`k${i}`, "x"); });
        expect(seen()).toBe(0);
        s.transaction(() => { for (let i = 10; i < 60; i++) s.setMeta(`k${i}`, "x"); });
        expect(seen()).toBe(60);
        other.close();
        s.close();
    });

    it("checkpoints the WAL from a worker thread, not in a commit", async () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 0, checkpointInterval: 50 });
        expect((s.db.prepare("pragma wal_autocheckpoint").get() as any).wal_autocheckpoint).toBe(0);
        const before = statSync(path).size;
        const t = tree(s);
        for (let i = 0; i < 300; i++) t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
        // Nothing on this thread copied the WAL into the file...
        expect(statSync(path).size).toBe(before);
        expect(statSync(`${path}-wal`).size).toBeGreaterThan(100_000);
        // ...the worker does, within a few intervals.
        for (let i = 0; i < 100 && statSync(path).size === before; i++)
            await new Promise(r => setTimeout(r, 20));
        expect(statSync(path).size).toBeGreaterThan(before);
        s.close();
    });

    it("keeps the WAL bounded under constant writes", async () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 0, checkpointInterval: 5, walLimit: 4 * 1024 * 1024 });
        const t = tree(s);
        let largest = 0;
        for (let i = 0; i < 3000; i++) {
            // As the sync engine does: wait while the checkpoint is behind.
            await s.walReady();
            t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
            largest = Math.max(largest, statSync(`${path}-wal`).size);
            if (i % 50 === 49) await new Promise(r => setTimeout(r, 1));
        }
        // 3,000 devices write about 450 MB of WAL frames. Rewound and
        // reused, the file stays near journal_size_limit (64 MiB).
        expect(largest).toBeLessThan(128 * 1024 * 1024);
        expect(t.objectCount()).toBeGreaterThan(3000);
        s.close();
    }, 60_000);

    it("keeps the WAL bounded when writers never wait, by the hard cap", async () => {
        const path = join(dir, "i3x.db");
        // Hard cap: 16 x 1 MiB.
        const s = new I3xStore({ path, commitInterval: 0, checkpointInterval: 5, walLimit: 1024 * 1024 });
        const t = tree(s);
        let largest = 0;
        for (let i = 0; i < 6000; i++) {
            t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
            largest = Math.max(largest, statSync(`${path}-wal`).size);
            if (i % 50 === 49) await new Promise(r => setTimeout(r, 1));
        }
        // About 900 MB of WAL frames are written. The file rewinds after
        // each hard checkpoint (and is cut back to journal_size_limit,
        // 64 MiB), growing only between them.
        expect(largest).toBeLessThan(300 * 1024 * 1024);
        s.close();
    }, 60_000);

    it("does not hold writers back while a reader pins the checkpoint", async () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 0, checkpointInterval: 5, walLimit: 1024 * 1024 });
        const t = tree(s);
        t.addDevice("dev-0", devInfo("D0", ["AMRC"]), { name: "D0" });
        // A long read: a snapshot no checkpoint can pass.
        const reader = s.openReader()!;
        reader.exec("begin");
        reader.prepare("select count(*) n from object").get();
        try {
            const t0 = performance.now();
            let waited = 0;
            for (let i = 1; i < 400; i++) {
                const w0 = performance.now();
                await s.walReady();
                waited += performance.now() - w0;
                t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
                if (performance.now() - t0 > 8000) break;
            }
            // The WAL went over the limit, and writers went on anyway.
            expect(statSync(`${path}-wal`).size).toBeGreaterThan(1024 * 1024);
            expect(t.objectCount()).toBeGreaterThan(400);
            expect(waited).toBeLessThan(3000);
        } finally {
            reader.exec("commit");
            reader.close();
        }
        // Once the reader goes, writers that can wait hold back again
        // until the checkpoint catches up, and the WAL rewinds.
        for (let i = 400; i < 800; i++) {
            await s.walReady();
            t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
        }
        s.close();
    }, 60_000);

    it("falls back to checkpoints on the main thread if the worker dies", async () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 0, checkpointInterval: 5, walLimit: 64 * 1024 });
        const t = tree(s);
        for (let i = 0; i < 50; i++) t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
        await new Promise(r => setTimeout(r, 50));
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            await (s as any).checkpointer.terminate();
            await new Promise(r => setTimeout(r, 50));
            expect(err).toHaveBeenCalled();
            expect((s.db.prepare("pragma wal_autocheckpoint").get() as any).wal_autocheckpoint).toBe(1000);
            // Nothing waits for reports that will never come.
            for (let i = 50; i < 100; i++) t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC"]), { name: `D${i}` });
            expect(s.walBehind()).toBe(false);
            const t0 = performance.now();
            await s.walReady();
            expect(performance.now() - t0).toBeLessThan(100);
        } finally {
            err.mockRestore();
            s.close();
        }
    });

    it("does not report a checkpoint error after a commit as a failed commit", () => {
        const path = join(dir, "i3x.db");
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        for (const commitInterval of [60_000, 0]) {
            rmSync(path, { force: true });
            const s = new I3xStore({ path, commitInterval });
            const failed: unknown[] = [];
            s.onCommitFailure(e => failed.push(e));
            const hard = jest.spyOn(s as any, "hardCheckpoint")
                .mockImplementation(() => { throw new Error("disk I/O error"); });
            try {
                expect(() => s.setMeta("kept", "yes")).not.toThrow();
                s.commit();
                expect(failed).toEqual([]);
                expect(s.getMeta("kept")).toBe("yes");
            } finally {
                hard.mockRestore();
                s.close();
            }
            const again = new I3xStore({ path });
            expect(again.getMeta("kept")).toBe("yes");
            again.close();
        }
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it("commits each transaction at once with commitInterval 0", () => {
        const path = join(dir, "i3x.db");
        const s = new I3xStore({ path, commitInterval: 0 });
        const other = new (process.getBuiltinModule("node:sqlite") as any).DatabaseSync(path);
        s.setMeta("a", "1");
        expect(other.prepare("select value from meta where key = 'a'").get()?.value).toBe("1");
        other.close();
        s.close();
    });

    it("rolls a failed transaction back, nested calls included", () => {
        const s = new I3xStore();
        expect(() => s.transaction(() => {
            s.setMeta("a", "1");
            s.transaction(() => s.setMeta("b", "2"));
            throw new Error("boom");
        })).toThrow("boom");
        expect(s.getMeta("a")).toBeUndefined();
        expect(s.getMeta("b")).toBeUndefined();

        s.transaction(() => s.transaction(() => s.setMeta("c", "3")));
        expect(s.getMeta("c")).toBe("3");

        // An inner failure undoes only the inner writes.
        s.transaction(() => {
            s.setMeta("d", "4");
            try {
                s.transaction(() => { s.setMeta("e", "5"); throw new Error("inner"); });
            } catch { /* expected */ }
        });
        expect(s.getMeta("d")).toBe("4");
        expect(s.getMeta("e")).toBeUndefined();
    });
});

describe("ObjectTree rows", () => {
    it("stores objects, metric meta and the device's schemas", () => {
        const t = tree();
        t.addDevice("dev-1", devInfo("D1", ["AMRC", "Sheffield"]), { name: "Device 1" });

        // Enterprise, Site, device, Device_Information, ISA95_Hierarchy,
        // Phases, Phases/1, True_RMS_Current, Status.
        expect(t.objectCount()).toBe(9);
        expect(rows(t.store, "metric_meta")).toBe(2);
        const leaf = t.getChildElementIds(t.getChildElementIds("phases-D1")[0])[0];
        expect(t.getMetricMeta(leaf)).toEqual({
            topLevelInstanceUuid: "dev-1",
            metricPath: "Phases/1",
            metricName: "True_RMS_Current",
            sparkplugType: "FloatLE",
            typeSuffix: "d",
        });
        expect(t.getDeviceSchemaUuids("dev-1").sort()).toEqual(
            [HIERARCHY, "schema-di", "schema-metric", "schema-phase", "schema-phases", "schema-top"].sort());
        expect(t.getDeviceUuids()).toEqual(["dev-1"]);
    });

    it("shares ISA-95 levels between devices and removes them with the last device", () => {
        const t = tree();
        t.addDevice("dev-1", devInfo("D1", ["AMRC", "Sheffield", "F2050"]), { name: "Device 1" });
        t.addDevice("dev-2", devInfo("D2", ["AMRC", "Sheffield", "F2050"]), { name: "Device 2" });
        t.addDevice("dev-3", devInfo("D3", ["AMRC", "Rotherham"]), { name: "Device 3" });

        const isa = () => t.getObjects({ typeElementId: "isa95-level" }).map(o => o.displayName).sort();
        expect(isa()).toEqual(["AMRC", "F2050", "Rotherham", "Sheffield"]);
        const area = t.getObject("dev-1")!.parentId!;
        expect(t.getObject("dev-2")!.parentId).toBe(area);
        expect(t.getObjects({ root: true }).map(o => o.displayName)).toEqual(["AMRC"]);

        t.removeDevice("dev-1");
        expect(isa()).toEqual(["AMRC", "F2050", "Rotherham", "Sheffield"]);
        t.removeDevice("dev-2");
        expect(isa()).toEqual(["AMRC", "Rotherham"]);
        t.removeDevice("dev-3");
        expect(isa()).toEqual([]);
        expect(t.objectCount()).toBe(0);
        expect(rows(t.store, "metric_meta")).toBe(0);
        expect(rows(t.store, "device_schema")).toBe(0);
    });

    it("moves a device when its ISA-95 hierarchy changes, and cleans the old levels", () => {
        const t = tree();
        t.addDevice("dev-1", devInfo("D1", ["AMRC", "Old"]), { name: "Device 1" });
        t.replaceDeviceSubtree("dev-1", devInfo("D1", ["AMRC", "New"]), { name: "Device 1" });
        const site = t.getObject(t.getObject("dev-1")!.parentId!)!;
        expect(site.displayName).toBe("New");
        expect(t.getObjects({ typeElementId: "isa95-level" }).map(o => o.displayName).sort())
            .toEqual(["AMRC", "New"]);
        // The device is listed under its new parent only.
        const oldSite = t.getObjects().find(o => o.displayName === "Old");
        expect(oldSite).toBeUndefined();
        expect(t.getChildElementIds(site.elementId)).toEqual(["dev-1"]);
    });

    it("keeps an object's place in the order when it is replaced", () => {
        const t = tree();
        t.addDevice("dev-1", devInfo("D1", ["AMRC"]), { name: "Device 1" });
        t.addDevice("dev-2", devInfo("D2", ["AMRC"]), { name: "Device 2" });
        const before = t.getObjects().map(o => o.elementId);
        t.updateDeviceName("dev-1", "Renamed");
        t.addObjectType("schema-top", { title: "A" }, null);
        t.addObjectType("schema-other", { title: "B" }, null);
        t.updateObjectType("schema-top", { title: "A2" }, { name: "Top" });
        expect(t.getObjects().map(o => o.elementId)).toEqual(before);
        expect(t.getObjectTypes().map(o => o.elementId)).toEqual(["schema-top", "schema-other"]);
    });

    it("returns object types with the schema exactly as stored", () => {
        const t = tree();
        const schema = { $id: "urn:x", title: "T", properties: { a: { enum: [1, "x", null, true] } }, n: 1.5 };
        t.addObjectType("s1", schema, { name: "Named" });
        const ot = t.getObjectType("s1")!;
        expect(ot).toEqual({ elementId: "s1", displayName: "Named", namespaceUri: "urn:ns", sourceTypeId: "s1", schema });
        expect(JSON.stringify(ot.schema)).toBe(JSON.stringify(schema));
        // A missing schema becomes {}, named after its title or UUID.
        t.addObjectType("s2", null, null);
        expect(t.getObjectType("s2")).toEqual(
            { elementId: "s2", displayName: "s2", namespaceUri: "urn:ns", sourceTypeId: "s2", schema: {} });
    });

    it("iterateObjects gives exactly getObjects, across page boundaries and filters", () => {
        const t = tree();
        for (let i = 0; i < 40; i++)
            t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC", `Site ${i % 3}`]), { name: `Device ${i}` });
        for (const opts of [undefined, { root: true }, { typeElementId: "schema-metric" }, { typeElementId: "none" }]) {
            const all = t.getObjects(opts);
            for (const page of [1, 7, 1000])
                expect([...t.iterateObjects(opts, page)]).toEqual(all);
        }
        expect(t.getObjects().length).toBe(t.objectCount());
    });

    it("tells change listeners about writes, but not about UNS messages that add nothing", () => {
        const t = tree();
        let n = 0;
        t.onChange(() => n++);
        t.addDevice("dev-1", devInfo("D1", ["AMRC"]), { name: "Device 1" });
        expect(n).toBe(1);
        t.addCompositionFromUns(["dev-1"], ["schema-top"], ["New", "Leaf"]);
        expect(n).toBe(2);
        t.addCompositionFromUns(["dev-1"], ["schema-top"], ["New", "Leaf"]);
        t.addCompositionFromUns(["dev-1"], ["schema-top"], ["Status"]);
        expect(n).toBe(2);
    });

    it("never scans a whole table on the per-device and per-message paths", () => {
        const t = tree();
        for (let i = 0; i < 20; i++)
            t.addDevice(`dev-${i}`, devInfo(`D${i}`, ["AMRC", "S"]), { name: `Device ${i}` });
        const vc = new ValueCache({ objectTree: t, store: t.store, staleThreshold: 1 });

        /* Record every statement the hot paths prepare. */
        const used = new Set<string>();
        const prepare = t.store.prepare.bind(t.store);
        t.store.prepare = (sql: string) => { used.add(sql); return prepare(sql); };

        t.addDevice("dev-new", devInfo("New", ["AMRC", "S"]), { name: "New" });
        t.addCompositionFromUns(["dev-3"], ["schema-top"], ["Extra", "Leaf"], ["AMRC", "S"]);
        vc.onUnsMessage("UNS/v1/AMRC/S/Edge/D3/Status",
            Buffer.from('{"timestamp":"2026-10-05T12:00:00Z","value":1}'),
            { properties: { userProperties: { InstanceUUIDPath: "dev-3:", SchemaUUIDPath: "schema-top:" } } });
        vc.getValue("dev-3");
        vc.recordInfluxValues([{ elementId: "x", device: "dev-3", anchor: "dev-3",
            value: 1, quality: "Good", timestamp: "2026-10-05T12:00:00Z" }]);
        t.replaceDeviceSubtree("dev-3", devInfo("D3", ["AMRC", "T"]), { name: "Device 3" });
        t.updateDeviceName("dev-4", "Renamed");
        t.removeDevice("dev-5");
        vc.removeDevice("dev-5");
        t.getRelated("dev-6");
        t.getDescendantLeafIds("dev-6", 0);
        t.getDeviceSchemaUuids("dev-6");
        t.isSchemaReferenced("schema-top");
        t.dropOrphans();
        t.getObjectType("schema-top");
        expect(used.size).toBeGreaterThan(15);

        const scans: string[] = [];
        for (const sql of used) {
            for (const r of t.store.db.prepare(`explain query plan ${sql}`).all() as any[]) {
                // "SCAN x" without an index, or "SCAN x USING [COVERING] INDEX"
                // with no search terms, reads every row of x.
                if (/^SCAN (object|o|metric_meta|last_value|device_schema|object_type)\b/.test(r.detail))
                    scans.push(`${r.detail} <- ${sql.replace(/\s+/g, " ").trim()}`);
            }
        }
        expect(scans).toEqual([]);
    });
});
