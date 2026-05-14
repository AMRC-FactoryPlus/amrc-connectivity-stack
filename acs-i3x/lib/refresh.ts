/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ObjectTree refresh — reactive pipeline driven by ConfigDB notify-v2.
 *
 * Subscribes to: the Device class members, each device's DeviceInformation
 * and Info configs, and each referenced schema's ConfigSchema and Info
 * configs. Combines them into a single emission stream and asks
 * ObjectTree to rebuild from that pre-fetched state. notify-v2 multiplexes
 * all WATCH requests over one shared WebSocket, and the per-config watch
 * is wrapped in rxx.cacheSeq so duplicate subscribers to the same (app,
 * obj) URL share one underlying WATCH (kept stable across switchMap
 * restarts).
 */

import * as rx                  from "rxjs";
import * as rxx                 from "@amrc-factoryplus/rx-util";

import {
    DEVICE_INFORMATION_APP_UUID,
    DEVICE_CLASS_UUID,
    INFO_APP_UUID,
    CONFIG_SCHEMA_APP_UUID,
} from "./constants.js";
import { ObjectTree, PipelineSnapshot } from "./object-tree.js";
import { I3xRag } from "./rag/i3x-rag.js";

/** Minimal duck-typed shape we need from an immutable.js Set. */
interface ImmSetLike<T> {
    isEmpty(): boolean;
    [Symbol.iterator](): IterableIterator<T>;
}

export interface RefreshOpts {
    fplus: any;
    objectTree: ObjectTree;
    i3xRag: I3xRag;
}

export class ObjectTreeRefresh {
    private fplus: any;
    private objectTree: ObjectTree;
    private i3xRag: I3xRag;
    private log: (msg: string, ...args: any[]) => void;

    constructor (opts: RefreshOpts) {
        this.fplus = opts.fplus;
        this.objectTree = opts.objectTree;
        this.i3xRag = opts.i3xRag;
        this.log = opts.fplus.debug.bound("refresh");
    }

    async run () {
        const cdb = this.fplus.ConfigDB;

        // Cached per-config watch. Keyed by `${app}:${obj}` so identical
        // URLs share one WATCH request and survive switchMap restarts.
        const watch_config = rxx.cacheSeq({
            factory: (key: string) => {
                const [app, obj] = key.split(":");
                return cdb.watch_config(app, obj);
            },
            replay: true,
        });

        const watch_device = (uuid: string): rx.Observable<{ uuid: string; devInfo: any; info: any }> =>
            rx.combineLatest([
                watch_config(`${DEVICE_INFORMATION_APP_UUID}:${uuid}`) as rx.Observable<any>,
                watch_config(`${INFO_APP_UUID}:${uuid}`) as rx.Observable<any>,
            ]).pipe(rx.map(([devInfo, info]) => ({ uuid, devInfo, info })));

        const watch_schema = (uuid: string): rx.Observable<{ uuid: string; schema: any; info: any }> =>
            rx.combineLatest([
                watch_config(`${CONFIG_SCHEMA_APP_UUID}:${uuid}`) as rx.Observable<any>,
                watch_config(`${INFO_APP_UUID}:${uuid}`) as rx.Observable<any>,
            ]).pipe(rx.map(([schema, info]) => ({ uuid, schema, info })));

        type DeviceMap = Map<string, { devInfo: any; info: any }>;

        // Stage 1: device set → per-device configs
        const devices$: rx.Observable<DeviceMap> = (cdb.watch_members(DEVICE_CLASS_UUID) as rx.Observable<ImmSetLike<string>>).pipe(
            rx.switchMap((uuids: ImmSetLike<string>) => {
                if (uuids.isEmpty()) return rx.of(new Map() as DeviceMap);
                const arr = [...uuids].map(watch_device);
                return rx.combineLatest(arr).pipe(
                    rx.map(devs => new Map(devs.map(d =>
                        [d.uuid, { devInfo: d.devInfo, info: d.info }])) as DeviceMap));
            }),
        );

        // Stage 2: collect referenced schemas → per-schema configs
        const pipeline$: rx.Observable<PipelineSnapshot> = devices$.pipe(
            rx.switchMap((devices: DeviceMap) => {
                const schemaUuids = this.collectAllSchemaUuids(devices);
                if (schemaUuids.size === 0) {
                    return rx.of({ devices, schemas: new Map() } as PipelineSnapshot);
                }
                const arr = [...schemaUuids].map(watch_schema);
                return rx.combineLatest(arr).pipe(
                    rx.map(schemas => ({
                        devices,
                        schemas: new Map(schemas.map(s =>
                            [s.uuid, { schema: s.schema, info: s.info }])),
                    } as PipelineSnapshot)));
            }),
        );

        // A `pending` slot coalesces emissions during an in-flight rebuild
        // — the latest emission wins, intermediate ones are discarded.
        let inFlight = false;
        let pending: PipelineSnapshot | null = null;

        const apply = async (first: PipelineSnapshot) => {
            inFlight = true;
            try {
                let next: PipelineSnapshot | null = first;
                while (next) {
                    const emission = next;
                    next = null;
                    await this.objectTree.refreshFromSnapshot(emission);
                    this.i3xRag.rebuild();
                    this.log("object tree refreshed: nodes=%d",
                        this.i3xRag.nodeCount());
                    if (pending) {
                        next = pending;
                        pending = null;
                    }
                }
            } catch (err) {
                console.error("Failed to refresh object tree:", err);
            } finally {
                inFlight = false;
            }
        };

        pipeline$.subscribe({
            next: (emission: PipelineSnapshot) => {
                if (inFlight) { pending = emission; return; }
                void apply(emission);
            },
            error: (err: unknown) =>
                console.error("ConfigDB pipeline errored:", err),
        });

        this.log("ConfigDB pipeline active");
    }

    private collectAllSchemaUuids (devices: Map<string, any>): Set<string> {
        const out = new Set<string>();
        for (const { devInfo } of devices.values()) {
            if (devInfo == null) continue;
            const top = devInfo.schema ?? devInfo.originMap?.Schema_UUID;
            if (top) out.add(top);
            this.collectSchemaUuids(devInfo.originMap, out);
        }
        return out;
    }

    private collectSchemaUuids (obj: any, target: Set<string>): void {
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
}
