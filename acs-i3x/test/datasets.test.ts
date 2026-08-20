/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * DatasetStore — Data Access datasets served as i3X objects.
 */

import { jest } from "@jest/globals";

import {
    DatasetStore,
    DATASET_OBJECTTYPE_ID,
    DATASET_FOLDER_ID,
} from "../lib/datasets.js";
import {
    RelType,
    DATASET_CLASS_UUID,
    DATASET_APP_SPARKPLUG_SRC,
    DATASET_APP_SESSION_LIMITS,
    DATASET_APP_UNION_COMPONENTS,
} from "../lib/constants.js";

const MACHINE = "bf62a1c3-8afe-4eaa-af79-12ae88a7384c";
const SESSION = "1539d17f-6111-463a-a92b-592f81e15fd7";
const UNION = "27cb40bf-1fa4-4e69-b0d7-dc933282618b";
const DEVICE = "d2de2fa1-fccf-488a-8ddd-ec3da0e3c909";

/** A ConfigDB shaped like the demo cluster: one device stream, one
 *  session window over it, one union containing the session. */
function mockFplus() {
    const configs: Record<string, Record<string, any>> = {
        [DATASET_APP_SPARKPLUG_SRC]: {
            [MACHINE]: { source: DEVICE },
        },
        [DATASET_APP_SESSION_LIMITS]: {
            [SESSION]: {
                source: MACHINE,
                from: "2026-08-20T08:18:46.729Z",
                to: "2026-08-20T08:23:46.729Z",
            },
        },
        [DATASET_APP_UNION_COMPONENTS]: {
            [UNION]: [SESSION],
        },
    };
    return {
        ConfigDB: {
            class_members: jest.fn(async (klass: string) =>
                klass === DATASET_CLASS_UUID
                    ? [MACHINE, SESSION, UNION, "no-structure-yet"]
                    : []),
            list_configs: jest.fn(async (app: string) =>
                Object.keys(configs[app] ?? {})),
            get_config: jest.fn(async (app: string, obj: string) => {
                const cfg = configs[app]?.[obj];
                if (cfg === undefined) throw new Error("404");
                return cfg;
            }),
        },
        debug: { bound: () => (..._a: any[]) => {} },
        configs,
    };
}

const makeStore = (fplus = mockFplus(), extra = {}) =>
    new DatasetStore({
        fplus,
        namespaceUri: "https://test/i3x",
        dataAccessUrl: "https://da.test/",
        pollInterval: 0,
        ...extra,
    }).init();

test("datasets load as objects under the folder; untyped members are skipped", async () => {
    const store = await makeStore();
    expect(store.getObject(MACHINE)).toMatchObject({
        elementId: MACHINE,
        typeElementId: DATASET_OBJECTTYPE_ID,
        parentId: DATASET_FOLDER_ID,
        isComposition: false,
    });
    expect(store.getObject("no-structure-yet")).toBeUndefined();
    expect(store.getObject(DATASET_FOLDER_ID)).toMatchObject({
        displayName: "Datasets", parentId: "/", isComposition: true });

    const all = store.getObjects();
    expect(all.map(o => o.elementId).sort())
        .toEqual([DATASET_FOLDER_ID, SESSION, MACHINE, UNION].sort());
    expect(store.getObjects({ root: true }))
        .toEqual([store.getObject(DATASET_FOLDER_ID)]);
    expect(store.getObjects({ typeElementId: DATASET_OBJECTTYPE_ID }))
        .toHaveLength(3);
    expect(store.getObjects({ typeElementId: "something-else" }))
        .toEqual([]);
});

test("a device stream's value describes the source and carries the export href", async () => {
    const store = await makeStore();
    const vqt = await store.getValue(MACHINE);
    expect(vqt).toMatchObject({
        quality: "Good",
        value: {
            datasetType: "SparkplugSrc",
            source: DEVICE,
            coverage: { from: null, to: null },
            content: {
                href: `https://da.test/v1/data/${MACHINE}`,
                method: "POST",
                mediaType: "application/zip",
                profile: "csv-per-device",
                auth: "basic",
            },
        },
    });
});

test("a session window's value carries its coverage; a union lists members", async () => {
    const store = await makeStore();
    expect((await store.getValue(SESSION))?.value).toMatchObject({
        datasetType: "SessionLimits",
        source: MACHINE,
        coverage: {
            from: "2026-08-20T08:18:46.729Z",
            to: "2026-08-20T08:23:46.729Z",
        },
    });
    expect((await store.getValue(UNION))?.value).toMatchObject({
        datasetType: "Union",
        members: [SESSION],
    });
    expect(await store.getValue("not-a-dataset")).toBeNull();
});

test("no configured Data Access URL means no content block", async () => {
    const store = await makeStore(mockFplus(), { dataAccessUrl: undefined });
    const vqt = await store.getValue(MACHINE);
    expect((vqt?.value as any).content).toBeUndefined();
});

test("union membership is read fresh, so appends show without a reload", async () => {
    const fplus = mockFplus();
    const store = await makeStore(fplus);
    fplus.configs[DATASET_APP_UNION_COMPONENTS][UNION] = [SESSION, MACHINE];
    expect((await store.getValue(UNION))?.value).toMatchObject({
        members: [SESSION, MACHINE] });
});

test("HasComponent walks the dataset graph down to the device", async () => {
    const store = await makeStore(mockFplus(), {
        resolve: (id: string) => id === DEVICE
            ? { elementId: DEVICE, displayName: "CNC",
                typeElementId: "schema", parentId: "/",
                isComposition: true, isExtended: false }
            : undefined,
    });
    const unionRel = await store.getRelated(UNION, RelType.HasComponent);
    expect(unionRel?.map(o => o.elementId)).toEqual([SESSION]);

    const sessionRel = await store.getRelated(SESSION, RelType.HasComponent);
    expect(sessionRel?.map(o => o.elementId)).toEqual([MACHINE]);

    /* The device stream's component is the device — resolved from the
     * object tree, not the store. */
    const machineRel = await store.getRelated(MACHINE, RelType.HasComponent);
    expect(machineRel?.map(o => o.elementId)).toEqual([DEVICE]);
});

test("unfiltered related includes the folder parent; the folder lists children", async () => {
    const store = await makeStore();
    const rel = await store.getRelated(UNION);
    expect(rel?.some(o => o.elementId === DATASET_FOLDER_ID)).toBe(true);
    const kids = await store.getRelated(DATASET_FOLDER_ID);
    expect(kids?.map(o => o.elementId).sort())
        .toEqual([SESSION, MACHINE, UNION].sort());
    expect(await store.getRelated("not-a-dataset")).toBeNull();
});

test("the Dataset ObjectType carries a real schema", async () => {
    const store = await makeStore();
    const t = store.getObjectType();
    expect(t.elementId).toBe(DATASET_OBJECTTYPE_ID);
    expect((t.schema as any).properties.datasetType.enum)
        .toEqual(["SparkplugSrc", "SessionLimits", "Union"]);
});
