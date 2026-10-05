/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Loads an ObjectTree from a mock fplus (createMockFplus) the way the
 * removed ObjectTree.init() HTTP bootstrap did: list the Device class,
 * fetch each device's DeviceInformation and Info, then every schema
 * those originMaps reference. The tree now gets its state from the
 * sync engine; tests that set up ConfigDB with mocks use this to put
 * the same state in through refreshFromSnapshot.
 */

import type { ObjectTree, PipelineSnapshot } from "../../lib/object-tree.js";
import {
    DEVICE_CLASS_UUID,
    DEVICE_INFORMATION_APP_UUID,
    INFO_APP_UUID,
    SCHEMA_APP_UUID,
} from "../../lib/constants.js";

function collectSchemaUuids(obj: any, out: Set<string>): void {
    if (obj == null || typeof obj !== "object") return;
    if (typeof obj.Schema_UUID === "string" && obj.Schema_UUID !== "") out.add(obj.Schema_UUID);
    for (const v of Object.values(obj)) collectSchemaUuids(v, out);
}

export async function snapshotFromMock(fplus: any): Promise<PipelineSnapshot> {
    const cdb = fplus.ConfigDB;
    const get = (app: string, obj: string) => cdb.get_config(app, obj).catch(() => null);

    const devices: PipelineSnapshot["devices"] = new Map();
    const schemaUuids = new Set<string>();
    for (const uuid of await cdb.class_members(DEVICE_CLASS_UUID)) {
        const [devInfo, info] = await Promise.all([
            get(DEVICE_INFORMATION_APP_UUID, uuid),
            get(INFO_APP_UUID, uuid),
        ]);
        devices.set(uuid, { devInfo, info });
        const top = devInfo?.schema ?? devInfo?.originMap?.Schema_UUID;
        if (!top) continue;
        schemaUuids.add(top);
        collectSchemaUuids(devInfo.originMap, schemaUuids);
    }

    const schemas: PipelineSnapshot["schemas"] = new Map();
    for (const uuid of schemaUuids) {
        const [schema, info] = await Promise.all([
            get(SCHEMA_APP_UUID, uuid),
            get(INFO_APP_UUID, uuid),
        ]);
        schemas.set(uuid, { schema, info });
    }
    return { devices, schemas };
}

/** Load (or reload) `tree` from the mock ConfigDB. */
export async function loadFromMock(tree: ObjectTree, fplus: any): Promise<ObjectTree> {
    await tree.init();
    tree.refreshFromSnapshot(await snapshotFromMock(fplus));
    return tree;
}
