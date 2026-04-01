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
        this.buildNamespace();
        this.buildRelationshipTypes();
        await this.loadDevices();
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

    /* ---- UNS composition ---- */

    /**
     * Register a mapping from a device's Instance_UUID to its ConfigDB UUID.
     * Called when we first see a UNS message for a device.
     */
    registerDeviceInstance(instanceUuid: string, configDbUuid: string): void {
        this.instanceToDevice.set(instanceUuid, configDbUuid);
    }

    addCompositionFromUns(
        _deviceUuid: string,
        instanceUuidPath: string[],
        schemaUuidPath: string[],
        metricSegments: string[],
    ): string | null {
        // Resolve the device Instance_UUID to ConfigDB UUID.
        const deviceInstanceUuid = instanceUuidPath[0];
        let deviceConfigDbUuid = this.instanceToDevice.get(deviceInstanceUuid);

        // Auto-detect mapping on first encounter.
        // Match any unmatched root device object.
        // TODO: For multiple devices, match using Sparkplug device address
        // from the UNS topic via Directory lookup.
        if (!deviceConfigDbUuid) {
            for (const obj of this.objects.values()) {
                if (obj.parentId === "/"
                    && !Array.from(this.instanceToDevice.values()).includes(obj.elementId)) {
                    this.instanceToDevice.set(deviceInstanceUuid, obj.elementId);
                    deviceConfigDbUuid = obj.elementId;
                    break;
                }
            }
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
        const deviceUuids: string[] = await this.fplus.ConfigDB.class_members(DEVICE_CLASS_UUID);

        // For each device, get its class via the Registration app
        const classMap = new Map<string, string>(); // deviceUuid -> classUuid
        const classUuids = new Set<string>();

        for (const uuid of deviceUuids) {
            const reg = await this.fplus.ConfigDB.get_config(REGISTRATION_APP_UUID, uuid);
            if (reg?.class) {
                classMap.set(uuid, reg.class);
                classUuids.add(reg.class);
            }
        }

        // For each unique class, get its JSON schema and create ObjectType
        for (const classUuid of classUuids) {
            if (this.objectTypes.has(classUuid)) continue;

            const schema = await this.fplus.ConfigDB.get_config(CONFIG_SCHEMA_APP_UUID, classUuid);
            const objType = toI3xObjectType(
                classUuid,
                classUuid, // use class UUID as displayName for now
                this.namespaceUri,
                classUuid,
                schema ?? {},
            );
            this.objectTypes.set(classUuid, objType);
        }

        // For each device, get Directory info and create Object
        for (const uuid of deviceUuids) {
            const classUuid = classMap.get(uuid);
            if (!classUuid) continue;

            // Get directory info (we don't currently use it in the object,
            // but we call it as specified)
            await this.fplus.Directory.get_device_info(uuid);

            const obj = toI3xObject(
                uuid,
                uuid, // use device UUID as displayName for now
                classUuid,
                "/",    // root objects have parentId "/" per i3X convention
                true,   // isComposition
            );
            this.objects.set(uuid, obj);
        }
    }
}
