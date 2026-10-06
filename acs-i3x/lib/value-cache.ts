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
 * served locally. Only for devices that publish to UNS, whose later
 * changes arrive as UNS messages.
 *
 * UNS messages are not retained, so those sent while i3X was down or
 * disconnected are lost. After a restart or an MQTT reconnect the
 * stored values are not trusted until a catch-up has read from
 * InfluxDB every series with a point since they were last known to be
 * current (see catchUp). Until then reads see only rows written since,
 * as they would after clearing every value.
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
    /**
     * Ms subtracted from the time stored values were last current, and
     * waited after connecting, before the catch-up reads InfluxDB:
     * covers the historian's write delay and device clocks behind
     * ours. Default 60 s.
     */
    catchUpMargin?: number;
    /** Longest gap, in ms, to catch up rather than clear. Default 24 h,
     * at most 30 days (the window InfluxDB reads use). */
    catchUpMaxGap?: number;
    /** Most changed values a catch-up takes before it gives up and
     * clears instead. Default 1,000,000. */
    catchUpMaxRows?: number;
    /** Waits, in ms, before each retry of a failed catch-up query; once
     * they are used up the values are cleared. */
    catchUpRetryDelays?: number[];
    /** How often, in ms, to record that the stored values are current.
     * Default 5 s. */
    currentInterval?: number;
    /**
     * How often, in ms, to refresh the values kept from InfluxDB (and
     * "no data" markers) while connected, with the catch-up query over
     * the time since the last refresh. Their devices may not publish
     * to the UNS, so nothing else would replace them. Default 5 min.
     */
    refreshInterval?: number;
}

/**
 * What ValueCache needs from History to catch up: for each leaf it can
 * look up (`known`), the last value at or after `start`, if any.
 */
export interface CatchUpSource {
    lastValuesSince(leafIds: string[], start: string): Promise<{
        known: Set<string>;
        values: Map<string, { value: unknown; quality: string; timestamp: string }>;
    }>;
}

/** The meta key for the time (ms since the epoch) up to which every
 * UNS message received is reflected in last_value. */
const CURRENT_UNTIL = "values_current_until";

/** The window History reads current values over. */
const MAX_GAP_LIMIT = 30 * 24 * 3600_000;

/** A catch-up result too large to apply; the values are cleared. */
class CatchUpTooLarge extends Error {}

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
    /** Leaf ids under a composition, null between pages (ObjectTree). */
    iterateDescendantLeafIds?(elementId: string, maxDepth?: number): Generator<string | null>;
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
    /** When the oldest message not yet written for this leaf came. */
    at: number;
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

/** Most values held back while the WAL checkpoint catches up, in
 * batches: about 10 MB at 50 batches of 1,000. */
const DEFER_BATCHES = 50;

/** Most unwritten values kept while writes fail, in batches. */
const MAX_BACKLOG_BATCHES = 10;

/** After a failed write, background flushes wait this long before the
 * next try, doubling up to WRITE_RETRY_MAX. Failures are logged at most
 * once per WRITE_RETRY_MAX. */
const WRITE_RETRY_MIN = 5_000;
const WRITE_RETRY_MAX = 60_000;

/* The first parameter is the trust boundary (ValueCache.trustAbove): a
 * new row, or one replacing an untrusted row, gets a seq above it and
 * above every row, so it is trusted. SQLite would otherwise reuse the
 * seq of a deleted last row, which can be below the boundary. */
const NEXT_SEQ = "max(coalesce((select max(seq) from last_value), 0), ?) + 1";

const UPSERT = (source: string, guard: string) => `
    insert into last_value (seq, element_id, anchor, device_uuid, value_json, timestamp, quality, source)
    values (${NEXT_SEQ}, ?, ?, ?, ?, ?, ?, '${source}')
    on conflict (element_id) do update set
        seq = case when last_value.seq <= ? then excluded.seq else last_value.seq end,
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
    private continuing = false;
    /** Write backoff: no background write before this time (Date.now). */
    private retryNotBefore = 0;
    private retryDelay = 0;
    private lastErrorLog = 0;
    private errorsSinceLog = 0;
    private droppedSinceLog = 0;

    /** Rows with seq up to this are not trusted: they were stored
     * before a restart or reconnect and the catch-up has not yet
     * checked them. 0 when every row is trusted. */
    private trustAbove = 0;
    /** Bumped to abandon a running catch-up. */
    private catchUpGen = 0;
    private catchUpSource: CatchUpSource | null = null;
    private catchUpMargin: number;
    private catchUpMaxGap: number;
    private catchUpMaxRows: number;
    private catchUpRetryDelays: number[];
    private currentInterval: number;
    private currentTimer: ReturnType<typeof setInterval> | null = null;
    private refreshInterval: number;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private refreshing = false;
    /** InfluxDB points before this time (ms, less the margin) are
     * reflected in the values kept from InfluxDB. */
    private refreshFrom = 0;
    /** MQTT is connected. */
    private mqttUp = false;
    /** When the last MQTT packet (a message or a ping response) came.
     * A dead link is noticed only by the keepalive, up to 90 s later;
     * values are current only up to the last packet. */
    private lastRx = 0;
    /** The arrival of the oldest UNS value dropped unwritten (see
     * trimBacklog), or Infinity. Values are not current past it until
     * a catch-up or a clear. */
    private lostAt = Infinity;
    /** A clear failed: the rows it should have removed are hidden, and
     * the clear is tried again every currentInterval. */
    private needsClear = false;
    /** Connected and caught up: every UNS message is being seen, so the
     * stored values can be recorded as current. */
    private live = false;

    constructor(opts: ValueCacheOpts) {
        this.objectTree = opts.objectTree;
        this.staleThreshold = opts.staleThreshold;
        this.store = opts.store ?? new I3xStore();
        this.flushInterval = opts.flushInterval ?? 250;
        /* Each flush is one synchronous write; keep it short. */
        this.flushMaxRows = opts.flushMaxRows ?? 1000;
        this.catchUpMargin = opts.catchUpMargin ?? 60_000;
        this.catchUpMaxGap = Math.min(opts.catchUpMaxGap ?? 24 * 3600_000, MAX_GAP_LIMIT);
        this.catchUpMaxRows = opts.catchUpMaxRows ?? 1_000_000;
        this.catchUpRetryDelays = opts.catchUpRetryDelays ?? [5_000, 15_000, 45_000];
        this.currentInterval = opts.currentInterval ?? 5_000;
        this.refreshInterval = opts.refreshInterval ?? 300_000;
        /* A failed group commit loses the values written in its batch,
         * so a stored value may no longer be the last one. Forget them
         * all, as after an MQTT reconnect. */
        /* With group commit a write error usually surfaces here, at the
         * commit, not in writeChunk, so back off here too. */
        this.store.onCommitFailure(() => {
            this.backOff();
            this.safeClear("after a failed commit");
        });
    }

    /**
     * Subscribe to the UNS. With `catchUp` (History), values stored by
     * an earlier run are kept and caught up from InfluxDB once MQTT is
     * connected; without it they are cleared, as they always were.
     */
    async init(fplus: any, catchUp?: CatchUpSource): Promise<this> {
        this.log = fplus.debug.bound("value-cache");
        this.catchUpSource = catchUp ?? null;

        /* Values stored by an earlier run may have changed while it was
         * down; we did not see those UNS messages. Stop trusting them
         * until the catch-up has checked them, or start empty. */
        this.distrust("at start");

        this.log("requesting MQTT client from ServiceClient");
        const mqtt = await fplus.mqtt_client();
        this.log("MQTT client obtained, subscribing to UNS/v1/#");
        mqtt.subscribe("UNS/v1/#");
        mqtt.on("message", (topic: string, payload: Buffer, packet: any) => {
            this.lastRx = Date.now();
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
            this.mqttUp = true;
            this.lastRx = Date.now();
            /* Messages sent while we were disconnected are lost, so a
             * stored value may no longer be the last one. */
            if (connected) this.distrust("after an MQTT reconnect");
            connected = true;
            /* The subscription is in place (mqtt.js renews it on each
             * connect), so every message from now on is seen: start the
             * catch-up, which reads InfluxDB only after the margin. */
            if (this.needsClear) return;    // the retry goes live
            if (this.trustAbove > 0) this.startCatchUp();
            else this.goLive();
        });
        mqtt.on("packetreceive", () => { this.lastRx = Date.now(); });
        mqtt.on("error", (err: any) => {
            console.error("ValueCache: MQTT error:", err);
        });
        mqtt.on("close", () => {
            this.log("MQTT connection closed");
            /* Fix the time the values were last current: the last
             * packet received, not now. */
            if (this.live) this.recordCurrent();
            this.mqttUp = false;
            this.live = false;
        });
        if (!this.currentTimer) {
            this.currentTimer = setInterval(() => {
                if (this.needsClear) this.safeClear("on a retry");
                else if (this.live) this.recordCurrent();
            }, this.currentInterval);
            this.currentTimer.unref?.();
        }
        if (!this.refreshTimer && this.catchUpSource) {
            this.refreshTimer = setInterval(() => {
                if (this.live && !this.refreshing) this.refresh();
            }, this.refreshInterval);
            this.refreshTimer.unref?.();
        }
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
            at: this.pending.get(elementId)?.at ?? Date.now(),
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

        if (this.pending.size >= this.flushMaxRows) this.flushInBackground();
        else this.scheduleFlush();
    }

    /**
     * A flush nobody is waiting for. While the WAL checkpoint is behind
     * (store.walBehind), hold the values a little longer rather than
     * add to it, up to the backlog cap.
     */
    private flushInBackground(): void {
        const wait = this.retryNotBefore - Date.now();
        if (wait > 0) {
            /* The database failed recently; do not try every message. */
            this.trimBacklog();
            this.scheduleFlush(wait);
            return;
        }
        if (this.store.walBehind() && this.pending.size < DEFER_BATCHES * this.flushMaxRows) {
            this.scheduleFlush();
            return;
        }
        /* One chunk per turn of the event loop. */
        if (!this.writeChunk(this.flushMaxRows)) return;
        if (this.pending.size > 0 && !this.continuing) {
            this.continuing = true;
            setImmediate(() => {
                this.continuing = false;
                this.flushInBackground();
            });
        }
    }

    private scheduleFlush(delay: number = this.flushInterval): void {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flushInBackground();
        }, delay);
        this.timer.unref?.();
    }

    /**
     * Write every waiting UNS value now, synchronously. For callers that
     * need them stored at once (small reads, tests). Returns false if a
     * write failed; then the values are kept for the next try.
     */
    flush(): boolean {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        return this.writeChunk(Infinity);
    }

    /** Write waiting values in chunks, pausing for the event loop. */
    private async flushSliced(): Promise<void> {
        const slicer = new Slicer();
        while (this.pending.size > 0) {
            if (!this.writeChunk(this.flushMaxRows)) return;
            await slicer.maybe();
        }
    }

    /**
     * Write up to `max` of the oldest waiting values, in one transaction.
     * If the write fails (a full disk, an I/O error) they go back in the
     * queue, behind any newer value for the same metric, and are tried
     * again later; this logs and returns false rather than throwing.
     */
    private writeChunk(max: number): boolean {
        if (this.pending.size === 0) return true;
        let batch: Map<string, Pending>;
        if (this.pending.size <= max) {
            batch = this.pending;
            this.pending = new Map();
        } else {
            batch = new Map();
            for (const [id, p] of this.pending) {
                if (batch.size >= max) break;
                batch.set(id, p);
            }
            for (const id of batch.keys()) this.pending.delete(id);
        }
        try {
            const st = this.store.prepare(UPSERT("uns", ""));
            const b = this.trustAbove;
            this.store.transaction(() => {
                for (const [id, p] of batch)
                    st.run(b, id, p.anchor, p.device, p.valueJson, p.timestamp, p.quality, b);
            });
            this.retryDelay = 0;
            this.retryNotBefore = 0;
            return true;
        } catch (err) {
            this.backOff();
            this.errorsSinceLog++;
            if (this.logDue()) {
                console.error("ValueCache: writing %d values failed (%d failures since the last report), next try in %d s:",
                    batch.size, this.errorsSinceLog, this.retryDelay / 1000, err);
                this.errorsSinceLog = 0;
            }
            /* Newer values win over the ones put back. */
            for (const [id, p] of this.pending) batch.set(id, p);
            this.pending = batch;
            this.trimBacklog();
            this.scheduleFlush(this.retryDelay);
            return false;
        }
    }

    /** Do not hold an unbounded backlog while the database is broken:
     * keep the newest entries. */
    private trimBacklog(): void {
        const limit = MAX_BACKLOG_BATCHES * this.flushMaxRows;
        if (this.pending.size <= limit) return;
        let drop = this.pending.size - limit;
        this.droppedSinceLog += drop;
        for (const [id, p] of this.pending) {
            if (drop-- <= 0) break;
            /* A later catch-up must still cover this value. */
            this.lostAt = Math.min(this.lostAt, p.at);
            this.pending.delete(id);
        }
        if (this.logDue()) {
            console.error("ValueCache: dropped the %d oldest unwritten values", this.droppedSinceLog);
            this.droppedSinceLog = 0;
        }
    }

    /** Wait longer before the next background write: 5 s, doubling to 60 s. */
    private backOff(): void {
        this.retryDelay = Math.min(this.retryDelay * 2 || WRITE_RETRY_MIN, WRITE_RETRY_MAX);
        this.retryNotBefore = Date.now() + this.retryDelay;
    }

    /** True at most once per WRITE_RETRY_MAX, for write error logs. */
    private logDue(): boolean {
        const now = Date.now();
        if (now - this.lastErrorLog < WRITE_RETRY_MAX) return false;
        this.lastErrorLog = now;
        return true;
    }

    /**
     * Keep values History read from InfluxDB. A stored value with a
     * later timestamp (a UNS message that arrived during the query)
     * is not replaced. An untrusted value is replaced whatever its
     * timestamp, as if it had been cleared.
     */
    recordInfluxValues(values: InfluxValue[]): void {
        if (values.length === 0) return;
        const st = this.store.prepare(UPSERT("influx",
            "where last_value.seq <= ? or last_value.source = 'empty' or julianday(excluded.timestamp) > julianday(last_value.timestamp)"));
        const b = this.trustAbove;
        this.store.transaction(() => {
            for (const v of values) {
                st.run(b, v.elementId, v.anchor ?? v.device, v.device,
                    toJson(v.value), v.timestamp ?? null, v.quality, b, b);
            }
        });
    }

    /**
     * Record leaves InfluxDB had no value for, so a composition whose
     * every leaf has been asked about counts as complete (see
     * compositionComplete) and is answered from here next time. A
     * marker never replaces a trusted value, and any value replaces it.
     */
    recordInfluxEmpty(leaves: Array<{ elementId: string; device: string | null; anchor: string | null }>): void {
        if (leaves.length === 0) return;
        const st = this.store.prepare(`
            insert into last_value (seq, element_id, anchor, device_uuid, value_json, timestamp, quality, source)
            values (${NEXT_SEQ}, ?, ?, ?, null, null, 'Bad', 'empty')
            on conflict (element_id) do update set
                seq = excluded.seq, anchor = excluded.anchor, device_uuid = excluded.device_uuid,
                value_json = null, timestamp = null, quality = 'Bad', source = 'empty'
            where last_value.seq <= ?`);
        const b = this.trustAbove;
        this.store.transaction(() => {
            for (const l of leaves) st.run(b, l.elementId, l.anchor ?? l.device, l.device, b);
        });
    }

    /** Drop the values of a device that has left the tree. */
    removeDevice(uuid: string): void {
        for (const [id, p] of this.pending) {
            if (p.device === uuid) this.pending.delete(id);
        }
        this.store.prepare("delete from last_value where device_uuid = ?").run(uuid);
    }

    /**
     * Drop the values and markers kept from InfluxDB for a device that
     * no longer publishes to UNS (History keeps none for such a device):
     * no UNS message would replace them, so they would be served as
     * current for ever. Its UNS values stay.
     */
    removeInfluxValues(uuid: string): void {
        this.store.prepare("delete from last_value where device_uuid = ? and source != 'uns'").run(uuid);
    }

    /** clear(), logging a failure instead of throwing: it runs at start
     * and from an MQTT event handler, where a throw would end the
     * process. Stored values then stay until the next clear. */
    private safeClear(when: string): void {
        try {
            this.clear();
        } catch (err) {
            console.error(`ValueCache: clearing values ${when} failed:`, err);
            /* Do not serve, or record as current, rows that should have
             * gone: hide them, as a catch-up would, and try again. */
            this.needsClear = true;
            this.catchUpGen++;
            this.live = false;
            try {
                this.trustAbove = (this.store.prepare("select coalesce(max(seq), 0) n from last_value").get() as any).n;
            } catch { /* still trying to clear */ }
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

    /** Forget every value. Ends a catch-up: there is nothing left to
     * check. */
    clear(): void {
        this.pending.clear();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.store.prepare("delete from last_value").run();
        this.refreshFrom = Date.now();
        this.lostAt = Infinity;
        this.needsClear = false;
        if (this.trustAbove > 0 || !this.live) {
            this.catchUpGen++;
            this.trustAbove = 0;
            if (this.mqttUp) this.goLive();
        }
    }

    /** Number of stored values a read can see, for tests and
     * diagnostics. */
    size(): number {
        this.flush();
        return (this.store.prepare("select count(*) n from last_value where source != 'empty' and seq > ?")
            .get(this.trustAbove) as any).n;
    }

    /** True while stored values wait for a catch-up. */
    catchingUp(): boolean {
        return this.trustAbove > 0;
    }

    /* ---- Catching up after a restart or reconnect ---- */

    /**
     * Record that every UNS message received so far is in last_value,
     * or will be: the time the oldest unwritten one came, or the last
     * packet received (a link can be dead before we notice), or the
     * oldest value dropped unwritten, whichever is earliest. The
     * write joins the current group commit, so it is durable with the
     * values before it. Only while live; a catch-up in progress must
     * not move it, or a crash before the end would skip the gap.
     */
    private recordCurrent(): void {
        let at = Math.min(Date.now(), this.lastRx, this.lostAt);
        for (const p of this.pending.values()) { at = Math.min(at, p.at); break; }
        try {
            this.store.setMeta(CURRENT_UNTIL, String(at));
        } catch (err) {
            if (this.logDue()) console.error("ValueCache: recording the time values were current failed:", err);
        }
    }

    private goLive(): void {
        if (this.live || this.needsClear) return;
        this.live = true;
        if (!this.refreshFrom) this.refreshFrom = Date.now();
        this.recordCurrent();
    }

    /**
     * After a restart or a reconnect: stop serving the stored values
     * until a catch-up has checked them, or clear them when a catch-up
     * cannot be trusted to find every change. Queued values are written
     * first, so they are checked too, as clearing would have dropped
     * them.
     */
    private distrust(when: string): void {
        this.catchUpGen++;
        this.live = false;
        const why = this.catchUpUnsafe();
        if (why) {
            this.log("clearing values %s: %s", when, why);
            this.safeClear(when);
            return;
        }
        if (!this.flush()) {
            this.safeClear(when);
            return;
        }
        try {
            this.trustAbove = (this.store.prepare("select coalesce(max(seq), 0) n from last_value").get() as any).n;
        } catch (err) {
            console.error(`ValueCache: reading values ${when} failed:`, err);
            this.safeClear(when);
            return;
        }
        if (this.trustAbove > 0)
            this.log("values stored up to seq %d wait for a catch-up %s", this.trustAbove, when);
    }

    /** Why the stored values cannot be caught up, or null if they can. */
    private catchUpUnsafe(): string | null {
        if (!this.catchUpSource) return "no InfluxDB to catch up from";
        let until: number;
        try {
            until = Number(this.store.getMeta(CURRENT_UNTIL));
        } catch {
            return "cannot read when they were last current";
        }
        if (!Number.isFinite(until) || until <= 0) return "no record of when they were last current";
        const gap = Date.now() - until;
        if (gap < -this.catchUpMargin)
            return `last current ${Math.round(-gap / 1000)} s in the future; has the clock gone back?`;
        if (gap > this.catchUpMaxGap)
            return `last current ${Math.round(gap / 1000)} s ago, more than the ${Math.round(this.catchUpMaxGap / 1000)} s limit`;
        return null;
    }

    /**
     * Run the catch-up, after the margin: points published just before
     * we subscribed reach InfluxDB only when the historian next writes.
     * A failed query is tried again after each of catchUpRetryDelays;
     * after the last, or for a result too large, the values are
     * cleared. A newer distrust() or clear() abandons this one.
     */
    private startCatchUp(): void {
        const gen = this.catchUpGen;
        const wait = (ms: number) => new Promise<void>(r => {
            const t = setTimeout(r, ms);
            t.unref?.();
        });
        (async () => {
            await wait(this.catchUpMargin);
            if (gen !== this.catchUpGen) return;
            /* The gap has grown while we waited. */
            const why = this.catchUpUnsafe();
            if (why) {
                this.log("clearing values instead of catching up: %s", why);
                this.safeClear("before a catch-up");
                return;
            }
            const started = Date.now();
            try {
                const until = Number(this.store.getMeta(CURRENT_UNTIL));
                const counts = await this.catchUp(gen, wait, until, false);
                if (gen !== this.catchUpGen) return;
                this.trustAbove = 0;
                /* Not `started`: a value read from InfluxDB during the
                 * catch-up was trusted at once, and the historian may
                 * since have written an older gap point. The first
                 * refresh covers the whole gap again for those rows. */
                this.refreshFrom = until;
                this.lostAt = Infinity;
                this.log("caught up: %d values changed, %d dropped, of %d stored for %d devices, in %d ms",
                    counts.changed, counts.dropped, counts.checked, counts.devices, Date.now() - started);
                if (this.mqttUp) this.goLive();
            } catch (err) {
                if (gen !== this.catchUpGen) return;
                console.error("ValueCache: catch-up from InfluxDB failed after %d ms; clearing values instead:",
                    Date.now() - started, err instanceof CatchUpTooLarge ? err.message : err);
                this.safeClear("after a failed catch-up");
            }
        })();
    }

    /**
     * While connected, bring the values kept from InfluxDB, and the
     * "no data" markers, up to date with the points written since the
     * last refresh (less the margin). Their devices may not publish to
     * the UNS, so before catch-up replaced clearing, only a restart or
     * reconnect refreshed them; now nothing else would. A failure is
     * logged and the next refresh covers the same time again. After a
     * gap longer than the catch-up limit, or a result too large, those
     * rows are dropped and read again when next asked for.
     */
    private refresh(): void {
        const gen = this.catchUpGen;
        const from = this.refreshFrom;
        const started = Date.now();
        /* In slices of 500, found through last_value_kept_ix: one delete
         * of a million rows held the event loop for 10 to 23 s; slices
         * of 1,000 for at most 145 ms. */
        const dropAll = async (why: string) => {
            this.log("dropping values kept from InfluxDB: %s", why);
            const st = this.store.prepare(`delete from last_value where seq in
                (select seq from last_value where source != 'uns' limit ?)`);
            const slicer = new Slicer();
            try {
                while (Number(st.run(500).changes) > 0) await slicer.maybe();
                this.refreshFrom = started;
            } catch (err) {
                console.error("ValueCache: dropping values kept from InfluxDB failed:", err);
            }
        };
        this.refreshing = true;
        (async () => {
            try {
                if (started - from > this.catchUpMaxGap || started - from < -this.catchUpMargin) {
                    await dropAll(`last refreshed ${Math.round((started - from) / 1000)} s ago`);
                    return;
                }
                const counts = await this.catchUp(gen, async () => {}, from, true);
                if (gen !== this.catchUpGen) return;
                this.refreshFrom = started;
                const took = Date.now() - started;
                this.log("refreshed values kept from InfluxDB: %d changed, of %d for %d devices, in %d ms",
                    counts.changed, counts.checked, counts.devices, took);
                if (took > this.refreshInterval)
                    console.error("ValueCache: refreshing values kept from InfluxDB took %d s, longer than the %d s interval",
                        Math.round(took / 1000), Math.round(this.refreshInterval / 1000));
            } catch (err) {
                if (gen !== this.catchUpGen) return;
                if (err instanceof CatchUpTooLarge) await dropAll(err.message);
                else console.error("ValueCache: refreshing values kept from InfluxDB failed; trying again next time:", err);
            } finally {
                this.refreshing = false;
            }
        })();
    }

    /**
     * Bring the untrusted rows up to date: read from InfluxDB, for the
     * leaves they hold, the last point of every series written since
     * the values were last current (less the margin), and apply each as
     * a newer value. A leaf with no such point has not changed. A row
     * InfluxDB cannot vouch for (a leaf without MetricMeta, or with no
     * device) is dropped, as clearing would; a "no data" marker for one
     * stays, as InfluxDB can never have data for it.
     *
     * Works through the devices with untrusted rows a page at a time,
     * pausing for the event loop. Rows are only updated, never
     * inserted, so a device sync removes meanwhile stays gone. A newer
     * value written meanwhile (a UNS message) is kept, as
     * recordInfluxValues keeps it.
     *
     * With `refresh`, the same for the rows kept from InfluxDB and the
     * markers instead of the untrusted rows (see refresh), dropping
     * nothing and trying each query once.
     */
    private async catchUp(gen: number, wait: (ms: number) => Promise<void>, since: number, refresh: boolean):
            Promise<{ changed: number; dropped: number; checked: number; devices: number }> {
        const source = this.catchUpSource!;
        const b = this.trustAbove;
        const start = new Date(since - this.catchUpMargin).toISOString();
        if (!refresh)
            this.log("catching up values stored up to seq %d from InfluxDB points since %s", b, start);

        /* source != 'uns', not in ('influx', 'empty'): only that form
         * uses the partial index last_value_kept_ix. */
        const rowsWanted = refresh ? "source != 'uns'" : "seq <= ?";
        const wantArgs = refresh ? [] : [b];
        const retries = refresh ? [] : this.catchUpRetryDelays;
        const devicePage = this.store.prepare(`
            select distinct device_uuid d from last_value
            where device_uuid > ? and ${rowsWanted} order by device_uuid limit ?`);
        const leavesOf = this.store.prepare(
            `select element_id, source from last_value where device_uuid = ? and ${rowsWanted}`);
        const update = this.store.prepare(`
            update last_value set value_json = ?, timestamp = ?, quality = ?,
                source = case when source = 'uns' then 'uns' else 'influx' end
            where element_id = ? and (source = 'empty' or (seq <= ? and julianday(timestamp) is null)
                or julianday(?) > julianday(timestamp))`);
        const drop = this.store.prepare(
            "delete from last_value where element_id = ? and seq <= ? and source != 'empty'");

        const counts = { changed: 0, dropped: 0, checked: 0, devices: 0 };
        const slicer = new Slicer();
        const abandoned = () => gen !== this.catchUpGen;

        /* Read one batch of leaves from InfluxDB, retrying, and apply. */
        const apply = async (leaves: Array<{ id: string; source: string }>) => {
            let result: Awaited<ReturnType<CatchUpSource["lastValuesSince"]>>;
            for (let attempt = 0;; attempt++) {
                try {
                    result = await source.lastValuesSince(leaves.map(l => l.id), start);
                    break;
                } catch (err) {
                    if (abandoned() || attempt >= retries.length) throw err;
                    const delay = retries[attempt];
                    console.error("ValueCache: catch-up query failed, trying again in %d s:", delay / 1000, err);
                    await wait(delay);
                    if (abandoned()) throw err;
                }
            }
            if (abandoned()) return;
            for (let i = 0; i < leaves.length; i += this.flushMaxRows) {
                const part = leaves.slice(i, i + this.flushMaxRows);
                this.store.transaction(() => {
                    for (const { id, source: src } of part) {
                        const v = result.values.get(id);
                        if (v) {
                            counts.changed += Number(update.run(
                                toJson(v.value), v.timestamp ?? null, v.quality, id, b, v.timestamp ?? null).changes);
                        } else if (!refresh && !result.known.has(id) && src !== "empty") {
                            counts.dropped += Number(drop.run(id, b).changes);
                        }
                    }
                });
                /* Counts values that differ, not every series with a
                 * point in the window: at scale nearly all have one. */
                if (counts.changed > this.catchUpMaxRows)
                    throw new CatchUpTooLarge(`more than ${this.catchUpMaxRows} values changed`);
                await slicer.maybe();
                if (abandoned()) return;
            }
        };

        let batch: Array<{ id: string; source: string }> = [];
        for (let after = "";;) {
            const devices = (devicePage.all(after, ...wantArgs, 256) as Array<{ d: string }>).map(r => r.d);
            for (const d of devices) {
                for (const r of leavesOf.all(d, ...wantArgs) as Array<{ element_id: string; source: string }>)
                    batch.push({ id: r.element_id, source: r.source });
                counts.devices++;
                if (batch.length >= 5_000) {
                    counts.checked += batch.length;
                    await apply(batch);
                    batch = [];
                }
                if (abandoned()) return counts;
                await slicer.maybe();
            }
            if (devices.length < 256) break;
            after = devices[devices.length - 1];
        }
        if (batch.length) {
            counts.checked += batch.length;
            await apply(batch);
        }
        if (abandoned() || refresh) return counts;
        /* Rows with no device: no InfluxDB series to check them by. */
        counts.dropped += Number(this.store.prepare(
            "delete from last_value where device_uuid is null and seq <= ? and source != 'empty'").run(b).changes);
        return counts;
    }

    /* ---- Query methods ---- */

    /** True when the tree lives in our database, so a composition's
     * components can be read with one query. A mock tree in unit tests
     * is walked through its own interface instead. */
    private treeInStore(): boolean {
        return (this.objectTree as any).store === this.store;
    }

    /**
     * Has every leaf under `rootId` got a stored value or a marker that
     * InfluxDB had none? A queued value does not count: the walk reads
     * only stored rows, so a leaf whose only value is queued would be
     * left out of a composition judged complete. Only then can the stored
     * values stand for the composition: values kept from InfluxDB cover
     * only the leaves someone asked about, so a composition built from
     * some of them would look complete when it is not. A composition
     * read from InfluxDB records every leaf it covered, values and
     * markers, so the next read of it is answered from here.
     */
    private *missingLeaves(rootId: string): Generator<boolean | null> {
        const has = this.store.prepare("select 1 from last_value where element_id = ? and seq > ?");
        if (!this.objectTree.iterateDescendantLeafIds) { yield true; return; }
        for (const leaf of this.objectTree.iterateDescendantLeafIds(rootId, 0)) {
            if (leaf === null) { yield null; continue; }
            if (!has.get(leaf, this.trustAbove)) { yield true; return; }
        }
    }

    private async compositionComplete(rootId: string): Promise<boolean> {
        const slicer = new Slicer();
        for (const step of this.missingLeaves(rootId)) {
            if (step) return false;
            await slicer.maybe();
        }
        return true;
    }

    private compositionCompleteSync(rootId: string): boolean {
        for (const step of this.missingLeaves(rootId)) if (step) return false;
        return true;
    }

    /**
     * As getValue, but a composition's components are not built: they
     * are read, in the same order, as `components()` is iterated. The
     * head (whether there is a value at all, and its latest timestamp)
     * comes from a first pass over the same walk. Both passes run in
     * small steps with pauses for the event loop, so a composition with
     * millions of components does not stall other work. Each pass reads
     * its own snapshot, so a value written in between can make the
     * head differ slightly from the components. `maxDepth` limits the
     * walk as it does for InfluxDB reads: 1 is the direct leaves only,
     * 0 is the whole subtree.
     */
    async getValueLazy(elementId: string, maxDepth: number = 0): Promise<LazyValue | null> {
        if (!this.treeInStore()) return lazyFromValue(this.getValue(elementId));

        /* A leaf value still queued is the newest. */
        const queued = this.pending.get(elementId);
        if (queued) {
            return { head: { elementId, isComposition: false, ...toVqt({
                element_id: elementId, value_json: queued.valueJson,
                quality: queued.quality, timestamp: queued.timestamp,
            }) } };
        }
        const row = this.store.prepare(
            "select element_id, value_json, quality, timestamp from last_value where element_id = ? and source != 'empty' and seq > ?",
        ).get(elementId, this.trustAbove) as unknown as ValueRow | undefined;
        if (row) return { head: { elementId, isComposition: false, ...toVqt(row) } };

        const obj = this.objectTree.getObject(elementId);
        if (!obj?.isComposition) return null;

        /* The walk reads the database, so store what is queued, a chunk
         * at a time. */
        await this.flushSliced();
        /* Complete: every leaf has a value or an InfluxDB "no data"
         * marker, so all stored values stand for the composition.
         * Otherwise only UNS values, as before values were kept from
         * InfluxDB; with none, the caller reads InfluxDB. A failed write
         * leaves values queued, and the stored rows may then be missing
         * some of them, so the composition is not complete. */
        /* Both passes see the same rows as trusted, even if a catch-up
         * starts or ends in between. */
        const trust = this.trustAbove;
        const all = this.pending.size === 0 && await this.compositionComplete(elementId);

        /* The old value took the latest timestamp, by string order,
         * starting from "". */
        let n = 0;
        let latest = "";
        const slicer = new Slicer();
        for (const step of this.walkComponents(elementId, all, trust, maxDepth)) {
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
            components: () => this.walkComponents(elementId, all, trust, maxDepth),
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
     * With `maxDepth` above 0 compositions deeper than that are not
     * entered, as in ObjectTree.iterateDescendantLeafIds.
     */
    private *walkComponents(rootId: string, all: boolean = false,
            trustAbove: number = this.trustAbove, maxDepth: number = 0): Generator<ComponentStep> {
        /* Callers store queued values first (flush or flushSliced). */
        this.store.commit();
        const reader = this.store.openReader();
        try {
            const db: any = reader ?? this.store.db;
            if (reader) reader.exec("begin");
            const values = db.prepare(`
                select element_id, value_json, quality, timestamp from last_value
                where anchor = ? and ${all ? "source != 'empty'" : "source = 'uns'"} and seq > ? order by seq`);
            const children = db.prepare(`
                select o.seq, o.element_id,
                    o.is_composition or exists (select 1 from object c where c.parent_id = o.element_id) walk
                from object o where o.parent_id = ? and o.seq > ? order by o.seq limit ?`);

            interface Level { id: string; page: any[]; i: number; after: number; done: boolean }
            const visit = function* (id: string): Generator<ComponentStep> {
                /* all(): a few dozen rows at most, and no statement left
                 * open while the consumer pauses. */
                for (const r of values.all(id, trustAbove) as ValueRow[])
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
                if (maxDepth > 0 && stack.length >= maxDepth) continue;
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
            const flushed = this.flush();
            const row = this.store.prepare(
                "select element_id, value_json, quality, timestamp from last_value where element_id = ? and source != 'empty' and seq > ?",
            ).get(elementId, this.trustAbove) as unknown as ValueRow | undefined;
            if (row) return { elementId, isComposition: false, ...toVqt(row) };
            const obj = this.objectTree.getObject(elementId);
            if (!obj?.isComposition) return null;
            const all = flushed && this.compositionCompleteSync(elementId);
            const components: Record<string, I3xVqt> = {};
            let latest = "";
            for (const step of this.walkComponents(elementId, all)) {
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
            "select element_id, value_json, quality, timestamp from last_value where element_id = ? and source != 'empty' and seq > ?",
        ).get(elementId, this.trustAbove) as unknown as ValueRow | undefined;
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
        all: boolean = false,
    ): Record<string, I3xVqt> | null {
        const result: Record<string, I3xVqt> = {};

        // Collect direct leaf metrics cached under this elementId, in
        // the order they were first seen. Only UNS values: values kept
        // from InfluxDB cover only the leaves someone asked for, so a
        // composition built from them would look complete when it is
        // not. Without UNS data the caller falls back to InfluxDB for
        // the whole composition, as it did before values were kept.
        const direct = this.store.prepare(
            `select element_id, value_json, quality, timestamp from last_value where anchor = ? and ${all ? "source != 'empty'" : "source = 'uns'"} and seq > ? order by seq`,
        ).all(elementId, this.trustAbove) as unknown as ValueRow[];
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
                    all,
                );
                if (childResult) {
                    Object.assign(result, childResult);
                }
            }
        }

        return Object.keys(result).length > 0 ? result : null;
    }
}
