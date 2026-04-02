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

import { RelType, HIERARCHY_SCHEMA_UUID } from "./constants.js";

// Namespace for generating synthetic UUIDs for metric path segments
// that don't have their own Instance_UUID.
const I3X_UUID_NAMESPACE = "11ad7b32-1d32-4c4a-b0c9-fa049208939a";
import {
    toI3xNamespace,
    toI3xObjectType,
    toI3xObject,
    toI3xRelationshipType,
} from "./mapping.js";

const DEVICE_CLASS_UUID = "18773d6d-a70d-443a-b29a-3f1583195290";
const CONFIG_SCHEMA_APP_UUID = "dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3";
const INFO_APP_UUID = "64a8bfa9-7772-45c4-9d1a-9e6290690957";
const DEVICE_INFORMATION_APP_UUID = "a98ffed5-c613-4e70-bfd3-efeee250ade5";

interface ObjectTreeOpts {
    fplus: any;
    namespaceName: string;
    namespaceUri: string;
    logger: any;
}

/** InfluxDB query metadata for a leaf metric object. */
export interface MetricMeta {
    topLevelInstanceUuid: string;
    metricPath: string;      // e.g. "Phases/1"
    metricName: string;      // e.g. "True_RMS_Current"
    sparkplugType: string;   // e.g. "FloatLE"
    typeSuffix: string;      // e.g. "d"
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
    private logger: any;

    private ready: boolean = false;
    private namespace: I3xNamespace | null = null;
    private relationshipTypes: Map<string, I3xRelationshipType> = new Map();
    private objectTypes: Map<string, I3xObjectType> = new Map();
    private objects: Map<string, I3xObject> = new Map();
    private children: Map<string, Set<string>> = new Map();
    // Maps device Instance_UUID → ConfigDB UUID (for parent linking)
    private instanceToDevice: Map<string, string> = new Map();
    // Maps ConfigDB UUID → Instance_UUID (reverse of above)
    private deviceToInstance: Map<string, string> = new Map();
    // InfluxDB query metadata per leaf metric elementId
    private metricMeta: Map<string, MetricMeta> = new Map();

    constructor(opts: ObjectTreeOpts) {
        this.fplus = opts.fplus;
        this.namespaceName = opts.namespaceName;
        this.namespaceUri = opts.namespaceUri;
        this.logger = opts.logger;
    }

    async init(): Promise<this> {
        this.logger.debug?.("ObjectTree: building namespace and relationship types");
        this.buildNamespace();
        this.buildRelationshipTypes();
        this.logger.debug?.("ObjectTree: loading devices from ConfigDB + Directory...");
        await this.loadDevices();
        this.logger.debug?.({ objectCount: this.objects.size, typeCount: this.objectTypes.size }, "ObjectTree: init complete");
        this.ready = true;
        return this;
    }

    async refresh(): Promise<void> {
        this.objectTypes.clear();
        this.objects.clear();
        this.children.clear();
        // Don't clear instanceToDevice — the mapping is permanent once learned
        await this.loadDevices();
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
        const all = Array.from(this.objectTypes.values());
        if (namespaceUri === undefined) return all;
        return all.filter(t => t.namespaceUri === namespaceUri);
    }

    getObjectType(elementId: string): I3xObjectType | undefined {
        return this.objectTypes.get(elementId);
    }

    /* ---- Objects ---- */

    getObjects(opts?: { typeElementId?: string; root?: boolean; includeMetadata?: boolean }): I3xObject[] {
        let all = Array.from(this.objects.values());
        if (opts?.typeElementId !== undefined) {
            all = all.filter(o => o.typeElementId === opts.typeElementId);
        }
        if (opts?.root) {
            all = all.filter(o => o.parentId === "/");
        }
        return all;
    }

    getObject(elementId: string): I3xObject | undefined {
        return this.objects.get(elementId);
    }

    /* ---- Relationships ---- */

    getRelated(elementId: string, relationshipType?: string): I3xObject[] {
        const obj = this.objects.get(elementId);
        if (!obj) return [];

        const result: I3xObject[] = [];

        if (relationshipType === undefined || relationshipType === RelType.HasParent) {
            if (obj.parentId !== null && obj.parentId !== "/") {
                const parent = this.objects.get(obj.parentId);
                if (parent) result.push(parent);
            }
        }

        if (relationshipType === undefined || relationshipType === RelType.HasChildren) {
            const childIds = this.children.get(elementId);
            if (childIds) {
                for (const childId of childIds) {
                    const child = this.objects.get(childId);
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
        const childSet = this.children.get(elementId);
        return childSet ? Array.from(childSet) : [];
    }

    /** Get InfluxDB query metadata for a leaf metric. */
    getMetricMeta(elementId: string): MetricMeta | undefined {
        return this.metricMeta.get(elementId);
    }

    /** Get the Instance_UUID for a device ConfigDB UUID. */
    getInstanceUuid(configDbUuid: string): string | undefined {
        return this.deviceToInstance.get(configDbUuid);
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
            const child = this.objects.get(childId);
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
     */
    ensureIsa95Hierarchy(isa95Segments: string[], deviceElementId: string): void {
        let parentId = "/";

        for (const segment of isa95Segments) {
            const elementId = uuidv5(`isa95:${parentId}:${segment}`, I3X_UUID_NAMESPACE);

            if (!this.objects.has(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    segment,
                    "isa95-level",  // synthetic type for ISA-95 nodes
                    parentId,
                    true,           // isComposition
                );
                this.objects.set(elementId, obj);

                if (!this.children.has(parentId)) {
                    this.children.set(parentId, new Set());
                }
                this.children.get(parentId)!.add(elementId);
            }

            parentId = elementId;
        }

        // Re-parent the device under the deepest ISA-95 level
        const device = this.objects.get(deviceElementId);
        if (device && device.parentId !== parentId) {
            // Remove from old parent's children
            const oldParent = device.parentId;
            if (oldParent) {
                this.children.get(oldParent)?.delete(deviceElementId);
            }

            // Update device parentId
            (device as any).parentId = parentId;

            // Add to new parent's children
            if (!this.children.has(parentId)) {
                this.children.set(parentId, new Set());
            }
            this.children.get(parentId)!.add(deviceElementId);
        }
    }

    /* ---- UNS composition ---- */

    /**
     * Register a mapping from a device's Instance_UUID to its ConfigDB UUID.
     * Called when we first see a UNS message for a device.
     */
    registerDeviceInstance(instanceUuid: string, configDbUuid: string): void {
        this.instanceToDevice.set(instanceUuid, configDbUuid);
    }

    /** Check if a parentId points to an ISA-95 hierarchy node */
    private isIsa95Child(parentId: string | null): boolean {
        if (!parentId || parentId === "/") return false;
        const parent = this.objects.get(parentId);
        return parent?.typeElementId === "isa95-level";
    }

    addCompositionFromUns(
        _deviceUuid: string,
        instanceUuidPath: string[],
        schemaUuidPath: string[],
        metricSegments: string[],
        isa95Segments?: string[],
    ): string | null {
        // Resolve the device Instance_UUID to ConfigDB UUID.
        const deviceInstanceUuid = instanceUuidPath[0];
        let deviceConfigDbUuid = this.instanceToDevice.get(deviceInstanceUuid);

        // Auto-detect mapping on first encounter.
        // Match any unmatched root device object (could be at "/" or under ISA-95 hierarchy).
        if (!deviceConfigDbUuid) {
            for (const obj of this.objects.values()) {
                if ((obj.parentId === "/" || this.isIsa95Child(obj.parentId))
                    && !Array.from(this.instanceToDevice.values()).includes(obj.elementId)) {
                    this.instanceToDevice.set(deviceInstanceUuid, obj.elementId);
                    deviceConfigDbUuid = obj.elementId;
                    break;
                }
            }
        }

        // Build ISA-95 hierarchy above the device if segments provided
        if (isa95Segments && isa95Segments.length > 0 && deviceConfigDbUuid) {
            this.ensureIsa95Hierarchy(isa95Segments, deviceConfigDbUuid);
        }

        // Build the full tree from metric segments.
        // metricSegments = ["Axes", "1", "Base_Axis", "Angle", "Actual"]
        // instanceUuidPath = [device, Axes, 1, Base_Axis]  (may be shorter)
        // schemaUuidPath   = [device, Axes, 1, Base_Axis, Metric]  (may be shorter)
        //
        // For each segment, use the Instance_UUID if available (index i+1
        // in instanceUuidPath, since index 0 is the device). Otherwise
        // generate a deterministic UUID from the parent UUID + segment name.

        let parentId = deviceConfigDbUuid ?? deviceInstanceUuid;

        for (let i = 0; i < metricSegments.length; i++) {
            const segment = metricSegments[i];
            // instanceUuidPath index: i+1 (0 is the device)
            const instanceIdx = i + 1;
            const hasInstanceUuid = instanceIdx < instanceUuidPath.length;

            const elementId = hasInstanceUuid
                ? instanceUuidPath[instanceIdx]
                : uuidv5(`${parentId}:${segment}`, I3X_UUID_NAMESPACE);

            // Schema: use schemaUuidPath[i+1] if available, else "unknown"
            const schemaIdx = i + 1;
            const typeElementId = schemaIdx < schemaUuidPath.length
                ? schemaUuidPath[schemaIdx]
                : "unknown";

            // Last segment is a leaf metric (has a value), rest are composition
            const isLeaf = i === metricSegments.length - 1;

            if (!this.objects.has(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    segment,
                    typeElementId,
                    parentId,
                    !isLeaf,  // isComposition: true for branches, false for leaves
                );
                this.objects.set(elementId, obj);

                // Track parent -> children
                if (!this.children.has(parentId)) {
                    this.children.set(parentId, new Set());
                }
                this.children.get(parentId)!.add(elementId);
            }

            parentId = elementId;
        }

        // Return the leaf elementId (last in the chain)
        return parentId;
    }

    /* ---- Private ---- */

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
        pathPrefix: string = "",
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

            if (!this.objects.has(elementId)) {
                const obj = toI3xObject(
                    elementId,
                    key,
                    typeElementId,
                    parentId,
                    !isLeaf,
                );
                this.objects.set(elementId, obj);

                if (!this.children.has(parentId)) {
                    this.children.set(parentId, new Set());
                }
                this.children.get(parentId)!.add(elementId);
            }

            // Store InfluxDB query metadata for leaf metrics
            if (isLeaf) {
                // The "path" tag in InfluxDB is everything EXCEPT the metric name.
                // e.g. for "Phases/1/True_RMS_Current", path="Phases/1", name="True_RMS_Current"
                const pathParts = currentPath.split("/");
                const metricName = pathParts.pop()!;
                const metricPath = pathParts.join("/");

                this.metricMeta.set(elementId, {
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

    private async loadDevices(): Promise<void> {
        this.logger.debug?.("loadDevices: fetching Device class members from ConfigDB...");
        const deviceUuids: string[] = await this.fplus.ConfigDB.class_members(DEVICE_CLASS_UUID);
        this.logger.debug?.({ count: deviceUuids.length }, "loadDevices: found devices");

        // Track unique schema UUIDs so we create ObjectTypes for them
        const schemaUuids = new Set<string>();

        for (const uuid of deviceUuids) {
            this.logger.debug?.({ uuid }, "loadDevices: fetching DeviceInformation config");

            // Fetch DeviceInformation app config — contains Schema_UUID,
            // Instance_UUID, ISA-95 hierarchy, and the full originMap.
            const [devInfo, nameInfo] = await Promise.all([
                this.fplus.ConfigDB.get_config(DEVICE_INFORMATION_APP_UUID, uuid).catch(() => null),
                this.fplus.ConfigDB.get_config(INFO_APP_UUID, uuid).catch(() => null),
            ]);

            if (!devInfo) {
                this.logger.debug?.({ uuid }, "loadDevices: no DeviceInformation config, skipping");
                continue;
            }

            // Schema_UUID from the DeviceInformation config
            const schemaUuid = devInfo.schema ?? devInfo.originMap?.Schema_UUID;
            if (!schemaUuid) {
                this.logger.debug?.({ uuid }, "loadDevices: no Schema_UUID found, skipping");
                continue;
            }
            schemaUuids.add(schemaUuid);

            // Instance_UUID from the originMap
            const instanceUuid = devInfo.originMap?.Instance_UUID;
            if (instanceUuid) {
                this.instanceToDevice.set(instanceUuid, uuid);
                this.deviceToInstance.set(uuid, instanceUuid);
                this.logger.debug?.({ uuid, instanceUuid }, "loadDevices: registered Instance↔ConfigDB mapping");
            }

            // Find ISA-95 hierarchy by searching for the Hierarchy-v1 Schema_UUID
            const hierarchyObj = this.findBySchemaUuid(devInfo.originMap, HIERARCHY_SCHEMA_UUID);
            const isa95Segments = hierarchyObj ? this.extractIsa95Segments(hierarchyObj) : [];

            if (isa95Segments.length === 0) {
                // Default to <namespace>/Unknown for devices without ISA-95
                isa95Segments.push(this.namespaceName, "Unknown");
                this.logger.debug?.({ uuid }, "loadDevices: no ISA-95 found, placing under Unknown");
            } else {
                this.logger.debug?.({ uuid, isa95: isa95Segments }, "loadDevices: ISA-95 hierarchy found");
            }

            // Display name: prefer Info app name, then sparkplugName from config
            const displayName = nameInfo?.name ?? devInfo.sparkplugName ?? uuid;

            // Create the device object — initially at "/" (re-parented below if ISA-95 exists)
            const obj = toI3xObject(
                uuid,
                displayName,
                schemaUuid,
                "/",
                true,
            );
            this.objects.set(uuid, obj);

            // Place under ISA-95 hierarchy if available
            if (isa95Segments.length > 0) {
                this.ensureIsa95Hierarchy(isa95Segments, uuid);
            }

            // Build the full metric tree from the originMap
            if (devInfo.originMap && instanceUuid) {
                this.buildTreeFromOriginMap(devInfo.originMap, uuid, instanceUuid);
                this.collectSchemaUuids(devInfo.originMap, schemaUuids);
                this.logger.debug?.({ uuid, children: this.getChildElementIds(uuid).length },
                    "loadDevices: built metric tree from originMap");
            }
        }

        // For each unique schema, get its JSON schema definition and create ObjectType
        this.logger.debug?.({ count: schemaUuids.size }, "loadDevices: loading schemas for unique device types");
        for (const schemaUuid of schemaUuids) {
            if (this.objectTypes.has(schemaUuid)) continue;

            this.logger.debug?.({ schemaUuid }, "loadDevices: fetching schema definition");
            const [schema, info] = await Promise.all([
                this.fplus.ConfigDB.get_config(CONFIG_SCHEMA_APP_UUID, schemaUuid).catch(() => null),
                this.fplus.ConfigDB.get_config(INFO_APP_UUID, schemaUuid).catch(() => null),
            ]);
            const displayName = info?.name ?? schema?.title ?? schemaUuid;
            const objType = toI3xObjectType(
                schemaUuid,
                displayName,
                this.namespaceUri,
                schemaUuid,
                schema ?? {},
            );
            this.objectTypes.set(schemaUuid, objType);
            this.logger.debug?.({ schemaUuid, displayName }, "loadDevices: created ObjectType");
        }

        this.logger.debug?.({
            devices: this.objects.size,
            types: this.objectTypes.size,
        }, "loadDevices: complete");
    }
}
