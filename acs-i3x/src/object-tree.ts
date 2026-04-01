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

import { RelType } from "./constants.js";

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
const REGISTRATION_APP_UUID = "cb40bed5-49ad-4443-a7f5-08c75009da8f";
const CONFIG_SCHEMA_APP_UUID = "dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3";
const INFO_APP_UUID = "64a8bfa9-7772-45c4-9d1a-9e6290690957";

interface ObjectTreeOpts {
    fplus: any;
    namespaceName: string;
    namespaceUri: string;
    logger: any;
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

        // For each device, get its class via the Registration app
        const classMap = new Map<string, string>(); // deviceUuid -> classUuid
        const classUuids = new Set<string>();

        for (const uuid of deviceUuids) {
            this.logger.debug?.({ uuid }, "loadDevices: fetching registration for device");
            const reg = await this.fplus.ConfigDB.get_config(REGISTRATION_APP_UUID, uuid);
            if (reg?.class) {
                classMap.set(uuid, reg.class);
                classUuids.add(reg.class);
                this.logger.debug?.({ uuid, class: reg.class }, "loadDevices: device class resolved");
            } else {
                this.logger.debug?.({ uuid }, "loadDevices: no class found for device");
            }
        }

        // For each unique class, get its JSON schema and name, create ObjectType
        this.logger.debug?.({ count: classUuids.size }, "loadDevices: loading schemas for unique classes");
        for (const classUuid of classUuids) {
            if (this.objectTypes.has(classUuid)) continue;

            this.logger.debug?.({ classUuid }, "loadDevices: fetching schema and info for class");
            const [schema, info] = await Promise.all([
                this.fplus.ConfigDB.get_config(CONFIG_SCHEMA_APP_UUID, classUuid).catch(() => null),
                this.fplus.ConfigDB.get_config(INFO_APP_UUID, classUuid).catch(() => null),
            ]);
            const displayName = info?.name ?? schema?.title ?? classUuid;
            this.logger.debug?.({ classUuid, displayName }, "loadDevices: created ObjectType");
            const objType = toI3xObjectType(
                classUuid,
                displayName,
                this.namespaceUri,
                classUuid,
                schema ?? {},
            );
            this.objectTypes.set(classUuid, objType);
        }

        // For each device, get Directory info and name, create Object
        this.logger.debug?.("loadDevices: creating device objects...");
        for (const uuid of deviceUuids) {
            const classUuid = classMap.get(uuid);
            if (!classUuid) continue;

            this.logger.debug?.({ uuid }, "loadDevices: fetching directory info and name");
            const [, info] = await Promise.all([
                this.fplus.Directory.get_device_info(uuid).catch(() => null),
                this.fplus.ConfigDB.get_config(INFO_APP_UUID, uuid).catch(() => null),
            ]);
            const displayName = info?.name ?? uuid;

            const obj = toI3xObject(
                uuid,
                displayName,
                classUuid,
                "/",    // root objects have parentId "/" per i3X convention
                true,   // isComposition
            );
            this.objects.set(uuid, obj);
        }
    }
}
