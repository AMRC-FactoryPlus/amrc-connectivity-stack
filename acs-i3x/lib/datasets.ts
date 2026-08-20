/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * DatasetStore — exposes Data Access datasets as i3X objects.
 *
 * Data Access datasets live in the ConfigDB: membership of the Dataset
 * class, with the structure held in one per-type App entry
 * (SparkplugSrc, SessionLimits or UnionComponents). This store watches
 * the class membership and serves each dataset as an i3X object under
 * a synthetic "Datasets" folder, with:
 *
 *   - /value    → a descriptor: the dataset type, its structure, and a
 *                 DCAT-shaped `content` block pointing at the Data
 *                 Access export. The time series itself stays out of
 *                 band — i3X serves the metadata, Data Access serves
 *                 the payload. (The i3X history shape is one metric
 *                 per object, so a multi-metric dataset cannot be
 *                 served conformantly through /history.)
 *   - /related  → HasComponent resolves a union's members and a
 *                 session window's source dataset, so the dataset
 *                 graph is walkable over pure i3X.
 *
 * Structure configs are fetched on demand rather than held in memory:
 * union membership grows while a dataset is live, and a per-request
 * read is always current. Class membership itself is cheap to poll and
 * is refreshed on a timer (notify-driven refresh can replace this the
 * same way L1 was resolved for devices).
 *
 * Deliberately separate from ObjectTree: the device pipeline (reactive
 * refresh, UNS preservation, diffing) stays untouched, and the API
 * layer consults this store as a fallback.
 */

import { v5 as uuidv5 } from "uuid";

import type { I3xObject, I3xObjectType, I3xVqt } from "./types/i3x.js";
import { toI3xObject, toI3xObjectType, toI3xVqt } from "./mapping.js";
import {
    RelType,
    DATASET_CLASS_UUID,
    DATASET_APP_SPARKPLUG_SRC,
    DATASET_APP_SESSION_LIMITS,
    DATASET_APP_UNION_COMPONENTS,
    I3X_UUID_NAMESPACE,
} from "./constants.js";

export type DatasetType = "SparkplugSrc" | "SessionLimits" | "Union";

/** Synthetic elementIds, deterministic so restarts keep identity. */
export const DATASET_OBJECTTYPE_ID =
    uuidv5("i3x:objecttype:dataset", I3X_UUID_NAMESPACE);
export const DATASET_FOLDER_ID =
    uuidv5("i3x:folder:datasets", I3X_UUID_NAMESPACE);

/** JSON schema for the Dataset ObjectType (the /value descriptor). */
const DATASET_SCHEMA = {
    title: "Dataset",
    description: "A Data Access dataset: a named, typed collection of "
        + "recorded time-series data. The value is a descriptor; the "
        + "content block points at the export.",
    type: "object",
    properties: {
        datasetType: { enum: ["SparkplugSrc", "SessionLimits", "Union"] },
        source: {
            type: "string", format: "uuid",
            description: "SparkplugSrc: the device recorded. "
                + "SessionLimits: the dataset the window is over.",
        },
        coverage: {
            type: "object",
            properties: {
                from: { type: ["string", "null"], format: "date-time" },
                to: { type: ["string", "null"], format: "date-time" },
            },
        },
        members: {
            type: "array", items: { type: "string", format: "uuid" },
            description: "Union: the component dataset UUIDs, "
                + "resolved recursively at export.",
        },
        content: {
            type: "object",
            description: "Where and how to fetch the recorded data.",
            properties: {
                href: { type: "string", format: "uri" },
                method: { type: "string" },
                mediaType: { type: "string" },
                profile: { type: "string" },
                auth: { enum: ["basic", "none"] },
            },
        },
    },
    required: ["datasetType"],
} as const;

interface DatasetStoreOpts {
    fplus: any;
    namespaceUri: string;
    /** Public base URL of the Data Access service, for content hrefs.
     *  Omitted → descriptors carry no content block. */
    dataAccessUrl?: string;
    /** Membership re-poll interval in ms; 0 disables the timer. */
    pollInterval?: number;
    /** Resolves elementIds outside this store (the device tree), so a
     *  SparkplugSrc dataset's HasComponent can return its device. */
    resolve?: (elementId: string) => I3xObject | undefined;
}

export class DatasetStore {
    private fplus: any;
    private namespaceUri: string;
    private dataAccessUrl: string | null;
    private pollInterval: number;
    private log: (msg: string, ...args: any[]) => void;

    private resolve: (elementId: string) => I3xObject | undefined;
    private folder: I3xObject;
    private objectType: I3xObjectType;
    private types: Map<string, DatasetType> = new Map();
    private objects: Map<string, I3xObject> = new Map();
    private timer: NodeJS.Timeout | null = null;

    constructor (opts: DatasetStoreOpts) {
        this.fplus = opts.fplus;
        this.namespaceUri = opts.namespaceUri;
        this.dataAccessUrl = opts.dataAccessUrl?.replace(/\/+$/, "") ?? null;
        this.pollInterval = opts.pollInterval ?? 60000;
        this.resolve = opts.resolve ?? (() => undefined);
        this.log = opts.fplus.debug?.bound?.("datasets")
            ?? ((..._a: any[]) => {});

        this.folder = toI3xObject(
            DATASET_FOLDER_ID, "Datasets", "isa95-level", "/", true);
        this.objectType = toI3xObjectType(
            DATASET_OBJECTTYPE_ID, "Dataset", this.namespaceUri,
            DATASET_CLASS_UUID, DATASET_SCHEMA);
    }

    async init (): Promise<this> {
        await this.load();
        if (this.pollInterval > 0) {
            this.timer = setInterval(
                () => void this.load().catch(err =>
                    this.log("dataset reload failed: %s", err)),
                this.pollInterval);
            this.timer.unref?.();
        }
        return this;
    }

    stop (): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /**
     * Rebuild the membership maps: which UUIDs are datasets, and which
     * structure app each one carries. Three list calls, no per-dataset
     * fetches. Swapped in atomically, same discipline as ObjectTree.
     */
    private async load (): Promise<void> {
        const cdb = this.fplus.ConfigDB;
        const [members, spark, sessions, unions] = await Promise.all([
            cdb.class_members(DATASET_CLASS_UUID).catch(() => []),
            cdb.list_configs(DATASET_APP_SPARKPLUG_SRC).catch(() => []),
            cdb.list_configs(DATASET_APP_SESSION_LIMITS).catch(() => []),
            cdb.list_configs(DATASET_APP_UNION_COMPONENTS).catch(() => []),
        ]);
        const typeOf = new Map<string, DatasetType>();
        for (const u of spark) typeOf.set(u, "SparkplugSrc");
        for (const u of sessions) typeOf.set(u, "SessionLimits");
        for (const u of unions) typeOf.set(u, "Union");

        const types = new Map<string, DatasetType>();
        const objects = new Map<string, I3xObject>();
        for (const uuid of members as string[]) {
            const type = typeOf.get(uuid);
            if (!type) continue;   // dataset with no structure yet
            types.set(uuid, type);
            objects.set(uuid, toI3xObject(
                uuid,
                `${type} dataset ${uuid.slice(0, 8)}`,
                DATASET_OBJECTTYPE_ID,
                DATASET_FOLDER_ID,
                false));
        }
        this.types = types;
        this.objects = objects;
        this.log("datasets loaded: %d of %d class members typed",
            objects.size, (members as string[]).length);
    }

    /* ---- Store surface consulted by the API layer ---- */

    has (elementId: string): boolean {
        return this.objects.has(elementId)
            || elementId === DATASET_FOLDER_ID;
    }

    getObject (elementId: string): I3xObject | undefined {
        if (elementId === DATASET_FOLDER_ID) return this.folder;
        return this.objects.get(elementId);
    }

    getObjects (opts?: { typeElementId?: string; root?: boolean }): I3xObject[] {
        if (opts?.typeElementId !== undefined
            && opts.typeElementId !== DATASET_OBJECTTYPE_ID) return [];
        if (opts?.root) {
            return opts?.typeElementId === undefined ? [this.folder] : [];
        }
        const all = [...this.objects.values()];
        return opts?.typeElementId === undefined
            ? [this.folder, ...all] : all;
    }

    getObjectType (): I3xObjectType {
        return this.objectType;
    }

    /**
     * The dataset's /value: a descriptor of what it is plus where the
     * recorded data can be fetched. Reads the structure config fresh so
     * a growing union is always current.
     */
    async getValue (elementId: string): Promise<I3xVqt | null> {
        const type = this.types.get(elementId);
        if (!type) return null;
        const cdb = this.fplus.ConfigDB;
        const value: Record<string, unknown> = { datasetType: type };

        if (type === "SparkplugSrc") {
            const cfg = await cdb.get_config(
                DATASET_APP_SPARKPLUG_SRC, elementId).catch(() => null);
            if (cfg?.source) value.source = cfg.source;
            value.coverage = { from: null, to: null };
        }
        else if (type === "SessionLimits") {
            const cfg = await cdb.get_config(
                DATASET_APP_SESSION_LIMITS, elementId).catch(() => null);
            if (cfg?.source) value.source = cfg.source;
            value.coverage = { from: cfg?.from ?? null, to: cfg?.to ?? null };
        }
        else {
            const cfg = await cdb.get_config(
                DATASET_APP_UNION_COMPONENTS, elementId).catch(() => null);
            value.members = Array.isArray(cfg) ? cfg : [];
        }

        if (this.dataAccessUrl) {
            value.content = {
                href: `${this.dataAccessUrl}/v1/data/${elementId}`,
                method: "POST",
                mediaType: "application/zip",
                profile: "csv-per-device",
                auth: "basic",
            };
        }
        return toI3xVqt(value, "Good", new Date());
    }

    /**
     * HasParent/HasChildren mirror the folder tree. HasComponent
     * resolves what the dataset is made of: a union's members, or a
     * session window's source dataset. ComponentOf is not served (a
     * reverse index over every union would be needed; the export path
     * resolves forwards only, so does this).
     */
    async getRelated (elementId: string, relationshipType?: string):
            Promise<I3xObject[] | null> {
        if (elementId === DATASET_FOLDER_ID) {
            const result: I3xObject[] = [];
            if (relationshipType === undefined
                || relationshipType === RelType.HasChildren)
                result.push(...this.objects.values());
            return result;
        }
        const type = this.types.get(elementId);
        if (!type) return null;

        const result: I3xObject[] = [];
        if (relationshipType === undefined
            || relationshipType === RelType.HasParent)
            result.push(this.folder);

        if (relationshipType === undefined
            || relationshipType === RelType.HasComponent) {
            const cdb = this.fplus.ConfigDB;
            const componentIds: string[] = [];
            if (type === "Union") {
                const cfg = await cdb.get_config(
                    DATASET_APP_UNION_COMPONENTS, elementId).catch(() => null);
                if (Array.isArray(cfg)) componentIds.push(...cfg);
            }
            else {
                /* A session window's component is its source dataset;
                 * a device stream's component is the device itself. */
                const app = type === "SessionLimits"
                    ? DATASET_APP_SESSION_LIMITS : DATASET_APP_SPARKPLUG_SRC;
                const cfg = await cdb.get_config(app, elementId)
                    .catch(() => null);
                if (cfg?.source) componentIds.push(cfg.source);
            }
            for (const id of componentIds) {
                const obj = this.objects.get(id) ?? this.resolve(id);
                if (obj) result.push(obj);
            }
        }
        return result;
    }
}
