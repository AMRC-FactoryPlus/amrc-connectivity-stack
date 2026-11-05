/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Devices in production get their ISA-95 position from their placement
 * (lib/placements.ts). Most tests here still describe a device by the
 * hierarchy in its origin map, which is what the service-setup
 * migration turns into a placement. These helpers give such a device
 * the position that placement would have.
 */

import * as rx from "rxjs";
// @ts-ignore - plain JS, no declaration for this function
import { isa95_segments } from "@amrc-factoryplus/service-client";

import { ObjectTree } from "../../lib/object-tree.js";
import type { PipelineSnapshot } from "../../lib/object-tree.js";
import type { PlacementSource } from "../../lib/placements.js";

/** The position a placement made from this origin map would give. */
export function segs(devInfo: any): string[] {
    return isa95_segments(devInfo?.originMap) ?? [];
}

/** An ObjectTree that places a device from its origin map when the
 * test does not give a position. */
export class TestObjectTree extends ObjectTree {
    addDevice(uuid: string, devInfo: any, info: any, isa95?: string[]): void {
        super.addDevice(uuid, devInfo, info, isa95 ?? segs(devInfo));
    }

    replaceDeviceSubtree(uuid: string, devInfo: any, info: any, isa95?: string[]): void {
        super.replaceDeviceSubtree(uuid, devInfo, info, isa95 ?? segs(devInfo));
    }

    refreshFromSnapshot(input: PipelineSnapshot): void {
        const devices = new Map([...input.devices].map(([uuid, d]) =>
            [uuid, { ...d, isa95: d.isa95 ?? segs(d.devInfo) }]));
        super.refreshFromSnapshot({ ...input, devices });
    }
}

/** A PlacementSource whose positions follow each device's current
 * DeviceInformation, as looked up by `devInfo`. Call `changed` to
 * report devices whose position changed. */
export function originMapPlacements(devInfo: (uuid: string) => any) {
    const subject = new rx.BehaviorSubject<string[]>([]);
    let ready = true;
    const source: PlacementSource & {
        changed(uuids: string[]): void;
        setReady(r: boolean): void;
    } = {
        isReady: () => ready,
        segments: (uuid: string) => {
            const s = segs(devInfo(uuid));
            return s.length ? s : null;
        },
        changes: subject,
        changed: (uuids: string[]) => subject.next(uuids),
        setReady: (r: boolean) => { ready = r; if (r) subject.next([]); },
    };
    return source;
}
