/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ObjectTree — Constructs and maintains the i3X object graph from
 * Factory+ services (ConfigDB + Directory).
 *
 * All Explore endpoints serve data from this tree.
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
    DEVICE_CLASS_UUID,
    CONFIG_SCHEMA_APP_UUID,
    INFO_APP_UUID,
    DEVICE_INFORMATION_APP_UUID,
} from "./constants.js";

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
    fplus: any;
    namespaceName: string;
    namespaceUri: string;
}

/**
 * Input to refreshFromSnapshot — pre-fetched ConfigDB state from the
 * reactive pipeline. Keys are the corresponding ConfigDB object UUIDs.
 * `devInfo`/`info`/`schema` are config bodies (or null when the entry is
 * missing or inaccessible).
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

/**
 * Origin of a node in the tree.
 *  - "config" : derived from ConfigDB (DeviceInformation originMap,
 *               ISA-95 hierarchy, device-level objects).
 *  - "uns"    : discovered at runtime from a UNS MQTT message and
 *               not (yet) represented in any DeviceInformation config.
 *
 * Tracked in a parallel map on the snapshot so the API/wire shape
 * I3xObject stays clean.
 */
export type NodeSource = "config" | "uns";

/**
 * All mutable tree state, bundled so refresh() can build a new snapshot
 * off to the side and swap it in with a single synchronous assignment.
 * Readers running between event-loop turns see either the old or new
 * snapshot, never a half-built one.
 */
interface TreeSnapshot {
    objectTypes: Map<string, I3xObjectType>;
    objects: Map<string, I3xObject>;
    children: Map<string, Set<string>>;
    metricMeta: Map<string, MetricMeta>;
    sources: Map<string, NodeSource>;
}

function emptySnapshot(): TreeSnapshot {
    return {
        objectTypes: new Map(),
        objects: new Map(),
        children: new Map(),
        metricMeta: new Map(),
        sources: new Map(),
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

export class ObjectTree {
    private fplus: any;
    private namespaceName: string;
    private namespaceUri: string;
    private log: (msg: string, ...args: any[]) => void;

    private ready: boolean = false;
    private namespace: I3xNamespace | null = null;
    private relationshipTypes: Map<string, I3xRelationshipType> = new Map();
    private snapshot: TreeSnapshot = emptySnapshot();

    constructor(opts: ObjectTreeOpts) {
        this.fplus = opts.fplus;
        this.namespaceName = opts.namespaceName;
        this.namespaceUri = opts.namespaceUri;
        this.log = opts.fplus.debug.bound("object-tree");
    }

    async init(): Promise<this> {
        this.log("building namespace and relationship types");
        this.buildNamespace();
        this.buildRelationshipTypes();
        this.log("loading devices from ConfigDB + Directory");
        const next = emptySnapshot();
        await this.loadDevices(next);
        this.snapshot = next;
        this.log("init complete: objects=%d types=%d",
            this.snapshot.objects.size, this.snapshot.objectTypes.size);
        this.ready = true;
        return this;
    }

    async refresh(): Promise<void> {
        // Build the new tree off to the side, port UNS-discovered nodes
        // from the old snapshot, then swap atomically. In-flight API
        // reads see either the old or new snapshot, never a partial one.
        // UNS-driven writes via addCompositionFromUns continue to land on
        // the live (old) snapshot during the rebuild and are picked up by
        // preserveUnsNodes when the swap happens.
        const old = this.snapshot;
        const next = emptySnapshot();
        await this.loadDevices(next);
        this.preserveUnsNodes(old, next);
        this.snapshot = next;
    }

    /**
     * Rebuild the snapshot from configs already fetched by the reactive
     * pipeline. Same atomic-swap and UNS-preservation semantics as
     * refresh(), but no HTTP — the caller has done the fetching via
     * notify-v2 watches.
     */
    refreshFromSnapshot(input: PipelineSnapshot): void {
        const old = this.snapshot;
        const next = emptySnapshot();
        for (const [uuid, { devInfo, info }] of input.devices) {
            this.buildDeviceInSnapshot(uuid, devInfo, info, next);
        }
        for (const [schemaUuid, { schema, info }] of input.schemas) {
            this.buildObjectTypeInSnapshot(schemaUuid, schema, info, next);
        }
        this.preserveUnsNodes(old, next);
        this.snapshot = next;
    }

    /**
     * Carry UNS-discovered nodes from `old` into `next`. For every node
     * already present in `next` (i.e. every config-derived parent that
     * survives the rebuild), find UNS-source children of that node in
     * `old` and copy their subtrees into `next`. UNS-source nodes whose
     * parents are no longer in `next` (e.g. their device was removed)
     * are silently dropped — they're orphans.
     *
     * Config-derived nodes with the same elementId in both snapshots are
     * already in `next` from the build, so an UNS-discovered node that
     * has since been added to the device's DeviceInformation config
     * automatically becomes config-source (config wins).
     */
    private preserveUnsNodes(old: TreeSnapshot, next: TreeSnapshot): void {
        // Walk every node in `next` and look for UNS-source children of
        // it in `old` that aren't already in `next`. We must enqueue any
        // newly-copied UNS nodes so we pick up nested UNS subtrees.
        const queue: string[] = [...next.objects.keys()];
        while (queue.length > 0) {
            const parentId = queue.shift()!;
            const oldChildren = old.children.get(parentId);
            if (!oldChildren) continue;
            for (const childId of oldChildren) {
                if (next.objects.has(childId)) continue;
                if (old.sources.get(childId) !== "uns") continue;
                this.copyUnsSubtree(childId, old, next);
                queue.push(childId);
            }
        }
    }

    /** Recursively copy a UNS-source subtree from `old` to `next`. */
    private copyUnsSubtree(id: string, old: TreeSnapshot, next: TreeSnapshot): void {
        const obj = old.objects.get(id);
        if (!obj) return;

        next.objects.set(id, obj);
        next.sources.set(id, "uns");

        if (obj.parentId !== null) {
            if (!next.children.has(obj.parentId)) {
                next.children.set(obj.parentId, new Set());
            }
            next.children.get(obj.parentId)!.add(id);
        }

        const meta = old.metricMeta.get(id);
        if (meta) next.metricMeta.set(id, meta);

        const oldChildren = old.children.get(id);
        if (oldChildren) {
            for (const childId of oldChildren) {
                this.copyUnsSubtree(childId, old, next);
            }
        }
    }

    /** Test-facing inspector for a node's origin. */
    getNodeSource(elementId: string): NodeSource | undefined {
        return this.snapshot.sources.get(elementId);
    }

    /* ---- Synchronous per-device / per-schema mutations ----
     *
     * Used by the reactive pipeline (lib/refresh.ts) to splice changes
     * into the live snapshot in place, instead of rebuilding the whole
     * tree on every ConfigDB event. All methods are synchronous — no
     * awaits between writes — so readers see consistent state between
     * event-loop turns, same atomicity guarantee as the swap path.
     */

    /**
     * Add a device and its full subtree (including ISA-95 ancestors and
     * metric tree from the originMap) to the live snapshot.
     */
    addDevice(uuid: string, devInfo: any, info: any): void {
        this.buildDeviceInSnapshot(uuid, devInfo, info, this.snapshot);
    }

    /**
     * Remove a device, its entire descendant subtree (config and UNS
     * alike), and any ISA-95 ancestor that becomes childless as a
     * result.
     */
    removeDevice(uuid: string): void {
        const target = this.snapshot;
        const device = target.objects.get(uuid);
        if (!device) return;

        const ancestors = this.collectIsa95Ancestors(device, target);

        this.removeSubtree(uuid, target);
        if (device.parentId !== null) {
            target.children.get(device.parentId)?.delete(uuid);
        }

        this.cleanupOrphanAncestors(ancestors, target);
    }

    /**
     * Replace a device's config-source subtree from a new DeviceInformation
     * config, preserving UNS-discovered descendants whose parents survive
     * the rebuild. The device's elementId is stable (its ConfigDB UUID).
     */
    replaceDeviceSubtree(uuid: string, devInfo: any, info: any): void {
        const target = this.snapshot;
        const oldDevice = target.objects.get(uuid);
        if (!oldDevice) {
            this.addDevice(uuid, devInfo, info);
            return;
        }

        const oldAncestors = this.collectIsa95Ancestors(oldDevice, target);
        const unsCaptures = this.captureUnsDescendants(uuid, target);

        this.removeSubtree(uuid, target);
        if (oldDevice.parentId !== null) {
            target.children.get(oldDevice.parentId)?.delete(uuid);
        }
        this.cleanupOrphanAncestors(oldAncestors, target);

        this.buildDeviceInSnapshot(uuid, devInfo, info, target);

        // Re-graft UNS descendants whose parent now exists in the new tree
        for (const cap of unsCaptures) {
            if (!target.objects.has(cap.parentId)) continue; // orphan
            if (target.objects.has(cap.id)) continue;         // superseded by config
            target.objects.set(cap.id, cap.obj);
            target.sources.set(cap.id, "uns");
            if (cap.meta) target.metricMeta.set(cap.id, cap.meta);
            if (!target.children.has(cap.parentId)) {
                target.children.set(cap.parentId, new Set());
            }
            target.children.get(cap.parentId)!.add(cap.id);
        }
    }

    /** Update only the device's displayName. */
    updateDeviceName(uuid: string, displayName: string): void {
        const obj = this.snapshot.objects.get(uuid);
        if (obj) obj.displayName = displayName;
    }

    /** Create or replace an ObjectType in the live snapshot. */
    addObjectType(uuid: string, schema: any, info: any): void {
        this.buildObjectTypeInSnapshot(uuid, schema, info, this.snapshot);
    }

    /** Update an ObjectType in place. Equivalent to addObjectType. */
    updateObjectType(uuid: string, schema: any, info: any): void {
        this.buildObjectTypeInSnapshot(uuid, schema, info, this.snapshot);
    }

    /** Remove an ObjectType. Doesn't touch objects that reference it. */
    removeObjectType(uuid: string): void {
        this.snapshot.objectTypes.delete(uuid);
    }

    /* ---- mutation helpers ---- */

    /** Walk up the parent chain, collecting ISA-95 ancestor IDs. */
    private collectIsa95Ancestors(obj: I3xObject, target: TreeSnapshot): string[] {
        const out: string[] = [];
        let parentId = obj.parentId;
        while (parentId !== null && parentId !== "/") {
            out.push(parentId);
            const parent = target.objects.get(parentId);
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
    private cleanupOrphanAncestors(ancestors: string[], target: TreeSnapshot): void {
        for (const ancestorId of ancestors) {
            const childSet = target.children.get(ancestorId);
            if (childSet && childSet.size > 0) break;
            const ancestor = target.objects.get(ancestorId);
            if (!ancestor) continue;
            target.objects.delete(ancestorId);
            target.sources.delete(ancestorId);
            target.children.delete(ancestorId);
            if (ancestor.parentId !== null) {
                target.children.get(ancestor.parentId)?.delete(ancestorId);
            }
        }
    }

    /** Recursively remove a subtree from `target`. */
    private removeSubtree(id: string, target: TreeSnapshot): void {
        const childIds = target.children.get(id);
        if (childIds) {
            for (const childId of childIds) {
                this.removeSubtree(childId, target);
            }
            target.children.delete(id);
        }
        target.objects.delete(id);
        target.sources.delete(id);
        target.metricMeta.delete(id);
    }

    /**
     * Pre-order walk of the subtree rooted at `rootId`, collecting every
     * UNS-source node with its original parent pointer. Pre-order means
     * parents appear before children in the result, which is what
     * replaceDeviceSubtree's re-graft loop relies on.
     */
    private captureUnsDescendants(rootId: string, target: TreeSnapshot): UnsCapture[] {
        const out: UnsCapture[] = [];
        const visit = (id: string) => {
            const childIds = target.children.get(id);
            if (!childIds) return;
            for (const childId of childIds) {
                if (target.sources.get(childId) === "uns") {
                    const obj = target.objects.get(childId);
                    if (obj && obj.parentId !== null) {
                        out.push({
                            id: childId,
                            obj,
                            parentId: obj.parentId,
                            meta: target.metricMeta.get(childId),
                        });
                    }
                }
                visit(childId);
            }
        };
        visit(rootId);
        return out;
    }

    isReady(): boolean {
        return this.ready;
    }

    /* ---- Namespace ---- */

    getNamespaces(): I3xNamespace[] {
        return this.namespace ? [this.namespace] : [];
    }

    /* ---- Object Types ---- */

    getObjectTypes(namespaceUri?: string): I3xObjectType[] {
        const all = Array.from(this.snapshot.objectTypes.values());
        if (namespaceUri === undefined) return all;
        return all.filter(t => t.namespaceUri === namespaceUri);
    }

    getObjectType(elementId: string): I3xObjectType | undefined {
        return this.snapshot.objectTypes.get(elementId);
    }

    /* ---- Objects ---- */

    getObjects(opts?: { typeElementId?: string; root?: boolean; includeMetadata?: boolean }): I3xObject[] {
        let all = Array.from(this.snapshot.objects.values());
        if (opts?.typeElementId !== undefined) {
            all = all.filter(o => o.typeElementId === opts.typeElementId);
        }
        if (opts?.root) {
            all = all.filter(o => o.parentId === "/");
        }
        return all;
    }

    getObject(elementId: string): I3xObject | undefined {
        return this.snapshot.objects.get(elementId);
    }

    /* ---- Relationships ---- */

    getRelated(elementId: string, relationshipType?: string): I3xObject[] {
        const snap = this.snapshot;
        const obj = snap.objects.get(elementId);
        if (!obj) return [];

        const result: I3xObject[] = [];

        if (relationshipType === undefined || relationshipType === RelType.HasParent) {
            if (obj.parentId !== null && obj.parentId !== "/") {
                const parent = snap.objects.get(obj.parentId);
                if (parent) result.push(parent);
            }
        }

        if (relationshipType === undefined || relationshipType === RelType.HasChildren) {
            const childIds = snap.children.get(elementId);
            if (childIds) {
                for (const childId of childIds) {
                    const child = snap.objects.get(childId);
                    if (child) result.push(child);
                }
            }
        }

        return result;
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
        const childSet = this.snapshot.children.get(elementId);
        return childSet ? Array.from(childSet) : [];
    }

    /** Get InfluxDB query metadata for a leaf metric. */
    getMetricMeta(elementId: string): MetricMeta | undefined {
        return this.snapshot.metricMeta.get(elementId);
    }

    /**
     * Collect all leaf metric elementIds that are descendants of the
     * given elementId (for composition value queries).
     */
    getDescendantLeafIds(elementId: string, maxDepth: number = 0, depth: number = 0): string[] {
        if (maxDepth > 0 && depth >= maxDepth) return [];
        const childIds = this.getChildElementIds(elementId);
        const leaves: string[] = [];
        for (const childId of childIds) {
            const child = this.snapshot.objects.get(childId);
            if (child && !child.isComposition) {
                leaves.push(childId);
            } else {
                leaves.push(...this.getDescendantLeafIds(childId, maxDepth, depth + 1));
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
     * target: the snapshot to mutate (live snapshot for UNS writes,
     *         in-progress snapshot during a refresh)
     */
    ensureIsa95Hierarchy(isa95Segments: string[], deviceElementId: string, target: TreeSnapshot): void {
        let parentId = "/";

        for (const segment of isa95Segments) {
            const elementId = uuidv5(`isa95:${parentId}:${segment}`, I3X_UUID_NAMESPACE);

            if (!target.objects.has(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    segment,
                    "isa95-level",  // synthetic type for ISA-95 nodes
                    parentId,
                    true,           // isComposition
                );
                target.objects.set(elementId, obj);
                target.sources.set(elementId, "config");

                if (!target.children.has(parentId)) {
                    target.children.set(parentId, new Set());
                }
                target.children.get(parentId)!.add(elementId);
            }

            parentId = elementId;
        }

        // Re-parent the device under the deepest ISA-95 level
        const device = target.objects.get(deviceElementId);
        if (device && device.parentId !== parentId) {
            // Remove from old parent's children
            const oldParent = device.parentId;
            if (oldParent) {
                target.children.get(oldParent)?.delete(deviceElementId);
            }

            // Update device parentId
            (device as any).parentId = parentId;

            // Add to new parent's children
            if (!target.children.has(parentId)) {
                target.children.set(parentId, new Set());
            }
            target.children.get(parentId)!.add(deviceElementId);
        }
    }

    /* ---- UNS composition ---- */

    addCompositionFromUns(
        instanceUuidPath: string[],
        schemaUuidPath: string[],
        metricSegments: string[],
        isa95Segments?: string[],
    ): string | null {
        // Mutate the live snapshot directly. Nodes added here are tagged
        // source:"uns"; preserveUnsNodes() carries them across atomic
        // refreshes as long as their parent survives in the new snapshot.
        const target = this.snapshot;

        // Since f46612c5, Instance_UUID === ConfigDB object UUID,
        // so the device UUID from UNS messages is the elementId directly.
        const deviceElementId = instanceUuidPath[0];

        // Build ISA-95 hierarchy above the device if segments provided
        if (isa95Segments && isa95Segments.length > 0 && target.objects.has(deviceElementId)) {
            this.ensureIsa95Hierarchy(isa95Segments, deviceElementId, target);
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
            // (from buildTreeFromOriginMap at startup), reuse its elementId.
            // This avoids divergence when the origin map has Instance_UUIDs
            // at deeper levels than the UNS instanceUuidPath provides.
            const existing = this.findChildByName(parentId, segment, target);
            const elementId = existing?.elementId
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

            if (!target.objects.has(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    segment,
                    typeElementId,
                    parentId,
                    !isLeaf,  // isComposition: true for branches, false for leaves
                );
                target.objects.set(elementId, obj);
                target.sources.set(elementId, "uns");

                // Track parent -> children
                if (!target.children.has(parentId)) {
                    target.children.set(parentId, new Set());
                }
                target.children.get(parentId)!.add(elementId);
            }

            parentId = elementId;
        }

        // Return the leaf elementId (last in the chain)
        return parentId;
    }

    /* ---- Private ---- */

    /** Find an existing child of parentId by display name. */
    private findChildByName(parentId: string, name: string, target: TreeSnapshot): I3xObject | undefined {
        const childIds = target.children.get(parentId);
        if (!childIds) return undefined;
        for (const childId of childIds) {
            const child = target.objects.get(childId);
            if (child?.displayName === name) return child;
        }
        return undefined;
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
        target: TreeSnapshot,
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

            if (!target.objects.has(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    key,
                    typeElementId,
                    parentId,
                    !isLeaf,
                );
                target.objects.set(elementId, obj);
                target.sources.set(elementId, "config");

                if (!target.children.has(parentId)) {
                    target.children.set(parentId, new Set());
                }
                target.children.get(parentId)!.add(elementId);
            }

            // Store InfluxDB query metadata for leaf metrics
            if (isLeaf) {
                // The "path" tag in InfluxDB is everything EXCEPT the metric name.
                // e.g. for "Phases/1/True_RMS_Current", path="Phases/1", name="True_RMS_Current"
                const pathParts = currentPath.split("/");
                const metricName = pathParts.pop()!;
                const metricPath = pathParts.join("/");

                target.metricMeta.set(elementId, {
                    topLevelInstanceUuid,
                    metricPath,
                    metricName,
                    sparkplugType: entry.Sparkplug_Type,
                    typeSuffix: sparkplugTypeToSuffix(entry.Sparkplug_Type),
                });
            }

            // Recurse into children if this is a composition container
            if (!isLeaf) {
                this.buildTreeFromOriginMap(entry, elementId, topLevelInstanceUuid, currentPath, target);
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

    private async loadDevices(target: TreeSnapshot): Promise<void> {
        this.log("loadDevices: fetching Device class members from ConfigDB");
        const deviceUuids: string[] = await this.fplus.ConfigDB.class_members(DEVICE_CLASS_UUID);
        this.log("loadDevices: found %d devices", deviceUuids.length);

        // Track unique schema UUIDs so we create ObjectTypes for them
        const schemaUuids = new Set<string>();

        for (const uuid of deviceUuids) {
            this.log("loadDevices: fetching DeviceInformation config for %s", uuid);

            // Fetch DeviceInformation app config — contains Schema_UUID,
            // Instance_UUID, ISA-95 hierarchy, and the full originMap.
            const [devInfo, nameInfo] = await Promise.all([
                this.fplus.ConfigDB.get_config(DEVICE_INFORMATION_APP_UUID, uuid).catch(() => null),
                this.fplus.ConfigDB.get_config(INFO_APP_UUID, uuid).catch(() => null),
            ]);

            this.buildDeviceInSnapshot(uuid, devInfo, nameInfo, target, schemaUuids);
        }

        // For each unique schema, get its JSON schema definition and create ObjectType
        this.log("loadDevices: loading %d schemas for unique device types", schemaUuids.size);
        for (const schemaUuid of schemaUuids) {
            if (target.objectTypes.has(schemaUuid)) continue;

            this.log("loadDevices: fetching schema definition %s", schemaUuid);
            const [schema, info] = await Promise.all([
                this.fplus.ConfigDB.get_config(CONFIG_SCHEMA_APP_UUID, schemaUuid).catch(() => null),
                this.fplus.ConfigDB.get_config(INFO_APP_UUID, schemaUuid).catch(() => null),
            ]);
            this.buildObjectTypeInSnapshot(schemaUuid, schema, info, target);
        }

        this.log("loadDevices: complete, devices=%d types=%d",
            target.objects.size, target.objectTypes.size);
    }

    /**
     * Place one device (and its metric subtree) into `target` from a
     * pre-fetched DeviceInformation + Info config. Mirrors the per-device
     * logic in loadDevices() but takes the configs as arguments instead
     * of fetching them. `schemaUuids` accumulates every Schema_UUID
     * referenced from the device's originMap, so callers can create the
     * matching ObjectTypes afterwards.
     */
    private buildDeviceInSnapshot(
        uuid: string,
        devInfo: any,
        nameInfo: any,
        target: TreeSnapshot,
        schemaUuids?: Set<string>,
    ): void {
        if (!devInfo) {
            this.log("buildDevice: no DeviceInformation for %s, skipping", uuid);
            return;
        }

        const schemaUuid = devInfo.schema ?? devInfo.originMap?.Schema_UUID;
        if (!schemaUuid) {
            this.log("buildDevice: no Schema_UUID for %s, skipping", uuid);
            return;
        }
        schemaUuids?.add(schemaUuid);

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
        target.objects.set(uuid, obj);
        target.sources.set(uuid, "config");

        if (isa95Segments.length > 0) {
            this.ensureIsa95Hierarchy(isa95Segments, uuid, target);
        }

        if (devInfo.originMap) {
            this.buildTreeFromOriginMap(devInfo.originMap, uuid, uuid, "", target);
            if (schemaUuids) this.collectSchemaUuids(devInfo.originMap, schemaUuids);
            this.log("buildDevice: built metric tree for %s, children=%d",
                uuid, target.children.get(uuid)?.size ?? 0);
        }
    }

    /**
     * Create or replace an ObjectType in `target` from a pre-fetched
     * ConfigSchema + Info config. Idempotent: a second call with the
     * same schemaUuid replaces the entry.
     */
    private buildObjectTypeInSnapshot(
        schemaUuid: string,
        schema: any,
        info: any,
        target: TreeSnapshot,
    ): void {
        const displayName = info?.name ?? schema?.title ?? schemaUuid;
        const objType = toI3xObjectType(
            schemaUuid,
            displayName,
            this.namespaceUri,
            schemaUuid,
            schema ?? {},
        );
        target.objectTypes.set(schemaUuid, objType);
        this.log("buildObjectType: %s (%s)", schemaUuid, displayName);
    }
}
