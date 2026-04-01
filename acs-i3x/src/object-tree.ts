/*
 * ObjectTree — Constructs and maintains the i3X object graph from
 * Factory+ services (ConfigDB + Directory).
 *
 * All Explore endpoints serve data from this tree.
 */

import type {
    I3xNamespace,
    I3xObjectType,
    I3xObject,
    I3xRelationshipType,
} from "./types/i3x.js";

import { RelType } from "./constants.js";
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
        this.instanceToDevice.clear();
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
            all = all.filter(o => o.parentId === null);
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
            if (obj.parentId !== null) {
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
        displayNames: string[],
    ): void {
        // Index 0 is the device's Instance_UUID. Resolve to ConfigDB UUID
        // so the parent chain connects to the device object in the tree.
        const deviceInstanceUuid = instanceUuidPath[0];
        let deviceConfigDbUuid = this.instanceToDevice.get(deviceInstanceUuid);

        // Auto-detect mapping: if we haven't seen this Instance_UUID before,
        // find the matching root device object.
        // TODO: This heuristic matches on schema type — won't work correctly
        // if multiple devices share the same top-level schema. Fix by using
        // the Sparkplug device address from UNS topic to match via Directory.
        if (!deviceConfigDbUuid) {
            const deviceSchemaUuid = schemaUuidPath[0];
            for (const obj of this.objects.values()) {
                if (obj.parentId === null
                    && !this.instanceToDevice.has(obj.elementId)
                    && obj.typeElementId === deviceSchemaUuid) {
                    this.instanceToDevice.set(deviceInstanceUuid, obj.elementId);
                    deviceConfigDbUuid = obj.elementId;
                    break;
                }
            }
        }

        // Index 0 is the device itself, already in tree. Start from 1.
        for (let i = 1; i < instanceUuidPath.length; i++) {
            const elementId = instanceUuidPath[i];

            // Idempotent: skip if already exists
            if (this.objects.has(elementId)) continue;

            const rawParentId = instanceUuidPath[i - 1];
            // For the first child (i=1), parent is the device — use ConfigDB UUID
            const parentId = (i === 1 && deviceConfigDbUuid) ? deviceConfigDbUuid : rawParentId;
            const typeElementId = schemaUuidPath[i];
            const displayName = displayNames[i];

            const obj = toI3xObject(
                elementId,
                displayName,
                typeElementId,
                parentId,
                true,
            );

            this.objects.set(elementId, obj);

            // Track parent -> children
            if (!this.children.has(parentId)) {
                this.children.set(parentId, new Set());
            }
            this.children.get(parentId)!.add(elementId);
        }
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
                null,   // top-level: no parent
                true,   // isComposition
            );
            this.objects.set(uuid, obj);
        }
    }
}
