/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Tests for the ConfigDB refresh pipeline when notify-v2 delivers a
 * config again without a change (for example after a reconnect), and
 * for UNS-discovered nodes reaching the RAG index.
 *
 * These run the real ObjectTreeRefresh, ObjectTree, ValueCache and
 * I3xRag against an in-memory ConfigDB. Deliveries are synchronous.
 */

import { jest, describe, it, expect, afterEach } from "@jest/globals";
import * as rx from "rxjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { ObjectTree } from "../lib/object-tree.js";
import { ObjectTreeRefresh } from "../lib/refresh.js";
import { I3xRag } from "../lib/rag/i3x-rag.js";
import { ValueCache } from "../lib/value-cache.js";
import { registerRagTools } from "../lib/mcp/tools.js";
import {
    DEVICE_INFORMATION_APP_UUID,
    INFO_APP_UUID,
    SCHEMA_APP_UUID,
} from "../lib/constants.js";

const SCHEMA = "schema-top";
const SUB_SCHEMA = "schema-sub";

/* The duck-typed immutable.js Set that refresh.ts expects. */
class MemberSet {
    constructor (private items: string[]) {}
    isEmpty () { return this.items.length === 0; }
    [Symbol.iterator] () { return this.items[Symbol.iterator](); }
}

/** In-memory ConfigDB. Every delivery is a fresh copy, as off the wire. */
class FakeConfigDB {
    configs = new Map<string, any>();
    subjects = new Map<string, rx.Subject<any>>();
    members = new rx.ReplaySubject<MemberSet>(1);

    private subject (key: string) {
        let s = this.subjects.get(key);
        if (!s) this.subjects.set(key, s = new rx.Subject());
        return s;
    }

    private copy (key: string) {
        const v = this.configs.get(key);
        return v === undefined ? null : JSON.parse(JSON.stringify(v));
    }

    watch_config (app: string, obj: string) {
        const key = `${app}:${obj}`;
        return rx.defer(() => this.subject(key).pipe(
            rx.startWith(this.copy(key))));
    }

    watch_members (_klass: string) {
        return this.members;
    }

    set_members (uuids: string[]) {
        this.members.next(new MemberSet(uuids));
    }

    put (app: string, obj: string, value: any) {
        const key = `${app}:${obj}`;
        this.configs.set(key, value);
        this.subject(key).next(this.copy(key));
    }

    /** Deliver every config again, unchanged, as after a reconnect. */
    redeliver_all () {
        for (const key of this.configs.keys())
            this.subject(key).next(this.copy(key));
    }
}

function devInfo (uuid: string, rev = 0) {
    return {
        schema: SCHEMA,
        sparkplugName: `Dev_${uuid}`,
        originMap: {
            Schema_UUID: SCHEMA,
            Instance_UUID: uuid,
            Temperature: {
                Sparkplug_Type: "FloatLE",
                Instance_UUID: `${uuid}-temp`,
                Documentation: `rev ${rev}`,
            },
            Motor: {
                Schema_UUID: SUB_SCHEMA,
                Instance_UUID: `${uuid}-motor`,
                Speed: { Sparkplug_Type: "FloatLE", Instance_UUID: `${uuid}-speed` },
                ...(rev > 0 ? { Torque: { Sparkplug_Type: "FloatLE", Instance_UUID: `${uuid}-torque-${rev}` } } : {}),
            },
        },
    };
}

function mk_fplus (cdb: FakeConfigDB) {
    return {
        ConfigDB: cdb,
        Directory: { get_device_info: async () => ({ online: false }) },
        debug: { bound: () => () => {} },
    };
}

const history = {
    queryHistory: async () => [],
    getCurrentValue: async () => null,
    getCompositionValue: async () => null,
};

const DEVICES = ["dev-1", "dev-2", "dev-3"];

function seed (cdb: FakeConfigDB) {
    cdb.put(SCHEMA_APP_UUID, SCHEMA, { title: "Top" });
    cdb.put(INFO_APP_UUID, SCHEMA, { name: "Top" });
    cdb.put(SCHEMA_APP_UUID, SUB_SCHEMA, { title: "Motor" });
    cdb.put(INFO_APP_UUID, SUB_SCHEMA, { name: "Motor" });
    for (const d of DEVICES) {
        cdb.put(DEVICE_INFORMATION_APP_UUID, d, devInfo(d));
        cdb.put(INFO_APP_UUID, d, { name: `Device ${d}` });
    }
}

/** Starts the pipeline over a seeded ConfigDB, with counters. */
function mk_stack (ragDirtyDelay = 20) {
    const cdb = new FakeConfigDB();
    seed(cdb);
    const fplus = mk_fplus(cdb);
    const tree = new ObjectTree({ fplus, namespaceName: "NS", namespaceUri: "urn:ns" });
    const valueCache = new ValueCache({ objectTree: tree, staleThreshold: 60_000 });
    const rag = new I3xRag(tree, valueCache, history);
    rag.init();

    const rebuild = jest.spyOn(rag, "rebuild");
    const pass = jest.spyOn(ObjectTreeRefresh.prototype as any, "collectAllSchemaUuids");

    /* Typed loosely so this file also compiles against older code. */
    const opts: any = { fplus, objectTree: tree, i3xRag: rag, valueCache, ragDirtyDelay };
    new ObjectTreeRefresh(opts).run();
    cdb.set_members(DEVICES);

    return { cdb, tree, rag, valueCache, rebuild, pass };
}

/** Everything the tree and the RAG index expose, in a stable order. */
function fingerprint (tree: ObjectTree, rag: I3xRag) {
    const objs = tree.getObjects()
        .map(o => `${o.elementId}|${o.displayName}|${o.parentId}|${o.typeElementId}|${o.isComposition}`)
        .sort();
    const types = tree.getObjectTypes()
        .map(t => `${t.elementId}|${t.displayName}`).sort();
    const hits = ["Temperature", "Motor", "Speed", "Torque", "Device", "Vibration", "Plant"]
        .map(q => rag.search(q, Infinity)
            .map(r => `${r.elementId}:${r.score.toFixed(6)}`).sort());
    return { objs, types, hits, nodes: rag.nodeCount(), edges: rag.edgeCount() };
}

/** The same state built in one pass, with no pipeline. */
function reference (cdb: FakeConfigDB) {
    const tree = new ObjectTree({ fplus: mk_fplus(cdb), namespaceName: "NS", namespaceUri: "urn:ns" });
    const get = (app: string, obj: string) => cdb.configs.get(`${app}:${obj}`);
    tree.refreshFromSnapshot({
        devices: new Map(DEVICES.map(d => [d, {
            devInfo: get(DEVICE_INFORMATION_APP_UUID, d),
            info: get(INFO_APP_UUID, d),
        }])),
        schemas: new Map([SCHEMA, SUB_SCHEMA].map(s => [s, {
            schema: get(SCHEMA_APP_UUID, s),
            info: get(INFO_APP_UUID, s),
        }])),
    });
    const rag = new I3xRag(tree, { getValue: () => null }, history);
    rag.init();
    return fingerprint(tree, rag);
}

/** A UNS message for a metric under `dev-1`, below ISA-95 `isa95`. */
function uns (vc: ValueCache, metric: string[], isa95 = ["Plant"]) {
    const topic = ["UNS", "v1", ...isa95, "Edge", "dev-1", ...metric].join("/");
    vc.onUnsMessage(topic,
        Buffer.from(JSON.stringify({ timestamp: "2026-10-01T12:00:00Z", value: 1 })),
        { properties: { userProperties: {
            InstanceUUIDPath: "dev-1",
            SchemaUUIDPath: SCHEMA,
        } } });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

afterEach(() => jest.restoreAllMocks());

describe("ObjectTreeRefresh with repeated config deliveries", () => {
    it("does no work when every config is delivered again unchanged", () => {
        const { cdb, rebuild, pass } = mk_stack();
        expect(rebuild).toHaveBeenCalledTimes(1);
        rebuild.mockClear();
        pass.mockClear();

        for (let i = 0; i < 50; i++) cdb.redeliver_all();

        expect(pass).toHaveBeenCalledTimes(0);
        expect(rebuild).toHaveBeenCalledTimes(0);
    });

    it("applies a real change once, with the same result as a full build", () => {
        const { cdb, tree, rag, rebuild, pass } = mk_stack();
        rebuild.mockClear();
        pass.mockClear();

        cdb.redeliver_all();
        cdb.put(DEVICE_INFORMATION_APP_UUID, "dev-2", devInfo("dev-2", 1));
        cdb.redeliver_all();
        cdb.put(INFO_APP_UUID, "dev-3", { name: "Renamed" });
        cdb.redeliver_all();
        cdb.put(SCHEMA_APP_UUID, SUB_SCHEMA, { title: "Motor v2" });
        cdb.put(INFO_APP_UUID, SUB_SCHEMA, { name: "Motor v2" });
        cdb.redeliver_all();

        /* One rebuild per real change (the schema change is two
         * writes), and none for repeats. Stage 2 restarts only for the
         * two device changes. */
        expect(rebuild).toHaveBeenCalledTimes(4);
        expect(pass).toHaveBeenCalledTimes(2);

        const fp = fingerprint(tree, rag);
        expect(fp).toEqual(reference(cdb));
        expect(tree.getObject("dev-2-torque-1")?.displayName).toBe("Torque");
        expect(tree.getObject("dev-3")?.displayName).toBe("Renamed");
        expect(rag.search("Torque").map(r => r.elementId)).toContain("dev-2-torque-1");
    });

    it("still applies a change back to an earlier value", () => {
        const { cdb, tree, rebuild } = mk_stack();
        rebuild.mockClear();

        cdb.put(INFO_APP_UUID, "dev-1", { name: "B" });
        cdb.put(INFO_APP_UUID, "dev-1", { name: `Device dev-1` });

        expect(rebuild).toHaveBeenCalledTimes(2);
        expect(tree.getObject("dev-1")?.displayName).toBe("Device dev-1");
    });
});

describe("UNS-discovered nodes and the RAG index", () => {
    it("reach RAG and MCP search without a config delivery", async () => {
        const { cdb, rag, valueCache, rebuild } = mk_stack();
        rebuild.mockClear();

        uns(valueCache, ["Motor", "Vibration"]);
        expect(rag.search("Vibration")).toEqual([]);

        await sleep(60);

        expect(rebuild).toHaveBeenCalledTimes(1);
        const hits = rag.search("Vibration");
        expect(hits.map(h => h.displayName)).toEqual(["Vibration"]);
        expect(rag.search("Plant").map(h => h.displayName)).toEqual(["Plant"]);

        const server = new McpServer({ name: "t", version: "0.0.1" });
        registerRagTools(server, rag);
        const client = new Client({ name: "c", version: "0.0.1" });
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await server.connect(st);
        await client.connect(ct);
        const res: any = await client.callTool({ name: "search", arguments: { query: "Vibration" } });
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed.map((h: any) => h.elementId)).toEqual([hits[0].elementId]);
        await client.close();

        /* A later unchanged delivery does nothing more. */
        rebuild.mockClear();
        cdb.redeliver_all();
        expect(rebuild).not.toHaveBeenCalled();
    });

    it("share one rebuild for a burst of new nodes", async () => {
        const { rag, valueCache, rebuild } = mk_stack();
        rebuild.mockClear();

        for (let i = 0; i < 100; i++) uns(valueCache, ["Motor", `Extra_${i}`]);
        await sleep(60);

        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(rag.search("Extra_42", 200).map(h => h.displayName)).toContain("Extra_42");
    });

    it("do not rebuild for messages that add nothing", async () => {
        const { valueCache, rebuild } = mk_stack();
        uns(valueCache, ["Motor", "Vibration"]);
        await sleep(60);
        rebuild.mockClear();

        uns(valueCache, ["Motor", "Vibration"]);
        uns(valueCache, ["Temperature"]);
        await sleep(60);

        expect(rebuild).not.toHaveBeenCalled();
    });

    it("reach RAG again when their device is removed and comes back", async () => {
        const { cdb, rag, valueCache } = mk_stack();
        uns(valueCache, ["Motor", "Vibration"]);
        await sleep(60);
        expect(rag.search("Vibration")).toHaveLength(1);

        cdb.set_members(["dev-2", "dev-3"]);
        expect(rag.search("Vibration")).toEqual([]);
        cdb.set_members(DEVICES);

        uns(valueCache, ["Motor", "Vibration"]);
        await sleep(60);
        expect(rag.search("Vibration").map(h => h.displayName)).toEqual(["Vibration"]);
    });

    it("are searchable at once after a config change", () => {
        const { cdb, rag, valueCache } = mk_stack();

        uns(valueCache, ["Motor", "Vibration"]);
        cdb.put(INFO_APP_UUID, "dev-2", { name: "Renamed" });

        expect(rag.search("Vibration").map(h => h.displayName)).toEqual(["Vibration"]);
    });
});
