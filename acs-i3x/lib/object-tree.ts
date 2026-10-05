/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ObjectTree — Constructs and maintains the i3X object graph from
 * Factory+ services (ConfigDB + Directory).
 *
 * All Explore endpoints serve data from this tree. The tree lives in
 * the SQLite database (see store.ts), not on the JS heap: each method
 * here is a few synchronous SQL statements. Mutations run in one
 * transaction each, so readers between event-loop turns see either
 * the state before a change or the state after it, never half of it.
 *
 * The ConfigDB sync engine (sync.ts) calls the per-device mutations;
 * the ValueCache calls addCompositionFromUns for UNS messages.
 */

import { v5 as uuidv5 } from "uuid";

import type {
    I3xNamespace,
    I3xObjectType,
    I3xObject,
    I3xRelationshipType,
} from "./types/i3x.js";

import {
    RelType,
    HIERARCHY_SCHEMA_UUID,
} from "./constants.js";
import { I3xStore } from "./store.js";

// Namespace for generating synthetic UUIDs for metric path segments
// that don't have their own Instance_UUID.
const I3X_UUID_NAMESPACE = "11ad7b32-1d32-4c4a-b0c9-fa049208939a";
import {
    toI3xNamespace,
    toI3xObjectType,
    toI3xObject,
    toI3xRelationshipType,
} from "./mapping.js";

interface ObjectTreeOpts {
    fplus?: any;
    namespaceName: string;
    namespaceUri: string;
    /** The database to keep the tree in. Defaults to a new in-memory
     * database, which suits tests. */
    store?: I3xStore;
}

/**
 * Input to refreshFromSnapshot: the complete ConfigDB state the tree
 * should hold. Keys are the corresponding ConfigDB object UUIDs.
 * `devInfo`/`info`/`schema` are config bodies (or null when the entry
 * is missing or inaccessible).
 */
export interface PipelineSnapshot {
    devices: Map<string, { devInfo: any; info: any }>;
    schemas: Map<string, { schema: any; info: any }>;
}

/** InfluxDB query metadata for a leaf metric object. */
export interface MetricMeta {
    topLevelInstanceUuid: string;
    metricPath: string;      // e.g. "Phases/1"
    metricName: string;      // e.g. "True_RMS_Current"
    sparkplugType: string;   // e.g. "FloatLE"
    typeSuffix: string;      // e.g. "d"
}

/**
 * Origin of a node in the tree.
 *  - "config" : derived from ConfigDB (DeviceInformation originMap,
 *               ISA-95 hierarchy, device-level objects).
 *  - "uns"    : discovered at runtime from a UNS MQTT message and
 *               not (yet) represented in any DeviceInformation config.
 *
 * Stored in its own column so the API/wire shape I3xObject stays clean.
 */
export type NodeSource = "config" | "uns";

/** Filters for getObjects and iterateObjects. */
export interface ObjectFilter {
    typeElementId?: string;
    root?: boolean;
    includeMetadata?: boolean;
}

/**
 * One UNS-source descendant captured before a device subtree is rebuilt,
 * so replaceDeviceSubtree can re-graft it under its original parent if
 * that parent survives in the new tree.
 */
interface UnsCapture {
    id: string;
    obj: I3xObject;
    parentId: string;
    meta: MetricMeta | undefined;
}

/** A row of the object table, as SQLite returns it. */
interface ObjectRow {
    element_id: string;
    display_name: string;
    type_element_id: string;
    parent_id: string | null;
    is_composition: number;
}

interface SubtreeRow extends ObjectRow {
    seq: number;
    source: NodeSource;
}

const OBJECT_COLS = "element_id, display_name, type_element_id, parent_id, is_composition";

function toObject(r: ObjectRow): I3xObject {
    return toI3xObject(r.element_id, r.display_name, r.type_element_id,
        r.parent_id, r.is_composition === 1);
}

function toMeta(r: any): MetricMeta {
    return {
        topLevelInstanceUuid: r.top_level,
        metricPath: r.metric_path,
        metricName: r.metric_name,
        sparkplugType: r.sparkplug_type,
        typeSuffix: r.type_suffix,
    };
}

/** Map Sparkplug_Type to InfluxDB measurement type suffix. */
function sparkplugTypeToSuffix(spType: string): string {
    const t = spType.replace(/(LE|BE)$/i, "");
    switch (t) {
        case "Float": case "Double": return "d";
        case "Int8": case "Int16": case "Int32": case "Int64": return "i";
        case "UInt8": case "UInt16": case "UInt32": case "UInt64": return "u";
        case "Boolean": return "b";
        default: return "s";
    }
}

/* The ids in the subtree rooted at ?1, the root included. UNION, not
 * UNION ALL, so a parent cycle cannot recurse for ever. */
const SUBTREE = `
    with recursive sub(id) as (
        select ?
        union
        select o.element_id from object o join sub on o.parent_id = sub.id
    )`;

export class ObjectTree {
    private namespaceName: string;
    private namespaceUri: string;
    private log: (msg: string, ...args: any[]) => void;
    readonly store: I3xStore;

    private ready: boolean = false;
    private namespace: I3xNamespace | null = null;
    private relationshipTypes: Map<string, I3xRelationshipType> = new Map();
    private listeners: Set<() => void> = new Set();
    /** Counts object writes, so a caller can tell whether it changed
     * anything. */
    private writes: number = 0;
    /* Bumped by every write to the object table; see revision(). Every
     * statement that inserts, updates or deletes an object row must
     * bump it, or GET /objects can answer 304 for a changed tree. */
    private objectRev: number = 0;
    /* Distinguishes this process's revisions from an earlier one's. */
    private readonly epoch: string = Date.now().toString(36);
    private isa95IdCache: Map<string, string[]> = new Map();

    constructor(opts: ObjectTreeOpts) {
        this.namespaceName = opts.namespaceName;
        this.namespaceUri = opts.namespaceUri;
        this.log = opts.fplus?.debug?.bound("object-tree") ?? (() => {});
        this.store = opts.store ?? new I3xStore();
        this.buildNamespace();
        this.buildRelationshipTypes();
    }

    /**
     * Set up the namespace and relationship types. This no longer loads
     * devices: the ConfigDB sync engine (sync.ts) fills the tree and
     * marks it ready with setReady().
     */
    async init(): Promise<this> {
        this.log("building namespace and relationship types");
        this.buildNamespace();
        this.buildRelationshipTypes();
        return this;
    }

    /** Called by the sync engine once the tree reflects ConfigDB. */
    setReady(ready: boolean = true): void {
        this.ready = ready;
    }

    isReady(): boolean {
        return this.ready;
    }

    /**
     * A token that changes whenever any object changes: added,
     * removed, renamed or moved. GET /objects builds its ETag from it,
     * so a client can revalidate the whole listing without the server
     * reading the tree. Values are not objects and don't change it.
     */
    revision(): string {
        return `${this.epoch}.${this.objectRev}`;
    }

    /**
     * Call `listener` after every change to the tree. The RAG index
     * uses this to know it must rebuild. Listeners must be cheap: they
     * run on the UNS message path.
     */
    onChange(listener: () => void): void {
        this.listeners.add(listener);
    }

    private changed(): void {
        for (const l of this.listeners) {
            try {
                l();
            } catch (err) {
                console.error("ObjectTree: change listener threw:", err);
            }
        }
    }

    /**
     * Make the tree hold exactly the given ConfigDB state. Devices not
     * in `input` are removed; every device in it is rebuilt with
     * replaceDeviceSubtree semantics, so UNS-discovered nodes survive
     * while their parent does. Object types become exactly
     * `input.schemas`. UNS nodes left without a parent, and ISA-95
     * levels left without children, are dropped, as a rebuild from
     * scratch would. One transaction, so readers see the old or the
     * new tree.
     */
    refreshFromSnapshot(input: PipelineSnapshot): void {
        this.store.transaction(() => {
            for (const uuid of this.getDeviceUuids()) {
                if (!input.devices.has(uuid)) this.removeDeviceTx(uuid);
            }
            for (const [uuid, { devInfo, info }] of input.devices) {
                this.replaceDeviceTx(uuid, devInfo, info);
            }
            for (const t of this.objectTypeIds()) {
                if (!input.schemas.has(t)) this.removeObjectTypeTx(t);
            }
            for (const [schemaUuid, { schema, info }] of input.schemas) {
                this.putObjectType(schemaUuid, schema, info);
            }
            this.dropOrphans();
        });
        this.changed();
    }

    /**
     * Drop UNS nodes whose parent is gone, and ISA-95 levels with no
     * children, repeatedly, until nothing more goes.
     */
    private dropOrphans(): void {
        const s = this.store;
        for (;;) {
            this.objectRev++;
            const a = s.prepare(`
                delete from object
                where source = 'uns' and parent_id is not null
                    and parent_id not in (select element_id from object)
            `).run().changes;
            const b = s.prepare(`
                delete from object
                where type_element_id = 'isa95-level'
                    and not exists (select 1 from object c where c.parent_id = object.element_id)
            `).run().changes;
            if (!a && !b) break;
        }
        s.prepare(`
            delete from metric_meta
            where element_id not in (select element_id from object)
        `).run();
    }

    /** Test-facing inspector for a node's origin. */
    getNodeSource(elementId: string): NodeSource | undefined {
        const r = this.store.prepare("select source from object where element_id = ?")
            .get(elementId) as any;
        return r?.source;
    }

    /* ---- Synchronous per-device / per-schema mutations ----
     *
     * Used by the sync engine (lib/sync.ts) to apply one ConfigDB change
     * at a time. Each runs in one transaction.
     */

    /**
     * Add a device and its full subtree (including ISA-95 ancestors and
     * metric tree from the originMap).
     */
    addDevice(uuid: string, devInfo: any, info: any): void {
        this.store.transaction(() => this.buildDevice(uuid, devInfo, info));
        this.changed();
    }

    /**
     * Remove a device, its entire descendant subtree (config and UNS
     * alike), and any ISA-95 ancestor that becomes childless as a
     * result.
     */
    removeDevice(uuid: string): void {
        this.store.transaction(() => this.removeDeviceTx(uuid));
        this.changed();
    }

    private removeDeviceTx(uuid: string): void {
        this.store.prepare("delete from device_schema where device_uuid = ?").run(uuid);
        const device = this.getObject(uuid);
        if (!device) return;

        const ancestors = this.collectIsa95Ancestors(device);
        this.removeSubtree(uuid);
        this.cleanupOrphanAncestors(ancestors);
    }

    /**
     * Replace a device's config-source subtree from a new DeviceInformation
     * config, preserving UNS-discovered descendants whose parents survive
     * the rebuild. The device's elementId is stable (its ConfigDB UUID).
     */
    replaceDeviceSubtree(uuid: string, devInfo: any, info: any): void {
        this.store.transaction(() => this.replaceDeviceTx(uuid, devInfo, info));
        this.changed();
    }

    private replaceDeviceTx(uuid: string, devInfo: any, info: any): void {
        const oldDevice = this.getObject(uuid);
        if (!oldDevice) {
            this.buildDevice(uuid, devInfo, info);
            return;
        }

        const oldAncestors = this.collectIsa95Ancestors(oldDevice);
        const unsCaptures = this.captureUnsDescendants(uuid);

        this.store.prepare("delete from device_schema where device_uuid = ?").run(uuid);
        this.removeSubtree(uuid);
        this.cleanupOrphanAncestors(oldAncestors);

        this.buildDevice(uuid, devInfo, info);

        // Re-graft UNS descendants whose parent now exists in the new tree
        for (const cap of unsCaptures) {
            if (!this.hasObject(cap.parentId)) continue; // orphan
            if (this.hasObject(cap.id)) continue;         // superseded by config
            this.putObject(cap.obj, "uns");
            if (cap.meta) this.putMeta(cap.id, cap.meta);
        }
    }

    /** Update only the device's displayName. */
    updateDeviceName(uuid: string, displayName: string): void {
        this.objectRev++;
        const r = this.store.prepare("update object set display_name = ? where element_id = ?")
            .run(displayName, uuid);
        if (r.changes) this.changed();
    }

    /** Create or replace an ObjectType. */
    addObjectType(uuid: string, schema: any, info: any): void {
        this.putObjectType(uuid, schema, info);
        this.changed();
    }

    /** Update an ObjectType in place. Equivalent to addObjectType. */
    updateObjectType(uuid: string, schema: any, info: any): void {
        this.putObjectType(uuid, schema, info);
        this.changed();
    }

    /** Remove an ObjectType. Doesn't touch objects that reference it. */
    removeObjectType(uuid: string): void {
        this.removeObjectTypeTx(uuid);
        this.changed();
    }

    private removeObjectTypeTx(uuid: string): void {
        this.store.prepare("delete from object_type where element_id = ?").run(uuid);
    }

    /* ---- Device and schema bookkeeping for the sync engine ---- */

    /** The UUIDs of the devices in the tree. */
    getDeviceUuids(): string[] {
        return (this.store.prepare("select distinct device_uuid from device_schema").all() as any[])
            .map(r => r.device_uuid);
    }

    /** The schema UUIDs referenced by one device's DeviceInformation. */
    getDeviceSchemaUuids(uuid: string): string[] {
        return (this.store.prepare("select schema_uuid from device_schema where device_uuid = ?")
            .all(uuid) as any[]).map(r => r.schema_uuid);
    }

    /** Every schema UUID referenced by a device in the tree. */
    getReferencedSchemaUuids(): string[] {
        return (this.store.prepare("select distinct schema_uuid from device_schema").all() as any[])
            .map(r => r.schema_uuid);
    }

    /** True if any device in the tree references this schema. */
    isSchemaReferenced(uuid: string): boolean {
        return !!this.store.prepare("select 1 from device_schema where schema_uuid = ? limit 1")
            .get(uuid);
    }

    private objectTypeIds(): string[] {
        return (this.store.prepare("select element_id from object_type order by seq").all() as any[])
            .map(r => r.element_id);
    }

    /** Number of objects in the tree. */
    objectCount(): number {
        return (this.store.prepare("select count(*) n from object").get() as any).n;
    }

    /* ---- mutation helpers ---- */

    private hasObject(id: string): boolean {
        return !!this.store.prepare("select 1 from object where element_id = ?").get(id);
    }

    /**
     * Insert an object, or replace the one with the same elementId. A
     * replaced object keeps its place in the order, as Map.set does.
     */
    private putObject(obj: I3xObject, source: NodeSource): void {
        this.writes++;
        this.objectRev++;
        this.store.prepare(`
            insert into object (element_id, parent_id, type_element_id, display_name, is_composition, source)
            values (?, ?, ?, ?, ?, ?)
            on conflict (element_id) do update set
                parent_id = excluded.parent_id,
                type_element_id = excluded.type_element_id,
                display_name = excluded.display_name,
                is_composition = excluded.is_composition,
                source = excluded.source
        `).run(obj.elementId, obj.parentId, obj.typeElementId, obj.displayName,
            obj.isComposition ? 1 : 0, source);
    }

    private putMeta(id: string, m: MetricMeta): void {
        this.store.prepare(`
            insert or replace into metric_meta
                (element_id, top_level, metric_path, metric_name, sparkplug_type, type_suffix)
            values (?, ?, ?, ?, ?, ?)
        `).run(id, m.topLevelInstanceUuid, m.metricPath, m.metricName, m.sparkplugType, m.typeSuffix);
    }

    private putObjectType(schemaUuid: string, schema: any, info: any): void {
        const displayName = info?.name ?? schema?.title ?? schemaUuid;
        this.store.prepare(`
            insert into object_type (element_id, display_name, schema_json)
            values (?, ?, ?)
            on conflict (element_id) do update set
                display_name = excluded.display_name,
                schema_json = excluded.schema_json
        `).run(schemaUuid, String(displayName), JSON.stringify(schema ?? {}));
        this.log("buildObjectType: %s (%s)", schemaUuid, displayName);
    }

    /** Walk up the parent chain, collecting ISA-95 ancestor IDs. */
    private collectIsa95Ancestors(obj: I3xObject): string[] {
        const out: string[] = [];
        let parentId = obj.parentId;
        while (parentId !== null && parentId !== "/") {
            out.push(parentId);
            const parent = this.getObject(parentId);
            if (!parent) break;
            parentId = parent.parentId;
        }
        return out;
    }

    /**
     * Walk the given ISA-95 ancestor chain bottom-up, removing each node
     * that has no remaining children. Stops at the first node that still
     * has children (e.g. parent of another device).
     */
    private cleanupOrphanAncestors(ancestors: string[]): void {
        const s = this.store;
        for (const ancestorId of ancestors) {
            if (s.prepare("select 1 from object where parent_id = ? limit 1").get(ancestorId)) break;
            this.objectRev++;
            s.prepare("delete from object where element_id = ?").run(ancestorId);
        }
    }

    /** Remove a subtree, the root included. */
    private removeSubtree(id: string): void {
        const s = this.store;
        this.objectRev++;
        s.prepare(`${SUBTREE} delete from metric_meta where element_id in (select id from sub)`).run(id);
        s.prepare(`${SUBTREE} delete from object where element_id in (select id from sub)`).run(id);
    }

    /**
     * Pre-order walk of the subtree rooted at `rootId`, collecting every
     * UNS-source node with its original parent pointer. Pre-order means
     * parents appear before children in the result, which is what
     * replaceDeviceSubtree's re-graft loop relies on.
     */
    private captureUnsDescendants(rootId: string): UnsCapture[] {
        /* CROSS JOIN makes SQLite walk the subtree and look each id up,
         * rather than scan the whole object table against it (which it
         * chose when asked to order by seq). Sort here instead. */
        const rows = this.store.prepare(`${SUBTREE}
            select o.seq, o.source, ${OBJECT_COLS.split(", ").map(c => `o.${c}`).join(", ")}
            from sub cross join object o on o.element_id = sub.id
        `).all(rootId) as unknown as SubtreeRow[];
        if (!rows.some(r => r.source === "uns")) return [];
        rows.sort((a, b) => a.seq - b.seq);

        const children = new Map<string, SubtreeRow[]>();
        for (const r of rows) {
            if (r.parent_id === null) continue;
            let kids = children.get(r.parent_id);
            if (!kids) children.set(r.parent_id, kids = []);
            kids.push(r);
        }

        const out: UnsCapture[] = [];
        const seen = new Set<string>();
        const visit = (id: string) => {
            for (const child of children.get(id) ?? []) {
                if (seen.has(child.element_id)) continue;
                seen.add(child.element_id);
                if (child.source === "uns" && child.parent_id !== null) {
                    out.push({
                        id: child.element_id,
                        obj: toObject(child),
                        parentId: child.parent_id,
                        meta: this.getMetricMeta(child.element_id),
                    });
                }
                visit(child.element_id);
            }
        };
        visit(rootId);
        return out;
    }

    /* ---- Namespace ---- */

    getNamespaces(): I3xNamespace[] {
        return this.namespace ? [this.namespace] : [];
    }

    /* ---- Object Types ---- */

    getObjectTypes(namespaceUri?: string): I3xObjectType[] {
        // Every type is in this tree's namespace.
        if (namespaceUri !== undefined && namespaceUri !== this.namespaceUri) return [];
        return (this.store.prepare("select element_id, display_name, schema_json from object_type order by seq")
            .all() as any[]).map(r => this.toObjectType(r));
    }

    getObjectType(elementId: string): I3xObjectType | undefined {
        const r = this.store.prepare("select element_id, display_name, schema_json from object_type where element_id = ?")
            .get(elementId);
        return r ? this.toObjectType(r) : undefined;
    }

    private toObjectType(r: any): I3xObjectType {
        return toI3xObjectType(r.element_id, r.display_name, this.namespaceUri,
            r.element_id, JSON.parse(r.schema_json));
    }

    /* ---- Objects ---- */

    private objectWhere(opts?: ObjectFilter): { where: string; args: string[] } {
        const conds: string[] = [];
        const args: string[] = [];
        if (opts?.typeElementId !== undefined) {
            conds.push("type_element_id = ?");
            args.push(opts.typeElementId);
        }
        if (opts?.root) conds.push("parent_id = '/'");
        return { where: conds.join(" and "), args };
    }

    /**
     * All matching objects in one array. Use iterateObjects for the
     * whole tree: at 74k devices this array alone is hundreds of MB.
     */
    getObjects(opts?: ObjectFilter): I3xObject[] {
        const { where, args } = this.objectWhere(opts);
        const sql = `select ${OBJECT_COLS} from object ${where ? `where ${where}` : ""} order by seq`;
        return (this.store.prepare(sql).all(...args) as unknown as ObjectRow[]).map(toObject);
    }

    /**
     * The objects getObjects would return, in the same order, read a
     * page at a time. Each page is a separate query, so no statement
     * stays open while the caller waits (for example on a slow HTTP
     * client). Objects added or removed between pages may or may not
     * be included.
     */
    *iterateObjects(opts?: ObjectFilter, pageSize: number = 1000): Generator<I3xObject> {
        const { where, args } = this.objectWhere(opts);
        const sql = `select seq, ${OBJECT_COLS} from object
            where seq > ? ${where ? `and ${where}` : ""}
            order by seq limit ?`;
        let after = -1;
        for (;;) {
            const rows = this.store.prepare(sql).all(after, ...args, pageSize) as any[];
            for (const r of rows) yield toObject(r);
            if (rows.length < pageSize) return;
            after = rows[rows.length - 1].seq;
        }
    }

    getObject(elementId: string): I3xObject | undefined {
        const r = this.store.prepare(`select ${OBJECT_COLS} from object where element_id = ?`)
            .get(elementId) as unknown as ObjectRow | undefined;
        return r ? toObject(r) : undefined;
    }

    /* ---- Relationships ---- */

    getRelated(elementId: string, relationshipType?: string): I3xObject[] {
        const obj = this.getObject(elementId);
        if (!obj) return [];

        const result: I3xObject[] = [];

        if (relationshipType === undefined || relationshipType === RelType.HasParent) {
            if (obj.parentId !== null && obj.parentId !== "/") {
                const parent = this.getObject(obj.parentId);
                if (parent) result.push(parent);
            }
        }

        if (relationshipType === undefined || relationshipType === RelType.HasChildren) {
            result.push(...this.childObjects(elementId));
        }

        return result;
    }

    private childObjects(elementId: string): I3xObject[] {
        return (this.store.prepare(`select ${OBJECT_COLS} from object where parent_id = ? order by seq`)
            .all(elementId) as unknown as ObjectRow[]).map(toObject);
    }

    getRelationshipTypes(namespaceUri?: string): I3xRelationshipType[] {
        const all = Array.from(this.relationshipTypes.values());
        if (namespaceUri === undefined) return all;
        return all.filter(rt => rt.namespaceUri === namespaceUri);
    }

    getRelationshipType(elementId: string): I3xRelationshipType | undefined {
        return this.relationshipTypes.get(elementId);
    }

    getChildElementIds(elementId: string): string[] {
        return (this.store.prepare("select element_id from object where parent_id = ? order by seq")
            .all(elementId) as any[]).map(r => r.element_id);
    }

    /** Get InfluxDB query metadata for a leaf metric. */
    getMetricMeta(elementId: string): MetricMeta | undefined {
        const r = this.store.prepare("select * from metric_meta where element_id = ?").get(elementId);
        return r ? toMeta(r) : undefined;
    }

    /**
     * Collect all leaf metric elementIds that are descendants of the
     * given elementId (for composition value queries).
     */
    getDescendantLeafIds(elementId: string, maxDepth: number = 0, depth: number = 0): string[] {
        if (maxDepth > 0 && depth >= maxDepth) return [];
        const children = this.store.prepare(
            "select element_id, is_composition from object where parent_id = ? order by seq",
        ).all(elementId) as any[];
        const leaves: string[] = [];
        for (const child of children) {
            if (child.is_composition !== 1) {
                leaves.push(child.element_id);
            } else {
                leaves.push(...this.getDescendantLeafIds(child.element_id, maxDepth, depth + 1));
            }
        }
        return leaves;
    }

    /* ---- ISA-95 hierarchy ---- */

    /**
     * Ensure ISA-95 hierarchy objects exist above a device.
     * Creates Enterprise → Site → Area → WorkCenter → WorkUnit chain
     * using deterministic v5 UUIDs, and re-parents the device under
     * the deepest ISA-95 level.
     *
     * isa95Segments: e.g. ["AMRC", "Factory 2050", "MK1"]
     * deviceElementId: the ConfigDB UUID of the device
     */
    ensureIsa95Hierarchy(isa95Segments: string[], deviceElementId: string): void {
        this.ensureIsa95(isa95Segments, deviceElementId, false);
    }

    /** As ensureIsa95Hierarchy; with `onlyForDevice`, do nothing at all
     * unless the device is in the tree (the UNS path). */
    private ensureIsa95(isa95Segments: string[], deviceElementId: string, onlyForDevice: boolean): void {
        const device = this.getObject(deviceElementId);
        if (!device && onlyForDevice) return;
        const ids = this.isa95Ids(isa95Segments);

        // Every UNS message lands here. If the device already sits under
        // the deepest level, the chain exists: a level is only removed
        // once it has no children.
        if (device && ids.length > 0 && device.parentId === ids[ids.length - 1]) return;

        let parentId = "/";

        for (let i = 0; i < isa95Segments.length; i++) {
            const segment = isa95Segments[i];
            const elementId = ids[i];

            if (!this.hasObject(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    segment,
                    "isa95-level",  // synthetic type for ISA-95 nodes
                    parentId,
                    true,           // isComposition
                );
                this.putObject(obj, "config");
            }

            parentId = elementId;
        }

        // Re-parent the device under the deepest ISA-95 level
        if (device && device.parentId !== parentId) {
            this.writes++;
            this.objectRev++;
            this.store.prepare("update object set parent_id = ? where element_id = ?")
                .run(parentId, deviceElementId);
        }
    }

    /** The elementIds of an ISA-95 chain, top first. These are v5
     * UUIDs of the path; there are few distinct chains, so remember
     * them rather than hash on every UNS message. */
    private isa95Ids(segments: string[]): string[] {
        const key = segments.join("\u0000");
        let ids = this.isa95IdCache.get(key);
        if (!ids) {
            ids = [];
            let parentId = "/";
            for (const segment of segments) {
                parentId = uuidv5(`isa95:${parentId}:${segment}`, I3X_UUID_NAMESPACE);
                ids.push(parentId);
            }
            if (this.isa95IdCache.size >= 10_000) this.isa95IdCache.clear();
            this.isa95IdCache.set(key, ids);
        }
        return ids;
    }

    /* ---- UNS composition ---- */

    addCompositionFromUns(
        instanceUuidPath: string[],
        schemaUuidPath: string[],
        metricSegments: string[],
        isa95Segments?: string[],
    ): string | null {
        // Nodes added here are tagged source:"uns"; replaceDeviceSubtree
        // keeps them as long as their parent survives.
        const writesBefore = this.writes;

        const leaf = this.store.transaction(() => {
            // Since f46612c5, Instance_UUID === ConfigDB object UUID,
            // so the device UUID from UNS messages is the elementId directly.
            const deviceElementId = instanceUuidPath[0];

            // Build ISA-95 hierarchy above the device if segments provided
            // and the device is in the tree
            if (isa95Segments && isa95Segments.length > 0) {
                this.ensureIsa95(isa95Segments, deviceElementId, true);
            }

            // Build the full tree from metric segments.
            // metricSegments = ["Axes", "1", "Base_Axis", "Angle", "Actual"]
            // instanceUuidPath = [device, Axes, 1, Base_Axis]  (may be shorter)
            // schemaUuidPath   = [device, Axes, 1, Base_Axis, Metric]  (may be shorter)
            //
            // For each segment, use the Instance_UUID if available (index i+1
            // in instanceUuidPath, since index 0 is the device). Otherwise
            // generate a deterministic UUID from the parent UUID + segment name.

            let parentId = deviceElementId;

            for (let i = 0; i < metricSegments.length; i++) {
                const segment = metricSegments[i];
                // instanceUuidPath index: i+1 (0 is the device)
                const instanceIdx = i + 1;
                const hasInstanceUuid = instanceIdx < instanceUuidPath.length;

                // If the tree already has a child of parentId with this name
                // (from buildTreeFromOriginMap), reuse its elementId. This
                // avoids divergence when the origin map has Instance_UUIDs
                // at deeper levels than the UNS instanceUuidPath provides.
                const existing = this.findChildByName(parentId, segment);
                const elementId = existing
                    ?? (hasInstanceUuid
                        ? instanceUuidPath[instanceIdx]
                        : uuidv5(`${parentId}:${segment}`, I3X_UUID_NAMESPACE));

                // Schema: use schemaUuidPath[i+1] if available, else "unknown"
                const schemaIdx = i + 1;
                const typeElementId = schemaIdx < schemaUuidPath.length
                    ? schemaUuidPath[schemaIdx]
                    : "unknown";

                // Last segment is a leaf metric (has a value), rest are composition
                const isLeaf = i === metricSegments.length - 1;

                if (!existing && !this.hasObject(elementId)) {
                    const obj = toI3xObject(
                        elementId,
                        segment,
                        typeElementId,
                        parentId,
                        !isLeaf,  // isComposition: true for branches, false for leaves
                    );
                    this.putObject(obj, "uns");
                }

                parentId = elementId;
            }

            // Return the leaf elementId (last in the chain)
            return parentId;
        });

        if (this.writes !== writesBefore) this.changed();
        return leaf;
    }

    /* ---- Private ---- */

    /** Find an existing child of parentId by display name. */
    private findChildByName(parentId: string, name: string): string | undefined {
        const r = this.store.prepare(
            "select element_id from object where parent_id = ? and display_name = ? order by seq limit 1",
        ).get(parentId, name) as any;
        return r?.element_id;
    }

    /**
     * Recursively search an originMap for an object whose Schema_UUID
     * matches the target. Returns the matching object or undefined.
     */
    private findBySchemaUuid(obj: any, targetSchemaUuid: string): any | undefined {
        if (obj == null || typeof obj !== "object") return undefined;
        if (obj.Schema_UUID === targetSchemaUuid) return obj;
        for (const value of Object.values(obj)) {
            if (value != null && typeof value === "object") {
                const found = this.findBySchemaUuid(value, targetSchemaUuid);
                if (found) return found;
            }
        }
        return undefined;
    }

    /**
     * Extract ISA-95 hierarchy values from an ISA95_Hierarchy object.
     * Returns the segments in order (Enterprise, Site, Area, WorkCenter, WorkUnit),
     * stopping at the first missing level (unbroken chain).
     */
    private extractIsa95Segments(hierarchy: any): string[] {
        const levels = ["Enterprise", "Site", "Area", "Work Center", "Work Unit"];
        const segments: string[] = [];
        for (const level of levels) {
            const entry = hierarchy[level];
            const value = entry?.Value ?? entry?.value;
            if (!value) break;
            segments.push(value);
        }
        return segments;
    }

    /**
     * Keys in the originMap that are metadata, not metric/container nodes.
     * These should be skipped when building the object tree.
     */
    private static readonly METADATA_KEYS = new Set([
        "Schema_UUID", "Instance_UUID", "Method", "Address", "Path",
        "Documentation", "Sparkplug_Type", "Record_To_Historian",
        "Eng_Unit", "Eng_Low", "Eng_High", "Deadband", "Tooltip",
        "Value", "value",
    ]);

    /**
     * Recursively walk an originMap and build the object tree.
     *
     * Each key in the map is either:
     * - A metadata field (Schema_UUID, Sparkplug_Type, etc.) → skip
     * - A leaf metric (has Sparkplug_Type, no sub-objects with Schema_UUID) → create leaf object
     * - A composition container (has sub-objects) → create composition object, recurse
     */
    private buildTreeFromOriginMap(
        originMap: any,
        parentId: string,
        topLevelInstanceUuid: string,
        pathPrefix: string,
    ): void {
        if (originMap == null || typeof originMap !== "object") return;

        for (const [key, value] of Object.entries(originMap)) {
            // Skip metadata fields
            if (ObjectTree.METADATA_KEYS.has(key)) continue;
            if (value == null || typeof value !== "object") continue;

            const entry = value as any;

            // Is this a leaf metric? It has Sparkplug_Type and no child containers.
            const hasSparkplugType = typeof entry.Sparkplug_Type === "string";
            const hasChildren = this.hasChildContainers(entry);
            const isLeaf = hasSparkplugType && !hasChildren;

            // Skip plain value objects that aren't metrics and don't have children
            // (e.g. ISA-95 hierarchy values like { Value: "AMRC" })
            if (!hasSparkplugType && !hasChildren) continue;

            // Use Instance_UUID if available, otherwise synthesise
            const elementId = entry.Instance_UUID
                ?? uuidv5(`${parentId}:${key}`, I3X_UUID_NAMESPACE);

            // Use Schema_UUID as typeElementId if available
            const typeElementId = entry.Schema_UUID ?? "unknown";

            // Build the metric path for InfluxDB queries
            const currentPath = pathPrefix ? `${pathPrefix}/${key}` : key;

            if (!this.hasObject(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    key,
                    typeElementId,
                    parentId,
                    !isLeaf,
                );
                this.putObject(obj, "config");
            }

            // Store InfluxDB query metadata for leaf metrics
            if (isLeaf) {
                // The "path" tag in InfluxDB is everything EXCEPT the metric name.
                // e.g. for "Phases/1/True_RMS_Current", path="Phases/1", name="True_RMS_Current"
                const pathParts = currentPath.split("/");
                const metricName = pathParts.pop()!;
                const metricPath = pathParts.join("/");

                this.putMeta(elementId, {
                    topLevelInstanceUuid,
                    metricPath,
                    metricName,
                    sparkplugType: entry.Sparkplug_Type,
                    typeSuffix: sparkplugTypeToSuffix(entry.Sparkplug_Type),
                });
            }

            // Recurse into children if this is a composition container
            if (!isLeaf) {
                this.buildTreeFromOriginMap(entry, elementId, topLevelInstanceUuid, currentPath);
            }
        }
    }

    /**
     * Check if an originMap entry has child containers (sub-objects
     * that have their own Schema_UUID or Sparkplug_Type).
     */
    private hasChildContainers(entry: any): boolean {
        for (const [key, value] of Object.entries(entry)) {
            if (ObjectTree.METADATA_KEYS.has(key)) continue;
            if (value != null && typeof value === "object") return true;
        }
        return false;
    }

    /**
     * Recursively collect all Schema_UUIDs from an originMap.
     */
    private collectSchemaUuids(obj: any, target: Set<string>): void {
        if (obj == null || typeof obj !== "object") return;
        if (typeof obj.Schema_UUID === "string" && obj.Schema_UUID !== "") {
            target.add(obj.Schema_UUID);
        }
        for (const value of Object.values(obj)) {
            if (value != null && typeof value === "object") {
                this.collectSchemaUuids(value, target);
            }
        }
    }

    private buildNamespace(): void {
        this.namespace = toI3xNamespace(this.namespaceName, this.namespaceUri);
    }

    private buildRelationshipTypes(): void {
        const ns = this.namespaceUri;
        const types: I3xRelationshipType[] = [
            toI3xRelationshipType(RelType.HasParent, "Has Parent", ns, RelType.HasParent, RelType.HasChildren),
            toI3xRelationshipType(RelType.HasChildren, "Has Children", ns, RelType.HasChildren, RelType.HasParent),
            toI3xRelationshipType(RelType.HasComponent, "Has Component", ns, RelType.HasComponent, RelType.ComponentOf),
            toI3xRelationshipType(RelType.ComponentOf, "Component Of", ns, RelType.ComponentOf, RelType.HasComponent),
        ];
        for (const rt of types) {
            this.relationshipTypes.set(rt.elementId, rt);
        }
    }

    /**
     * Place one device (and its metric subtree) into the tree from a
     * DeviceInformation + Info config, and record the Schema_UUIDs its
     * originMap references so the matching ObjectTypes are kept.
     */
    private buildDevice(uuid: string, devInfo: any, nameInfo: any): void {
        if (!devInfo) {
            this.log("buildDevice: no DeviceInformation for %s, skipping", uuid);
            return;
        }

        const schemaUuid = devInfo.schema ?? devInfo.originMap?.Schema_UUID;
        if (!schemaUuid) {
            this.log("buildDevice: no Schema_UUID for %s, skipping", uuid);
            return;
        }
        const schemaUuids = new Set<string>([schemaUuid]);

        // Find ISA-95 hierarchy by searching for the Hierarchy-v1 Schema_UUID
        const hierarchyObj = this.findBySchemaUuid(devInfo.originMap, HIERARCHY_SCHEMA_UUID);
        const isa95Segments = hierarchyObj ? this.extractIsa95Segments(hierarchyObj) : [];

        if (isa95Segments.length === 0) {
            // Default to <namespace>/Unknown for devices without ISA-95
            isa95Segments.push(this.namespaceName, "Unknown");
            this.log("buildDevice: no ISA-95 for %s, placing under Unknown", uuid);
        } else {
            this.log("buildDevice: ISA-95 hierarchy for %s: %o", uuid, isa95Segments);
        }

        const displayName = nameInfo?.name ?? devInfo.sparkplugName ?? uuid;

        const obj = toI3xObject(uuid, displayName, schemaUuid, "/", true);
        this.putObject(obj, "config");

        if (isa95Segments.length > 0) {
            this.ensureIsa95Hierarchy(isa95Segments, uuid);
        }

        if (devInfo.originMap) {
            this.buildTreeFromOriginMap(devInfo.originMap, uuid, uuid, "");
            this.collectSchemaUuids(devInfo.originMap, schemaUuids);
        }

        const ins = this.store.prepare(
            "insert or ignore into device_schema (device_uuid, schema_uuid) values (?, ?)");
        for (const s of schemaUuids) ins.run(uuid, s);
    }
}
