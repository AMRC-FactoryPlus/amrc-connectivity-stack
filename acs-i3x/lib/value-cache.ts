/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ValueCache — Subscribes to UNS MQTT topics, keeps the last value of
 * every leaf metric, and notifies subscribers of changes.
 *
 * The values live in the last_value table of the SQLite store, not on
 * the heap. UNS messages are written in batches (every flushInterval
 * ms, or every flushMaxRows rows). Reads flush first, so they always
 * see every message already received. Listeners (SSE subscriptions)
 * are still called synchronously for every message.
 *
 * InfluxDB results read by History on a cache miss are written back
 * here too (recordInfluxValues), so the next read of that metric is
 * served locally.
 */

import type { I3xVqt, I3xValueResponse } from "./types/i3x.js";
import { deriveQuality } from "./quality.js";
import { toI3xVqt } from "./mapping.js";
import { I3xStore } from "./store.js";
import { Slicer } from "./slicer.js";

interface ValueCacheOpts {
    objectTree: ObjectTreeLike;
    staleThreshold: number;
    /** The database for last values. Defaults to a new in-memory one. */
    store?: I3xStore;
    /** Most ms a UNS value waits before it is written. */
    flushInterval?: number;
    /** Write at once when this many values are waiting (default 1,000). */
    flushMaxRows?: number;
}

/**
 * Minimal interface that ValueCache needs from ObjectTree.
 * Using a structural type so we can mock it in tests.
 */
interface ObjectTreeLike {
    addCompositionFromUns(
        instanceUuidPath: string[],
        schemaUuidPath: string[],
        metricSegments: string[],
        isa95Segments?: string[],
    ): string | null;
    getObject(elementId: string): { elementId: string; isComposition: boolean; parentId?: string | null } | undefined;
    getChildElementIds(elementId: string): string[];
    isReady(): boolean;
}

type ValueChangeListener = (elementId: string, vqt: I3xVqt) => void;

/** A value read from InfluxDB, to keep for the next read. */
export interface InfluxValue {
    elementId: string;
    /** The device (topLevelInstance) the metric belongs to. */
    device: string;
    /** The object whose composition includes this leaf directly. */
    anchor: string | null;
    value: unknown;
    quality: string;
    timestamp: string;
}

interface Pending {
    anchor: string;
    device: string;
    valueJson: string | null;
    quality: string;
    timestamp: string | null;
}

interface ValueRow {
    element_id: string;
    value_json: string | null;
    quality: string;
    timestamp: string | null;
}

/** A colon-separated UUID path, without the empty segment a trailing
 * colon leaves. uns-ingester sends `top:` for a metric directly under
 * the device, which used to file it under the parent ''. */
function splitPath(s: string): string[] {
    const parts = s.split(":");
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return parts;
}

/* JSON has no undefined; store it as SQL NULL and give it back. */
const toJson = (v: unknown): string | null => v === undefined ? null : JSON.stringify(v);

function toVqt(r: ValueRow): I3xVqt {
    return {
        value: r.value_json === null ? undefined : JSON.parse(r.value_json),
        quality: r.quality as I3xVqt["quality"],
        timestamp: r.timestamp ?? undefined as any,
    };
}

/**
 * A cached value whose components, for a composition, are read as they
 * are iterated rather than all at once. A composition high in the
 * ISA-95 hierarchy can have millions of components.
 */
/** One step of a composition walk: a component, or null when the walk
 * has done some work without finding one (a tick, so a consumer can
 * yield to the event loop between steps). */
export type ComponentStep = [string, I3xVqt] | null;

/**
 * A cached value whose components, for a composition, are read as they
 * are iterated rather than all at once. A composition high in the
 * ISA-95 hierarchy can have millions of components.
 */
export interface LazyValue {
    /** The response, without `components`. */
    head: I3xValueResponse;
    /** A composition's components, in response order, with null ticks
     * between them. Each call reads them again. */
    components?: () => Iterable<ComponentStep>;
}

/** A LazyValue over a value already built in memory. */
export function lazyFromValue(v: I3xValueResponse | null): LazyValue | null {
    if (!v) return null;
    if (!v.components) return { head: v };
    const { components, ...head } = v;
    return { head: head as I3xValueResponse, components: () => Object.entries(components) };
}

/** Children read per query while walking a subtree. */
const WALK_PAGE = 256;

/** Most unwritten values kept while writes fail, in batches. */
const MAX_BACKLOG_BATCHES = 10;

const UPSERT = (source: string, guard: string) => `
    insert into last_value (element_id, anchor, device_uuid, value_json, timestamp, quality, source)
    values (?, ?, ?, ?, ?, ?, '${source}')
    on conflict (element_id) do update set
        anchor = excluded.anchor,
        device_uuid = excluded.device_uuid,
        value_json = excluded.value_json,
        timestamp = excluded.timestamp,
        quality = excluded.quality,
        source = excluded.source
    ${guard}`;

export class ValueCache {
    private objectTree: ObjectTreeLike;
    private staleThreshold: number;
    private store: I3xStore;
    private flushInterval: number;
    private flushMaxRows: number;
    private log: (msg: string, ...args: any[]) => void = () => {};

    private ready: boolean = false;
    private listeners: Set<ValueChangeListener> = new Set();

    /** UNS values not yet written, by elementId. Bounded by
     * flushMaxRows and flushInterval. */
    private pending: Map<string, Pending> = new Map();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts: ValueCacheOpts) {
        this.objectTree = opts.objectTree;
        this.staleThreshold = opts.staleThreshold;
        this.store = opts.store ?? new I3xStore();
        this.flushInterval = opts.flushInterval ?? 250;
        /* Each flush is one synchronous write; keep it short. */
        this.flushMaxRows = opts.flushMaxRows ?? 1000;
    }

    async init(fplus: any): Promise<this> {
        this.log = fplus.debug.bound("value-cache");

        /* Values stored by an earlier run may have changed while it was
         * down; we did not see those UNS messages. Start empty, as the
         * in-memory cache did, and let reads fill it from InfluxDB. */
        this.safeClear("at start");

        this.log("requesting MQTT client from ServiceClient");
        const mqtt = await fplus.mqtt_client();
        this.log("MQTT client obtained, subscribing to UNS/v1/#");
        mqtt.subscribe("UNS/v1/#");
        mqtt.on("message", (topic: string, payload: Buffer, packet: any) => {
            try {
                this.onUnsMessage(topic, payload, packet);
            } catch (err) {
                // For example a database error; drop this message only.
                console.error("ValueCache: UNS message failed:", topic, err);
            }
        });
        let connected = false;
        mqtt.on("connect", () => {
            this.log("MQTT connected");
            /* Messages sent while we were disconnected are lost, so a
             * stored value may no longer be the last one. */
            if (connected) this.safeClear("after an MQTT reconnect");
            connected = true;
        });
        mqtt.on("error", (err: any) => {
            console.error("ValueCache: MQTT error:", err);
        });
        mqtt.on("close", () => {
            this.log("MQTT connection closed");
        });
        this.ready = true;
        this.log("initialised and subscribed");
        return this;
    }

    /* ---- MQTT message handler ---- */

    onUnsMessage(topic: string, payload: Buffer, packet: any): void {
        const parts = topic.split("/");

        // Find the "Edge" segment
        const edgeIdx = parts.indexOf("Edge");
        if (edgeIdx < 0) return;

        // ISA-95 hierarchy sits between "v1" (index 1) and "Edge".
        // positions 2..edgeIdx-1 are the ISA-95 levels.
        // At minimum we need an Enterprise (at least one segment).
        const isa95Start = 2;
        if (edgeIdx <= isa95Start) {
            // No Enterprise segment → skip
            return;
        }

        // Device ID is the segment immediately after "Edge"
        const deviceIdIdx = edgeIdx + 1;
        if (deviceIdIdx >= parts.length) return;

        // Metric path segments and metric name
        const metricSegments = parts.slice(deviceIdIdx + 1);
        if (metricSegments.length === 0) return;
        const metricName = metricSegments[metricSegments.length - 1];

        // Parse custom MQTT v5 properties
        const userProps = packet?.properties?.userProperties ?? {};
        const instanceUuidPathStr: string = userProps.InstanceUUIDPath ?? "";
        const schemaUuidPathStr: string = userProps.SchemaUUIDPath ?? "";

        if (!instanceUuidPathStr) return;

        const instanceUuidPath = splitPath(instanceUuidPathStr);
        const schemaUuidPath = splitPath(schemaUuidPathStr);
        const bottomUuid = instanceUuidPath[instanceUuidPath.length - 1];

        // Parse payload
        let parsed: { timestamp: string; value: unknown };
        try {
            parsed = JSON.parse(payload.toString());
        } catch {
            this.log("failed to parse payload as JSON");
            return;
        }

        // ISA-95 hierarchy segments (Enterprise, Site, Area, etc.)
        const isa95Segments = parts.slice(isa95Start, edgeIdx);

        // Tell the object tree about the full composition chain.
        // Also passes ISA-95 segments so the tree can create hierarchy above the device.
        // Returns the leaf elementId, or null if the device is not in
        // the tree: then nothing can find the value, so drop it.
        const leafId = this.objectTree.addCompositionFromUns(
            instanceUuidPath,
            schemaUuidPath,
            metricSegments,
            isa95Segments,
        );
        if (leafId === null) return;
        const elementId = leafId ?? `${bottomUuid}/${metricName}`;

        // Derive quality — for values received from UNS, the device is
        // online and we have a value, so quality is Good.
        const quality = deriveQuality({
            online: true,
            hasValue: true,
            stale: false,
        });

        const vqt = toI3xVqt(parsed.value, quality, parsed.timestamp);

        // Queue it for the next write, filed under its parent in the
        // tree. That is where History files InfluxDB values too; the
        // bottom instance UUID is not the parent when the instance path
        // is shorter than the metric path.
        const anchor = this.objectTree.getObject(elementId)?.parentId ?? bottomUuid;
        this.pending.set(elementId, {
            anchor,
            device: instanceUuidPath[0],
            valueJson: toJson(vqt.value),
            quality: vqt.quality,
            timestamp: vqt.timestamp ?? null,
        });
        // Notify listeners first: a failed write below must not cost
        // subscribers this message.
        for (const listener of this.listeners) {
            try {
                listener(elementId, vqt);
            } catch (err) {
                console.error("ValueCache: listener threw:", err);
            }
        }

        if (this.pending.size >= this.flushMaxRows) this.flush();
        else this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.flushInterval);
        this.timer.unref?.();
    }

    /**
     * Write every waiting UNS value, in one transaction. If the write
     * fails (a full disk, an I/O error) the values go back in the queue,
     * behind any newer value for the same metric, and are tried again
     * on the next flush. Returns false on failure; it does not throw, so
     * a read goes on with what is stored.
     */
    flush(): boolean {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.pending.size === 0) return true;
        const batch = this.pending;
        this.pending = new Map();
        try {
            const st = this.store.prepare(UPSERT("uns", ""));
            this.store.transaction(() => {
                for (const [id, p] of batch)
                    st.run(id, p.anchor, p.device, p.valueJson, p.timestamp, p.quality);
            });
            return true;
        } catch (err) {
            console.error("ValueCache: writing %d values failed, will retry:", batch.size, err);
            /* Newer values (none can arrive during the write, but keep
             * the rule) win over the ones put back. */
            for (const [id, p] of this.pending) batch.set(id, p);
            this.pending = batch;
            /* Do not hold an unbounded backlog while the database is
             * broken: keep the newest entries. */
            const max = MAX_BACKLOG_BATCHES * this.flushMaxRows;
            if (this.pending.size > max) {
                let drop = this.pending.size - max;
                console.error("ValueCache: dropping the %d oldest unwritten values", drop);
                for (const id of this.pending.keys()) {
                    if (drop-- <= 0) break;
                    this.pending.delete(id);
                }
            }
            this.scheduleFlush();
            return false;
        }
    }

    /**
     * Keep values History read from InfluxDB. A stored value with a
     * later timestamp (a UNS message that arrived during the query)
     * is not replaced.
     */
    recordInfluxValues(values: InfluxValue[]): void {
        if (values.length === 0) return;
        this.flush();
        const st = this.store.prepare(UPSERT("influx",
            "where julianday(excluded.timestamp) > julianday(last_value.timestamp)"));
        this.store.transaction(() => {
            for (const v of values) {
                st.run(v.elementId, v.anchor ?? v.device, v.device,
                    toJson(v.value), v.timestamp ?? null, v.quality);
            }
        });
    }

    /** Drop the values of a device that has left the tree. */
    removeDevice(uuid: string): void {
        for (const [id, p] of this.pending) {
            if (p.device === uuid) this.pending.delete(id);
        }
        this.store.prepare("delete from last_value where device_uuid = ?").run(uuid);
    }

    /** clear(), logging a failure instead of throwing: it runs at start
     * and from an MQTT event handler, where a throw would end the
     * process. Stored values then stay until the next clear. */
    private safeClear(when: string): void {
        try {
            this.clear();
        } catch (err) {
            console.error(`ValueCache: clearing values ${when} failed:`, err);
        }
    }

    /** Drop the values of objects that have left the tree. */
    removeElements(ids: string[]): void {
        const st = this.store.prepare("delete from last_value where element_id = ?");
        this.store.transaction(() => {
            for (const id of ids) {
                this.pending.delete(id);
                st.run(id);
            }
        });
    }

    /** Forget every value. */
    clear(): void {
        this.pending.clear();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.store.prepare("delete from last_value").run();
    }

    /** Number of stored values, for tests and diagnostics. */
    size(): number {
        this.flush();
        return (this.store.prepare("select count(*) n from last_value").get() as any).n;
    }

    /* ---- Query methods ---- */

    /** True when the tree lives in our database, so a composition's
     * components can be read with one query. A mock tree in unit tests
     * is walked through its own interface instead. */
    private treeInStore(): boolean {
        return (this.objectTree as any).store === this.store;
    }

    /**
     * As getValue, but a composition's components are not built: they
     * are read, in the same order, as `components()` is iterated. The
     * head (whether there is a value at all, and its latest timestamp)
     * comes from a first pass over the same walk. Both passes run in
     * small steps with pauses for the event loop, so a composition with
     * millions of components does not stall other work. Each pass reads
     * its own snapshot, so a value written in between can make the
     * head differ slightly from the components.
     */
    async getValueLazy(elementId: string): Promise<LazyValue | null> {
        if (!this.treeInStore()) return lazyFromValue(this.getValue(elementId));

        this.flush();
        const row = this.store.prepare(
            "select element_id, value_json, quality, timestamp from last_value where element_id = ?",
        ).get(elementId) as unknown as ValueRow | undefined;
        if (row) return { head: { elementId, isComposition: false, ...toVqt(row) } };

        const obj = this.objectTree.getObject(elementId);
        if (!obj?.isComposition) return null;

        /* The old value took the latest timestamp, by string order,
         * starting from "". */
        let n = 0;
        let latest = "";
        const slicer = new Slicer();
        for (const step of this.walkComponents(elementId)) {
            if (step) {
                n++;
                const ts = step[1].timestamp;
                if (ts > latest) latest = ts;
            }
            await slicer.maybe();
        }
        if (n === 0) return null;
        return {
            head: {
                elementId,
                isComposition: true,
                value: null,
                quality: "Good",
                timestamp: latest,
            },
            components: () => this.walkComponents(elementId),
        };
    }

    /**
     * Walk the subtree under `rootId` depth first, from a read snapshot,
     * yielding the UNS values filed under each node: the order of the
     * old recursive walk (a node's own values, first seen first, then
     * each child's subtree in tree order). Every step is a few indexed
     * queries; children are read a page at a time. A leaf with no
     * children has no values filed under it (values are filed under
     * their parent) and is not visited. A null is yielded after each
     * node, so the consumer can pause however few values there are.
     */
    private *walkComponents(rootId: string): Generator<ComponentStep> {
        this.flush();
        this.store.commit();
        const reader = this.store.openReader();
        try {
            const db: any = reader ?? this.store.db;
            if (reader) reader.exec("begin");
            const values = db.prepare(`
                select element_id, value_json, quality, timestamp from last_value
                where anchor = ? and source = 'uns' order by seq`);
            const children = db.prepare(`
                select o.seq, o.element_id,
                    o.is_composition or exists (select 1 from object c where c.parent_id = o.element_id) walk
                from object o where o.parent_id = ? and o.seq > ? order by o.seq limit ?`);

            interface Level { id: string; page: any[]; i: number; after: number; done: boolean }
            const visit = function* (id: string): Generator<ComponentStep> {
                /* all(): a few dozen rows at most, and no statement left
                 * open while the consumer pauses. */
                for (const r of values.all(id) as ValueRow[])
                    yield [r.element_id, toVqt(r)];
                yield null;
            };
            const fill = (l: Level) => {
                l.page = children.all(l.id, l.after, WALK_PAGE);
                l.i = 0;
                if (l.page.length < WALK_PAGE) l.done = true;
                if (l.page.length) l.after = l.page[l.page.length - 1].seq;
            };

            yield* visit(rootId);
            const stack: Level[] = [{ id: rootId, page: [], i: 0, after: -1, done: false }];
            fill(stack[0]);
            while (stack.length) {
                const top = stack[stack.length - 1];
                if (top.i >= top.page.length) {
                    if (top.done) { stack.pop(); continue; }
                    fill(top);
                    yield null;
                    continue;
                }
                const child = top.page[top.i++];
                if (!child.walk) continue;
                if (stack.length >= 64) continue;   // guards against a parent cycle
                yield* visit(child.element_id);
                const level: Level = { id: child.element_id, page: [], i: 0, after: -1, done: false };
                fill(level);
                stack.push(level);
            }
        } finally {
            if (reader) {
                try { reader.exec("commit"); } catch { /* not in a transaction */ }
                reader.close();
            }
        }
    }

    getValue(elementId: string): I3xValueResponse | null {
        if (this.treeInStore()) {
            /* Synchronous, and so for small compositions (MCP, tests):
             * the value routes use getValueLazy. */
            this.flush();
            const row = this.store.prepare(
                "select element_id, value_json, quality, timestamp from last_value where element_id = ?",
            ).get(elementId) as unknown as ValueRow | undefined;
            if (row) return { elementId, isComposition: false, ...toVqt(row) };
            const obj = this.objectTree.getObject(elementId);
            if (!obj?.isComposition) return null;
            const components: Record<string, I3xVqt> = {};
            let latest = "";
            for (const step of this.walkComponents(elementId)) {
                if (!step) continue;
                components[step[0]] = step[1];
                if (step[1].timestamp > latest) latest = step[1].timestamp;
            }
            if (Object.keys(components).length === 0) return null;
            return { elementId, isComposition: true, value: null, quality: "Good", timestamp: latest, components };
        }

        this.flush();

        // Check if it's a direct leaf metric in the cache
        const row = this.store.prepare(
            "select element_id, value_json, quality, timestamp from last_value where element_id = ?",
        ).get(elementId) as unknown as ValueRow | undefined;
        if (row) {
            return {
                elementId,
                isComposition: false,
                ...toVqt(row),
            };
        }

        // Check if it's a composition object in the object tree
        const obj = this.objectTree.getObject(elementId);
        if (obj && obj.isComposition) {
            // Assemble components from children
            const components = this.collectChildValues(elementId, 0);
            if (components === null || Object.keys(components).length === 0) {
                return null;
            }

            // Use the latest timestamp and worst quality from components
            const entries = Object.values(components);
            const latestTs = entries.reduce(
                (best, c) => (c.timestamp > best ? c.timestamp : best),
                "",
            );

            return {
                elementId,
                isComposition: true,
                value: null,
                quality: "Good",
                timestamp: latestTs,
                components,
            };
        }

        return null;
    }

    getChildValues(elementId: string, maxDepth: number): Record<string, I3xVqt> | null {
        this.flush();
        const result = this.collectChildValues(elementId, maxDepth);
        if (result !== null && Object.keys(result).length === 0) {
            return null;
        }
        return result;
    }

    /* ---- Subscription support ---- */

    onValueChange(listener: ValueChangeListener): void {
        this.listeners.add(listener);
    }

    offValueChange(listener: ValueChangeListener): void {
        this.listeners.delete(listener);
    }

    isReady(): boolean {
        return this.ready;
    }

    /* ---- Private helpers ---- */

    /**
     * Collect all cached leaf values that belong to `elementId` or its
     * descendants, limited by `maxDepth`.
     *
     * maxDepth=0 means unlimited (all descendants).
     * maxDepth=1 means direct children only.
     */
    private collectChildValues(
        elementId: string,
        maxDepth: number,
        currentDepth: number = 1,
    ): Record<string, I3xVqt> | null {
        const result: Record<string, I3xVqt> = {};

        // Collect direct leaf metrics cached under this elementId, in
        // the order they were first seen. Only UNS values: values kept
        // from InfluxDB cover only the leaves someone asked for, so a
        // composition built from them would look complete when it is
        // not. Without UNS data the caller falls back to InfluxDB for
        // the whole composition, as it did before values were kept.
        const direct = this.store.prepare(
            "select element_id, value_json, quality, timestamp from last_value where anchor = ? and source = 'uns' order by seq",
        ).all(elementId) as unknown as ValueRow[];
        for (const r of direct) {
            result[r.element_id] = toVqt(r);
        }

        // If we haven't hit the depth limit, recurse into child objects
        if (maxDepth === 0 || currentDepth < maxDepth) {
            const childObjectIds = this.objectTree.getChildElementIds(elementId);
            for (const childId of childObjectIds) {
                const childResult = this.collectChildValues(
                    childId,
                    maxDepth,
                    currentDepth + 1,
                );
                if (childResult) {
                    Object.assign(result, childResult);
                }
            }
        }

        return Object.keys(result).length > 0 ? result : null;
    }
}
