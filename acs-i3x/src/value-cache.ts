/*
 * ValueCache — Subscribes to UNS MQTT topics, maintains an in-memory
 * cache of current values, and notifies subscribers of changes.
 */

import type { I3xVqt, I3xValueResponse } from "./types/i3x.js";
import { deriveQuality } from "./quality.js";
import { toI3xVqt } from "./mapping.js";

interface ValueCacheOpts {
    objectTree: ObjectTreeLike;
    staleThreshold: number;
    logger: any;
}

/**
 * Minimal interface that ValueCache needs from ObjectTree.
 * Using a structural type so we can mock it in tests.
 */
interface ObjectTreeLike {
    addCompositionFromUns(
        deviceUuid: string,
        instanceUuidPath: string[],
        schemaUuidPath: string[],
        metricSegments: string[],
        isa95Segments?: string[],
    ): string | null;
    getObject(elementId: string): { elementId: string; isComposition: boolean } | undefined;
    getChildElementIds(elementId: string): string[];
    isReady(): boolean;
}

type ValueChangeListener = (elementId: string, vqt: I3xVqt) => void;

export class ValueCache {
    private objectTree: ObjectTreeLike;
    private staleThreshold: number;
    private logger: any;

    private ready: boolean = false;
    private cache: Map<string, I3xVqt> = new Map();
    private listeners: Set<ValueChangeListener> = new Set();

    /**
     * Reverse index: parentUuid -> Set of cached leaf element IDs.
     * Allows efficient lookup of all leaf metrics belonging to a
     * composition object.
     */
    private parentToLeaves: Map<string, Set<string>> = new Map();

    constructor(opts: ValueCacheOpts) {
        this.objectTree = opts.objectTree;
        this.staleThreshold = opts.staleThreshold;
        this.logger = opts.logger;
    }

    async init(fplus: any): Promise<this> {
        this.logger.debug?.("ValueCache: requesting MQTT client from ServiceClient...");
        const mqtt = await fplus.mqtt_client();
        this.logger.debug?.("ValueCache: MQTT client obtained, subscribing to UNS/v1/#...");
        mqtt.subscribe("UNS/v1/#");
        mqtt.on("message", (topic: string, payload: Buffer, packet: any) => {
            this.onUnsMessage(topic, payload, packet);
        });
        mqtt.on("connect", () => {
            this.logger.debug?.("ValueCache: MQTT connected");
        });
        mqtt.on("error", (err: any) => {
            this.logger.error?.({ err }, "ValueCache: MQTT error");
        });
        mqtt.on("close", () => {
            this.logger.debug?.("ValueCache: MQTT connection closed");
        });
        this.ready = true;
        this.logger.debug?.("ValueCache: initialised and subscribed");
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

        const instanceUuidPath = instanceUuidPathStr.split(":");
        const schemaUuidPath = schemaUuidPathStr.split(":");
        const deviceUuid = instanceUuidPath[0];
        const bottomUuid = instanceUuidPath[instanceUuidPath.length - 1];

        // Parse payload
        let parsed: { timestamp: string; value: unknown };
        try {
            parsed = JSON.parse(payload.toString());
        } catch {
            this.logger.warn?.("ValueCache: failed to parse payload as JSON");
            return;
        }

        // ISA-95 hierarchy segments (Enterprise, Site, Area, etc.)
        const isa95Segments = parts.slice(isa95Start, edgeIdx);

        // Tell the object tree about the full composition chain.
        // Also passes ISA-95 segments so the tree can create hierarchy above the device.
        // Returns the leaf elementId.
        const elementId = this.objectTree.addCompositionFromUns(
            deviceUuid,
            instanceUuidPath,
            schemaUuidPath,
            metricSegments,
            isa95Segments,
        ) ?? `${bottomUuid}/${metricName}`;

        // Derive quality — for values received from UNS, the device is
        // online and we have a value, so quality is Good.
        const quality = deriveQuality({
            online: true,
            hasValue: true,
            stale: false,
        });

        const vqt = toI3xVqt(parsed.value, quality, parsed.timestamp);

        // Store in cache
        this.cache.set(elementId, vqt);
        this.logger.debug?.({ elementId: elementId.slice(0, 16), value: vqt.value }, "ValueCache: cached UNS value");

        // Track this leaf under its parent (bottom UUID)
        if (!this.parentToLeaves.has(bottomUuid)) {
            this.parentToLeaves.set(bottomUuid, new Set());
        }
        this.parentToLeaves.get(bottomUuid)!.add(elementId);

        // Notify listeners
        this.logger.debug?.({ elementId: elementId.slice(0, 16), listenerCount: this.listeners.size }, "ValueCache: notifying listeners");
        for (const listener of this.listeners) {
            try {
                listener(elementId, vqt);
            } catch (err) {
                this.logger.error?.("ValueCache: listener threw", err);
            }
        }
    }

    /* ---- Query methods ---- */

    getValue(elementId: string): I3xValueResponse | null {
        // Check if it's a direct leaf metric in the cache
        const vqt = this.cache.get(elementId);
        if (vqt) {
            return {
                elementId,
                isComposition: false,
                ...vqt,
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

        // Collect direct leaf metrics cached under this elementId
        const directLeaves = this.parentToLeaves.get(elementId);
        if (directLeaves) {
            for (const leafId of directLeaves) {
                const vqt = this.cache.get(leafId);
                if (vqt) {
                    result[leafId] = vqt;
                }
            }
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
