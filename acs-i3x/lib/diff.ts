/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Pure diff dispatcher for the reactive ObjectTree pipeline.
 *
 * Compares two consecutive PipelineSnapshots and dispatches synchronous
 * mutations on the live ObjectTree snapshot. Schemas are reconciled
 * before devices so newly-added device subtrees can reference their
 * ObjectTypes; removed schemas are deleted after devices so dangling
 * references aren't created mid-mutation.
 */

import { ObjectTree, PipelineSnapshot } from "./object-tree.js";

/**
 * Apply the difference between `prev` and `next` to `tree` as a series
 * of synchronous mutations. Caller is responsible for any post-apply
 * work (e.g. RAG rebuild) and for surfacing errors to the user.
 */
export function applyDiff (
    prev: PipelineSnapshot,
    next: PipelineSnapshot,
    tree: ObjectTree,
): void {
    // --- Schemas: add and update (remove later, after devices) ---
    for (const [uuid, { schema, info }] of next.schemas) {
        const old = prev.schemas.get(uuid);
        if (!old) {
            tree.addObjectType(uuid, schema, info);
        } else if (!configEqual(old.schema, schema)
                || old.info?.name !== info?.name) {
            tree.updateObjectType(uuid, schema, info);
        }
    }

    // --- Devices: add / replace / rename / remove ---
    for (const [uuid, { devInfo, info }] of next.devices) {
        const old = prev.devices.get(uuid);
        if (!old) {
            tree.addDevice(uuid, devInfo, info);
            continue;
        }
        if (!configEqual(old.devInfo, devInfo)) {
            tree.replaceDeviceSubtree(uuid, devInfo, info);
        } else if (old.info?.name !== info?.name) {
            const displayName = info?.name
                ?? devInfo?.sparkplugName
                ?? uuid;
            tree.updateDeviceName(uuid, displayName);
        }
    }
    for (const uuid of prev.devices.keys()) {
        if (!next.devices.has(uuid)) {
            tree.removeDevice(uuid);
        }
    }

    // --- Schemas: remove (last, so device removals don't dangle) ---
    for (const uuid of prev.schemas.keys()) {
        if (!next.schemas.has(uuid)) {
            tree.removeObjectType(uuid);
        }
    }
}

/**
 * Deep equality via JSON stringification. Adequate for ConfigDB entry
 * bodies, which are small JSON objects (a few KB at most); cheaper to
 * keep than to bring in immutable.js for this one comparison.
 */
export function configEqual (a: any, b: any): boolean {
    if (a === b) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}
