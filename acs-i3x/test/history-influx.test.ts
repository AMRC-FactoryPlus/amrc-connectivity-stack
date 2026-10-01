/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Equivalence test for the bulk current-value path against a real
 * InfluxDB 2.x. Skipped unless I3X_TEST_INFLUX_URL is set, e.g.
 *
 *   docker run -d --name i3xbulk-influx -p 58086:8086 \
 *     -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=bench \
 *     -e DOCKER_INFLUXDB_INIT_PASSWORD=benchbench123 -e DOCKER_INFLUXDB_INIT_ORG=default \
 *     -e DOCKER_INFLUXDB_INIT_BUCKET=default -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=bench-token \
 *     influxdb:2.3.0-alpine
 *   I3X_TEST_INFLUX_URL=http://localhost:58086 npm test -- history-influx
 *
 * It seeds a fresh bucket with the synthetic fleet from
 * bench/dataset.mjs (the historian-sparkplug tag schema, with renamed
 * devices, path collisions, simulated series, data across shard
 * groups, data outside the 30-day window and devices with no data),
 * builds a real ObjectTree for it, and checks that the bulk path
 * returns exactly what the old per-leaf path returns. A second bucket
 * holds a few devices with 1,000 extra tags each, to check the
 * measurement filter on requests for a few fields of wide devices.
 */

import { ObjectTree } from "../lib/object-tree.js";
import { History } from "../lib/history.js";
import type { I3xValueResponse, I3xVqt } from "../lib/types/i3x.js";
// @ts-ignore - plain ESM module shared with the benchmark
import { lines, pipelineSnapshot, deviceUuid } from "../bench/dataset.mjs";

const URL = process.env.I3X_TEST_INFLUX_URL;
const TOKEN = process.env.I3X_TEST_INFLUX_TOKEN ?? "bench-token";
const ORG = process.env.I3X_TEST_INFLUX_ORG ?? "default";
const DEVICES = 120;
const describeInflux = URL ? describe : describe.skip;

const headers = { Authorization: `Token ${TOKEN}` };
const bucket = `i3x-equivalence-${Date.now()}`;
let bucketId = "";

/** Create a bucket and write line protocol into it; returns the bucket id. */
async function seedBucket(name: string, all: string[]): Promise<string> {
    const orgs = await (await fetch(`${URL}/api/v2/orgs?org=${ORG}`, { headers })).json() as any;
    const created = await (await fetch(`${URL}/api/v2/buckets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ orgID: orgs.orgs[0].id, name, retentionRules: [] }),
    })).json() as any;
    for (let i = 0; i < all.length; i += 20000) {
        const res = await fetch(`${URL}/api/v2/write?org=${ORG}&bucket=${name}&precision=ms`, {
            method: "POST", headers, body: all.slice(i, i + 20000).join("\n"),
        });
        if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
    }
    return created.id;
}

/** A real ObjectTree built from the synthetic fleet. */
function buildTree(devices: number, wide = 0): ObjectTree {
    const fplus = { debug: { bound: () => () => {} } };
    const tree = new ObjectTree({ fplus, namespaceName: "AMRC", namespaceUri: "urn:test" });
    (tree as any).buildNamespace();
    (tree as any).buildRelationshipTypes();
    tree.refreshFromSnapshot(pipelineSnapshot(devices, wide));
    return tree;
}

/**
 * Old per-leaf read, memoised per History instance. The seeded data
 * does not change during the test, so a memo returns what a fresh
 * getCurrentValue would, and keeps the reference path from firing
 * thousands of concurrent queries (the overload this change fixes).
 */
const memo = new WeakMap<History, Map<string, Promise<I3xValueResponse | null>>>();
function refLeaf(history: History, leafId: string): Promise<I3xValueResponse | null> {
    let m = memo.get(history);
    if (!m) memo.set(history, m = new Map());
    let p = m.get(leafId);
    if (!p) m.set(leafId, p = history.getCurrentValue(leafId));
    return p;
}

/**
 * The composition path as it was before the bulk change: one
 * getCurrentValue query per descendant leaf, assembled in leaf order.
 * Same logic as the old getCompositionValue; only the query
 * concurrency is bounded.
 */
async function referenceComposition(history: History, tree: ObjectTree, elementId: string, maxDepth = 1): Promise<I3xValueResponse | null> {
    const obj = tree.getObject(elementId);
    if (!obj) return null;
    const leafIds = tree.getDescendantLeafIds(elementId, maxDepth);
    const components: Record<string, I3xVqt> = {};
    const results = await limited(leafIds, 50, async (leafId) => {
        const val = await refLeaf(history, leafId);
        return { leafId, val };
    });
    let latestTimestamp = "";
    for (const { leafId, val } of results) {
        if (val) {
            components[leafId] = { value: val.value, quality: val.quality, timestamp: val.timestamp };
            if (val.timestamp > latestTimestamp) latestTimestamp = val.timestamp;
        }
    }
    if (Object.keys(components).length === 0) return null;
    return { elementId, isComposition: true, value: null, quality: "Good", timestamp: latestTimestamp, components };
}

/** The old value_objects fallback for one id. */
function reference(history: History, tree: ObjectTree, id: string, maxDepth: number) {
    return tree.getObject(id)?.isComposition
        ? referenceComposition(history, tree, id, maxDepth)
        : refLeaf(history, id);
}

/** Run promises with limited concurrency, to keep the reference path well clear of client timeouts. */
async function limited<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: n }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }));
    return out;
}

describeInflux("History bulk path against real InfluxDB", () => {
    let tree: ObjectTree;
    const histories: Record<string, History> = {};

    beforeAll(async () => {
        const now = Date.now();
        const all: string[] = [];
        for (let i = 0; i < DEVICES; i++) for (const l of lines(i, now, 6)) all.push(l);
        bucketId = await seedBucket(bucket, all);
        tree = buildTree(DEVICES);

        const mk = (bulkChunkSize?: number, bulkMeasurementFilterMax?: number) => new History({
            influxUrl: URL!, influxToken: TOKEN, influxOrg: ORG, influxBucket: bucket, objectTree: tree,
            bulkChunkSize, bulkMeasurementFilterMax,
        });
        histories.defaultChunks = mk();
        histories.chunksOf7 = mk(7);
        // A fleet chunk needs fewer than 50 measurements, so the two
        // above always filter on measurement. This one never does.
        histories.noMeasurementFilter = mk(undefined, 0);
    }, 120_000);

    afterAll(async () => {
        if (bucketId) await fetch(`${URL}/api/v2/buckets/${bucketId}`, { method: "DELETE", headers });
    });

    const leaves = () => tree.getObjects().filter((o) => !o.isComposition).map((o) => o.elementId);
    const comps = () => tree.getObjects().filter((o) => o.isComposition).map((o) => o.elementId);

    it("covers the edge cases the fleet is meant to contain", async () => {
        const h = histories.defaultChunks;
        const ref = await limited(leaves(), 50, (id) => h.getCurrentValue(id));
        const found = ref.filter(Boolean).length;
        // Some leaves have data, some do not (no-data and out-of-window devices).
        expect(found).toBeGreaterThan(1000);
        expect(found).toBeLessThan(leaves().length);
        // Renamed device 1: its static Asset_Type leaf has two series.
        // The per-leaf query returns the first one ("Traffic Signal 1"),
        // which is older than the renamed copy. The bulk path must
        // return that same, older row.
        const leaf = tree.getChildElementIds(deviceUuid(1))
            .find((c) => tree.getObject(c)?.displayName === "Asset_Type")!;
        const perLeaf = await h.getCurrentValue(leaf);
        const newest = await history_newest(h, deviceUuid(1), "Asset_Type:s");
        expect(perLeaf!.timestamp < newest).toBe(true);
        expect((await h.getCurrentValues([leaf])).get(leaf)).toEqual(perLeaf);
    }, 120_000);

    for (const name of ["defaultChunks", "chunksOf7", "noMeasurementFilter"]) {
        it(`every leaf: bulk equals per-leaf (${name})`, async () => {
            const h = histories[name];
            const ids = leaves();
            const ref = await limited(ids, 50, (id) => refLeaf(h, id));
            const bulk = await h.getCurrentValues(ids);
            for (let i = 0; i < ids.length; i++) {
                expect([ids[i], bulk.get(ids[i]) ?? null]).toEqual([ids[i], ref[i]]);
            }
        }, 300_000);

        for (const depth of [0, 1, 2, 3]) {
            it(`every composition at maxDepth ${depth}: bulk equals per-leaf (${name})`, async () => {
                const h = histories[name];
                const ids = [...comps(), "no-such-id"];
                const ref = await limited(ids, 4, (id) => reference(h, tree, id, depth));
                const bulk = await h.getValues(ids, depth);
                for (let i = 0; i < ids.length; i++) {
                    // toEqual ignores key order, so compare the JSON too:
                    // the API serialises components in insertion order.
                    expect(JSON.stringify(bulk.get(ids[i]))).toBe(JSON.stringify(ref[i]));
                }
            }, 300_000);
        }
    }

    it("getCompositionValue (single GET path) equals the per-leaf version", async () => {
        const h = histories.defaultChunks;
        for (let i = 0; i < DEVICES; i += 7) {
            const id = deviceUuid(i);
            expect(JSON.stringify(await h.getCompositionValue(id)))
                .toBe(JSON.stringify(await referenceComposition(h, tree, id)));
        }
    }, 120_000);
});

describeInflux("History bulk path against real InfluxDB: wide devices", () => {
    const WIDE_DEVICES = 2;
    const WIDTH = 1000;
    const wideBucket = `i3x-equivalence-wide-${Date.now()}`;
    let wideBucketId = "";
    let tree: ObjectTree;
    let h: History;
    let queries: string[];

    beforeAll(async () => {
        const now = Date.now();
        const all: string[] = [];
        for (let i = 0; i < WIDE_DEVICES; i++) for (const l of lines(i, now, 2, WIDTH)) all.push(l);
        wideBucketId = await seedBucket(wideBucket, all);
        tree = buildTree(WIDE_DEVICES, WIDTH);
        h = new History({
            influxUrl: URL!, influxToken: TOKEN, influxOrg: ORG, influxBucket: wideBucket, objectTree: tree,
        });
        // Record every bulk query, to check which ones filter.
        const qa = (h as any).queryApi;
        const collect = qa.collectRows.bind(qa);
        queries = [];
        qa.collectRows = (q: string) => { queries.push(q); return collect(q); };
    }, 120_000);

    afterAll(async () => {
        if (wideBucketId) await fetch(`${URL}/api/v2/buckets/${wideBucketId}`, { method: "DELETE", headers });
    });

    /* Leaf children of each device, in tree order. Device 1 is a
     * renamed device, so each of its leaves has two series. */
    const deviceLeaves = (i: number) => tree.getChildElementIds(deviceUuid(i))
        .filter((c) => !tree.getObject(c)?.isComposition);

    async function expectSameAsPerLeaf(ids: string[]) {
        const ref = await limited(ids, 50, (id) => refLeaf(h, id));
        queries.length = 0;
        const bulk = await h.getCurrentValues(ids);
        const bulkQueries = [...queries];
        for (let i = 0; i < ids.length; i++) {
            expect([ids[i], bulk.get(ids[i]) ?? null]).toEqual([ids[i], ref[i]]);
        }
        expect(ref.filter(Boolean).length).toBe(ids.length);
        return bulkQueries;
    }

    it("has more than 1,000 leaves per device", () => {
        for (let i = 0; i < WIDE_DEVICES; i++) expect(deviceLeaves(i).length).toBeGreaterThan(WIDTH);
    });

    for (const [label, pick] of [
        ["one static field each", (ls: string[]) => ls.slice(0, 1)],
        ["one wide field each", (ls: string[]) => ls.slice(-1)],
        ["five fields each", (ls: string[]) => [ls[0], ls[3], ls[200], ls[700], ls[ls.length - 1]]],
    ] as Array<[string, (ls: string[]) => string[]]>) {
        it(`${label}: filters on measurement and equals per-leaf`, async () => {
            const ids = Array.from({ length: WIDE_DEVICES }, (_, i) => pick(deviceLeaves(i))).flat();
            const qs = await expectSameAsPerLeaf(ids);
            expect(qs).toHaveLength(1);
            expect(qs[0]).toContain(`r["_measurement"] ==`);
        }, 120_000);
    }

    it("every leaf: no measurement filter and equals per-leaf", async () => {
        const ids = Array.from({ length: WIDE_DEVICES }, (_, i) => deviceLeaves(i)).flat();
        const qs = await expectSameAsPerLeaf(ids);
        expect(qs).toHaveLength(1);
        expect(qs[0]).not.toContain(`_measurement`);
    }, 300_000);
});

/** Newest timestamp across all series of a device, ignoring series order. */
async function history_newest(h: History, tli: string, measurement: string): Promise<string> {
    const rows: any[] = await (h as any).queryApi.collectRows(
        `from(bucket: "${bucket}") |> range(start: -30d) |> filter(fn: (r) => r.topLevelInstance == "${tli}" and r._measurement == "${measurement}") |> last() |> keep(columns: ["_time"]) |> group() |> max(column: "_time")`);
    return rows[0]._time;
}
