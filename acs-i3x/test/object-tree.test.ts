/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { jest } from "@jest/globals";
import { ObjectTree } from "../lib/object-tree.js";
import { RelType } from "../lib/constants.js";
import { createMockFplus } from "./helpers/mock-services.js";

const DEVICE_CLASS_UUID = "18773d6d-a70d-443a-b29a-3f1583195290";
const DEVICE_INFORMATION_APP_UUID = "a98ffed5-c613-4e70-bfd3-efeee250ade5";
const INFO_APP_UUID = "64a8bfa9-7772-45c4-9d1a-9e6290690957";
const SCHEMA_APP_UUID = "b16e85fb-53c2-49f9-8d83-cdf6763304ba";
const HIERARCHY_SCHEMA_UUID = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";

const NS_NAME = "Factory+";
const NS_URI = "urn:factoryplus:ns";

function makeTree(fplus?: ReturnType<typeof createMockFplus>) {
    return new ObjectTree({
        fplus: fplus ?? createMockFplus(),
        namespaceName: NS_NAME,
        namespaceUri: NS_URI,
    });
}

/**
 * Helper: set up mock fplus to return two devices with distinct classes and schemas.
 */
function setupMockDevices(fplus: ReturnType<typeof createMockFplus>) {
    const dev1 = "aaaa-1111";
    const dev2 = "bbbb-2222";
    const schema1uuid = "schema-1111";
    const schema2uuid = "schema-2222";
    const instance1 = "inst-1111";
    const instance2 = "inst-2222";
    const schema1 = { type: "object", title: "CNC Machine", properties: { temp: { type: "number" } } };
    const schema2 = { type: "object", title: "Robot", properties: { speed: { type: "number" } } };

    fplus.ConfigDB.class_members.mockResolvedValue([dev1, dev2]);

    fplus.ConfigDB.get_config.mockImplementation(
        (appUuid: string, objectUuid: string) => {
            // DeviceInformation app — returns schema, instanceUUID, ISA-95
            if (appUuid === DEVICE_INFORMATION_APP_UUID) {
                if (objectUuid === dev1) return Promise.resolve({
                    schema: schema1uuid,
                    sparkplugName: "Dev1",
                    originMap: {
                        Schema_UUID: schema1uuid,
                        Instance_UUID: instance1,
                        Device_Information: {
                            Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
                            ISA95_Hierarchy: {
                                Schema_UUID: HIERARCHY_SCHEMA_UUID,
                                Enterprise: { Value: "AMRC" },
                                Site: { Value: "F2050" },
                            },
                        },
                    },
                });
                if (objectUuid === dev2) return Promise.resolve({
                    schema: schema2uuid,
                    sparkplugName: "Dev2",
                    originMap: {
                        Schema_UUID: schema2uuid,
                        Instance_UUID: instance2,
                        Device_Information: {
                            Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
                            ISA95_Hierarchy: {
                                Schema_UUID: HIERARCHY_SCHEMA_UUID,
                                Enterprise: { Value: "AMRC" },
                                Site: { Value: "F2050" },
                            },
                        },
                    },
                });
            }
            // Info app — human-readable names
            if (appUuid === INFO_APP_UUID) {
                if (objectUuid === dev1) return Promise.resolve({ name: "Device 1" });
                if (objectUuid === dev2) return Promise.resolve({ name: "Device 2" });
            }
            // Schema app — JSON schema definitions
            if (appUuid === SCHEMA_APP_UUID) {
                if (objectUuid === schema1uuid) return Promise.resolve(schema1);
                if (objectUuid === schema2uuid) return Promise.resolve(schema2);
            }
            return Promise.resolve(null);
        },
    );

    return { dev1, dev2, class1: schema1uuid, class2: schema2uuid, schema1, schema2, instance1, instance2 };
}

describe("ObjectTree", () => {
    describe("before init", () => {
        it("isReady() returns false", () => {
            const tree = makeTree();
            expect(tree.isReady()).toBe(false);
        });
    });

    describe("after init (empty devices)", () => {
        it("isReady() returns true", async () => {
            const tree = makeTree();
            await tree.init();
            expect(tree.isReady()).toBe(true);
        });

        it("getNamespaces() returns single namespace with correct name/uri", async () => {
            const tree = makeTree();
            await tree.init();
            const namespaces = tree.getNamespaces();
            expect(namespaces).toHaveLength(1);
            expect(namespaces[0]).toEqual({
                uri: NS_URI,
                displayName: NS_NAME,
            });
        });

        it("getRelationshipTypes() returns 4 built-in types with correct reverse relationships", async () => {
            const tree = makeTree();
            await tree.init();
            const relTypes = tree.getRelationshipTypes();
            expect(relTypes).toHaveLength(4);

            const byId = new Map(relTypes.map(rt => [rt.relationshipId, rt]));

            const hasParent = byId.get(RelType.HasParent);
            const hasChildren = byId.get(RelType.HasChildren);
            const hasComponent = byId.get(RelType.HasComponent);
            const componentOf = byId.get(RelType.ComponentOf);

            expect(hasParent).toBeDefined();
            expect(hasChildren).toBeDefined();
            expect(hasComponent).toBeDefined();
            expect(componentOf).toBeDefined();

            expect(hasParent!.reverseOf).toBe(RelType.HasChildren);
            expect(hasChildren!.reverseOf).toBe(RelType.HasParent);
            expect(hasComponent!.reverseOf).toBe(RelType.ComponentOf);
            expect(componentOf!.reverseOf).toBe(RelType.HasComponent);

            // All should belong to our namespace
            for (const rt of relTypes) {
                expect(rt.namespaceUri).toBe(NS_URI);
            }
        });

        it("getRelationshipTypes(namespaceUri) filters by namespace", async () => {
            const tree = makeTree();
            await tree.init();
            expect(tree.getRelationshipTypes(NS_URI)).toHaveLength(4);
            expect(tree.getRelationshipTypes("urn:other:ns")).toHaveLength(0);
        });

        it("getRelationshipType(elementId) returns the correct type", async () => {
            const tree = makeTree();
            await tree.init();
            const relTypes = tree.getRelationshipTypes();
            const first = relTypes[0];
            expect(tree.getRelationshipType(first.elementId)).toEqual(first);
        });

        it("getRelationshipType(nonexistent) returns undefined", async () => {
            const tree = makeTree();
            await tree.init();
            expect(tree.getRelationshipType("nonexistent")).toBeUndefined();
        });
    });

    describe("init with mock devices", () => {
        it("creates correct Objects and ObjectTypes from ConfigDB/Directory", async () => {
            const fplus = createMockFplus();
            const { dev1, dev2, class1, class2, schema1, schema2 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            // Verify ConfigDB was called correctly
            expect(fplus.ConfigDB.class_members).toHaveBeenCalledWith(DEVICE_CLASS_UUID);

            // Verify device-level object types were created
            const types = tree.getObjectTypes();
            expect(types.length).toBeGreaterThanOrEqual(2);
            const type1 = tree.getObjectType(class1);
            expect(type1).toBeDefined();
            expect(type1!.schema).toEqual(schema1);
            expect(type1!.namespaceUri).toBe(NS_URI);
            const type2 = tree.getObjectType(class2);
            expect(type2).toBeDefined();
            expect(type2!.schema).toEqual(schema2);

            // Verify device objects were created with full metric tree
            const objects = tree.getObjects();
            expect(objects.length).toBeGreaterThanOrEqual(4); // devices + ISA-95 + metric tree

            const obj1 = tree.getObject(dev1);
            expect(obj1).toBeDefined();
            expect(obj1!.typeElementId).toBe(class1);
            expect(obj1!.parentId).not.toBe("/"); // nested under ISA-95
            expect(obj1!.isComposition).toBe(true);
            // Device should have children from originMap
            expect(tree.getChildElementIds(dev1).length).toBeGreaterThan(0);

            const obj2 = tree.getObject(dev2);
            expect(obj2).toBeDefined();
            expect(obj2!.typeElementId).toBe(class2);
            expect(obj2!.parentId).not.toBe("/");
            expect(obj2!.isComposition).toBe(true);
        });

        it("getObjects() returns all device objects", async () => {
            const fplus = createMockFplus();
            setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const objects = tree.getObjects();
            expect(objects.length).toBeGreaterThanOrEqual(4); // devices + ISA-95 + metric tree
        });

        it("getObjects({ root: true }) returns only root ISA-95 objects", async () => {
            const fplus = createMockFplus();
            setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const roots = tree.getObjects({ root: true });
            // Both devices share AMRC → F2050, so there's 1 root: AMRC
            expect(roots).toHaveLength(1);
            expect(roots[0].displayName).toBe("AMRC");
            expect(roots[0].parentId).toBe("/");
        });

        it("getObjects({ typeElementId }) filters by type", async () => {
            const fplus = createMockFplus();
            const { dev1, class1 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const filtered = tree.getObjects({ typeElementId: class1 });
            expect(filtered).toHaveLength(1);
            expect(filtered[0].elementId).toBe(dev1);
        });

        it("getObject(id) returns the device, getObject(nonexistent) returns undefined", async () => {
            const fplus = createMockFplus();
            const { dev1 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            expect(tree.getObject(dev1)).toBeDefined();
            expect(tree.getObject(dev1)!.elementId).toBe(dev1);
            expect(tree.getObject("nonexistent")).toBeUndefined();
        });

        it("getObjectType(classId) returns type with schema", async () => {
            const fplus = createMockFplus();
            const { class1, schema1 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const ot = tree.getObjectType(class1);
            expect(ot).toBeDefined();
            expect(ot!.elementId).toBe(class1);
            expect(ot!.schema).toEqual(schema1);
        });

        it("getObjectTypes(namespaceUri) filters by namespace", async () => {
            const fplus = createMockFplus();
            setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            expect(tree.getObjectTypes(NS_URI).length).toBeGreaterThanOrEqual(2);
            expect(tree.getObjectTypes("urn:other:ns")).toHaveLength(0);
        });
    });

    describe("addCompositionFromUns", () => {
        async function treeWithDevice() {
            const fplus = createMockFplus();
            const dev1 = "dev-uuid-1";
            const schemaA = "schema-aaa";
            const schemaDef = { type: "object" };

            fplus.ConfigDB.class_members.mockResolvedValue([dev1]);
            fplus.ConfigDB.get_config.mockImplementation(
                (appUuid: string, objectUuid: string) => {
                    if (appUuid === DEVICE_INFORMATION_APP_UUID && objectUuid === dev1)
                        return Promise.resolve({
                            schema: schemaA,
                            sparkplugName: "TestDevice",
                            originMap: {
                                Schema_UUID: schemaA,
                                Instance_UUID: dev1,
                                Device_Information: {
                                    Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
                                    ISA95_Hierarchy: {
                                        Schema_UUID: HIERARCHY_SCHEMA_UUID,
                                        Enterprise: { Value: "TestOrg" },
                                    },
                                },
                            },
                        });
                    if (appUuid === SCHEMA_APP_UUID && objectUuid === schemaA)
                        return Promise.resolve(schemaDef);
                    return Promise.resolve(null);
                },
            );

            const tree = makeTree(fplus);
            await tree.init();
            return { tree, dev1, classA: schemaA };
        }

        it("adds sub-objects with correct parent chain", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            const sub2 = "sub-2-uuid";
            const subSchema1 = "sub-schema-1";
            const subSchema2 = "sub-schema-2";

            // metricSegments = ["Axes", "X", "Actual"]
            // instanceUuidPath covers device + Axes + X (3 entries)
            // schemaPath covers device + Axes + X + leaf (4 entries)
            // "Actual" has no Instance_UUID so gets a synthesised one
            tree.addCompositionFromUns(
                [dev1, sub1, sub2],
                ["top-schema", subSchema1, subSchema2, "metric-schema"],
                ["Axes", "X", "Actual"],
            );

            // sub1 ("Axes") should be a child of dev1
            const obj1 = tree.getObject(sub1);
            expect(obj1).toBeDefined();
            expect(obj1!.parentId).toBe(dev1);
            expect(obj1!.typeElementId).toBe(subSchema1);
            expect(obj1!.displayName).toBe("Axes");
            expect(obj1!.isComposition).toBe(true);

            // sub2 ("X") should be a child of sub1
            const obj2 = tree.getObject(sub2);
            expect(obj2).toBeDefined();
            expect(obj2!.parentId).toBe(sub1);
            expect(obj2!.typeElementId).toBe(subSchema2);
            expect(obj2!.displayName).toBe("X");
            expect(obj2!.isComposition).toBe(true);

            // "Actual" is the leaf — has a synthesised UUID, is not composition
            const children = tree.getChildElementIds(sub2);
            expect(children.length).toBe(1);
            const leaf = tree.getObject(children[0]);
            expect(leaf).toBeDefined();
            expect(leaf!.displayName).toBe("Actual");
            expect(leaf!.isComposition).toBe(false);
            expect(leaf!.parentId).toBe(sub2);
        });

        it("is idempotent - calling twice does not duplicate objects", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            const args: [string[], string[], string[]] = [
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Axes"],
            ];

            tree.addCompositionFromUns(...args);
            const countBefore = tree.getObjects().length;

            tree.addCompositionFromUns(...args);
            const countAfter = tree.getObjects().length;

            expect(countAfter).toBe(countBefore);
        });

        it("after adding composition: getChildElementIds(parentId) returns child IDs", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            const sub2 = "sub-2-uuid";

            tree.addCompositionFromUns(
                [dev1, sub1, sub2],
                ["top-schema", "sub-schema-1", "sub-schema-2"],
                ["Axes", "X"],
            );

            const childrenOfDev = tree.getChildElementIds(dev1);
            expect(childrenOfDev).toContain(sub1);
            expect(childrenOfDev).not.toContain(sub2); // sub2 is child of sub1, not dev1

            const childrenOfSub1 = tree.getChildElementIds(sub1);
            expect(childrenOfSub1).toContain(sub2);
        });

        it("getRelated(id, HasChildren) returns children", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            tree.addCompositionFromUns(
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Axes"],
            );

            const children = tree.getRelated(dev1, RelType.HasChildren);
            const childIds = children.map(c => c.elementId);
            expect(childIds).toContain(sub1);
        });

        it("getRelated(childId, HasParent) returns parent", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            tree.addCompositionFromUns(
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Axes"],
            );

            const parents = tree.getRelated(sub1, RelType.HasParent);
            expect(parents).toHaveLength(1);
            expect(parents[0].elementId).toBe(dev1);
        });

        it("getRelated(id) with no filter returns all related (parent + children)", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            const sub2 = "sub-2-uuid";

            tree.addCompositionFromUns(
                [dev1, sub1, sub2],
                ["top-schema", "sub-schema-1", "sub-schema-2"],
                ["Axes", "X"],
            );

            // sub1 has a parent (dev1) and a child (sub2)
            const related = tree.getRelated(sub1);
            expect(related.length).toBe(2);
            const relatedIds = related.map(r => r.elementId).sort();
            expect(relatedIds).toEqual([dev1, sub2].sort());
        });

        it("getRelated for device returns ISA-95 parent and composition children", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            tree.addCompositionFromUns(
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Axes"],
            );

            // dev1 has an ISA-95 parent (TestOrg) and a composition child (sub1)
            const related = tree.getRelated(dev1);
            expect(related.length).toBeGreaterThanOrEqual(1);
            const relatedIds = related.map(r => r.elementId);
            expect(relatedIds).toContain(sub1);
        });

        it("getRelated for nonexistent element returns empty array", async () => {
            const { tree } = await treeWithDevice();
            expect(tree.getRelated("nonexistent")).toEqual([]);
        });

        it("getChildElementIds for leaf element returns empty array", async () => {
            const { tree, dev1, instanceUuid } = await treeWithDevice();
            // Find a leaf node (no children)
            const allObjects = tree.getObjects();
            const leaf = allObjects.find(o => !o.isComposition);
            if (leaf) {
                expect(tree.getChildElementIds(leaf.elementId)).toEqual([]);
            }
        });

        it("refresh re-fetches data from ConfigDB/Directory", async () => {
            const fplus = createMockFplus();
            const { dev1 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const initialCount = tree.getObjects().length;
            expect(initialCount).toBeGreaterThanOrEqual(4);

            // Now mock returns only one device
            fplus.ConfigDB.class_members.mockResolvedValue([dev1]);

            await tree.refresh();
            // Should have fewer objects than before
            expect(tree.getObjects().length).toBeLessThan(initialCount);
            expect(tree.getObject(dev1)).toBeDefined();
        });
    });

    describe("refreshFromSnapshot (pipeline path)", () => {
        // Build a PipelineSnapshot directly, bypassing HTTP. Mirrors the
        // shape that lib/refresh.ts produces from notify-v2 watches.
        function snapshot(opts: {
            dev1: string; dev2: string;
            class1: string; class2: string;
            schema1: any; schema2: any;
            instance1: string; instance2: string;
        }) {
            const mkDevInfo = (schemaUuid: string, instanceUuid: string, sparkplugName: string) => ({
                schema: schemaUuid,
                sparkplugName,
                originMap: {
                    Schema_UUID: schemaUuid,
                    Instance_UUID: instanceUuid,
                    Device_Information: {
                        Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
                        ISA95_Hierarchy: {
                            Schema_UUID: HIERARCHY_SCHEMA_UUID,
                            Enterprise: { Value: "AMRC" },
                            Site: { Value: "F2050" },
                        },
                    },
                },
            });
            // The pipeline collects every Schema_UUID referenced in the
            // device originMaps and watches each one — so the snapshot
            // includes the nested DeviceInformation + Hierarchy schemas
            // (returned null by the real ConfigDB in this test fixture).
            const DEVICE_INFO_SCHEMA = "2dd093e9-1450-44c5-be8c-c0d78e48219b";
            return {
                devices: new Map([
                    [opts.dev1, { devInfo: mkDevInfo(opts.class1, opts.instance1, "Dev1"), info: { name: "Device 1" } }],
                    [opts.dev2, { devInfo: mkDevInfo(opts.class2, opts.instance2, "Dev2"), info: { name: "Device 2" } }],
                ]),
                schemas: new Map<string, { schema: any; info: any }>([
                    [opts.class1, { schema: opts.schema1, info: { name: "CNC Machine" } }],
                    [opts.class2, { schema: opts.schema2, info: { name: "Robot" } }],
                    [DEVICE_INFO_SCHEMA, { schema: null, info: null }],
                    [HIERARCHY_SCHEMA_UUID, { schema: null, info: null }],
                ]),
            };
        }

        it("produces the same Objects and ObjectTypes as the HTTP loadDevices path", async () => {
            // Build one tree via the HTTP path
            const fplusHttp = createMockFplus();
            const opts = setupMockDevices(fplusHttp);
            const treeHttp = makeTree(fplusHttp);
            await treeHttp.init();

            // Build a second tree via the pipeline path
            const treeP = makeTree();
            await treeP.init(); // empty bootstrap
            treeP.refreshFromSnapshot(snapshot(opts));

            // Same set of object IDs
            const httpIds = new Set(treeHttp.getObjects().map(o => o.elementId));
            const pIds = new Set(treeP.getObjects().map(o => o.elementId));
            expect(pIds).toEqual(httpIds);

            // Same set of ObjectType IDs
            const httpTypeIds = new Set(treeHttp.getObjectTypes().map(t => t.elementId));
            const pTypeIds = new Set(treeP.getObjectTypes().map(t => t.elementId));
            expect(pTypeIds).toEqual(httpTypeIds);

            // Same device-level metadata for each device
            for (const dev of [opts.dev1, opts.dev2]) {
                const a = treeHttp.getObject(dev)!;
                const b = treeP.getObject(dev)!;
                expect(b.typeElementId).toBe(a.typeElementId);
                expect(b.displayName).toBe(a.displayName);
                expect(b.parentId).toBe(a.parentId);
            }
        });

        it("atomically swaps the snapshot — no HTTP calls made", () => {
            const fplus = createMockFplus();
            const opts = setupMockDevices(fplus);
            const tree = makeTree(fplus);

            // Reset call counts after construction
            fplus.ConfigDB.class_members.mockClear();
            fplus.ConfigDB.get_config.mockClear();

            tree.refreshFromSnapshot(snapshot(opts));

            // refreshFromSnapshot must not hit the network
            expect(fplus.ConfigDB.class_members).not.toHaveBeenCalled();
            expect(fplus.ConfigDB.get_config).not.toHaveBeenCalled();

            // Tree state matches the pipeline input
            expect(tree.getObject(opts.dev1)).toBeDefined();
            expect(tree.getObject(opts.dev2)).toBeDefined();
            expect(tree.getObjectType(opts.class1)).toBeDefined();
            expect(tree.getObjectType(opts.class2)).toBeDefined();
        });

        it("skips devices whose devInfo is null (entry inaccessible)", async () => {
            const tree = makeTree();
            await tree.init();
            tree.refreshFromSnapshot({
                devices: new Map([
                    ["dev-missing", { devInfo: null, info: null }],
                ]),
                schemas: new Map(),
            });
            expect(tree.getObject("dev-missing")).toBeUndefined();
        });
    });

    describe("UNS node origin and preservation across swap", () => {
        // Builds a fresh tree with one device, then UNS-discovers a metric
        // chain under that device. Returns the tree plus identifiers.
        async function treeWithUnsDiscoveredChild() {
            const fplus = createMockFplus();
            const dev1 = "dev-uuid-uns";
            const schemaA = "schema-uns-a";

            fplus.ConfigDB.class_members.mockResolvedValue([dev1]);
            fplus.ConfigDB.get_config.mockImplementation(
                (appUuid: string, objectUuid: string) => {
                    if (appUuid === DEVICE_INFORMATION_APP_UUID && objectUuid === dev1)
                        return Promise.resolve({
                            schema: schemaA,
                            sparkplugName: "TestDevice",
                            originMap: {
                                Schema_UUID: schemaA,
                                Instance_UUID: dev1,
                                Device_Information: {
                                    Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
                                    ISA95_Hierarchy: {
                                        Schema_UUID: HIERARCHY_SCHEMA_UUID,
                                        Enterprise: { Value: "TestOrg" },
                                    },
                                },
                            },
                        });
                    if (appUuid === SCHEMA_APP_UUID && objectUuid === schemaA)
                        return Promise.resolve({ type: "object" });
                    return Promise.resolve(null);
                },
            );

            const tree = makeTree(fplus);
            await tree.init();

            // UNS discovers Axes/X/Position under the device. Axes and X
            // are composition; Position is a leaf metric.
            const axes = "axes-uns-uuid";
            const axisX = "axis-x-uns-uuid";
            const leaf = tree.addCompositionFromUns(
                [dev1, axes, axisX],
                [schemaA, "schema-axes", "schema-axis", "schema-position"],
                ["Axes", "X", "Position"],
            );
            return { fplus, tree, dev1, axes, axisX, leaf: leaf! };
        }

        it("tags config-derived nodes 'config' and UNS-discovered nodes 'uns'", async () => {
            const { tree, dev1, axes, axisX, leaf } = await treeWithUnsDiscoveredChild();

            expect(tree.getNodeSource(dev1)).toBe("config");
            expect(tree.getNodeSource(axes)).toBe("uns");
            expect(tree.getNodeSource(axisX)).toBe("uns");
            expect(tree.getNodeSource(leaf)).toBe("uns");
        });

        it("preserves UNS subtree across a refresh that keeps the device", async () => {
            const { fplus, tree, dev1, axes, axisX, leaf } = await treeWithUnsDiscoveredChild();

            expect(tree.getObject(axes)).toBeDefined();

            // Refresh with the same device set — UNS subtree must survive
            await tree.refresh();

            expect(tree.getObject(dev1)).toBeDefined();
            expect(tree.getObject(axes)).toBeDefined();
            expect(tree.getObject(axisX)).toBeDefined();
            expect(tree.getObject(leaf)).toBeDefined();
            // And origin is still uns
            expect(tree.getNodeSource(axes)).toBe("uns");
            expect(tree.getNodeSource(leaf)).toBe("uns");

            // Confirm we didn't hit an unrelated assertion
            expect(fplus.ConfigDB.class_members).toHaveBeenCalled();
        });

        it("drops orphaned UNS nodes when the parent device is removed", async () => {
            const { fplus, tree, dev1, axes, leaf } = await treeWithUnsDiscoveredChild();

            // Device disappears from ConfigDB class membership
            fplus.ConfigDB.class_members.mockResolvedValue([]);
            await tree.refresh();

            expect(tree.getObject(dev1)).toBeUndefined();
            expect(tree.getObject(axes)).toBeUndefined();
            expect(tree.getObject(leaf)).toBeUndefined();
        });

        it("config supersedes UNS when DeviceInformation catches up", async () => {
            const { tree, dev1, axes } = await treeWithUnsDiscoveredChild();

            expect(tree.getNodeSource(axes)).toBe("uns");

            // The device's DeviceInformation is now updated to declare
            // Axes natively (same Instance_UUID, so same elementId).
            const schemaA = "schema-uns-a";
            tree.refreshFromSnapshot({
                devices: new Map([
                    [dev1, {
                        devInfo: {
                            schema: schemaA,
                            sparkplugName: "TestDevice",
                            originMap: {
                                Schema_UUID: schemaA,
                                Instance_UUID: dev1,
                                Device_Information: {
                                    Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
                                    ISA95_Hierarchy: {
                                        Schema_UUID: HIERARCHY_SCHEMA_UUID,
                                        Enterprise: { Value: "TestOrg" },
                                    },
                                },
                                Axes: {
                                    Schema_UUID: "schema-axes",
                                    Instance_UUID: axes,
                                    AnotherMetric: {
                                        Schema_UUID: "schema-leaf",
                                        Sparkplug_Type: "Float",
                                    },
                                },
                            },
                        },
                        info: { name: "TestDevice" },
                    }],
                ]),
                schemas: new Map(),
            });

            // Axes is now config-derived (config wins)
            expect(tree.getObject(axes)).toBeDefined();
            expect(tree.getNodeSource(axes)).toBe("config");
        });
    });

    describe("incremental mutations (pipeline fast-path)", () => {
        const SCHEMA_UUID = "schema-mut-1";
        const DEV_INFO_SCHEMA = "2dd093e9-1450-44c5-be8c-c0d78e48219b";

        function mkDevInfo(uuid: string, sparkplugName: string, extra: Record<string, any> = {}) {
            return {
                schema: SCHEMA_UUID,
                sparkplugName,
                originMap: {
                    Schema_UUID: SCHEMA_UUID,
                    Instance_UUID: uuid,
                    Device_Information: {
                        Schema_UUID: DEV_INFO_SCHEMA,
                        ISA95_Hierarchy: {
                            Schema_UUID: HIERARCHY_SCHEMA_UUID,
                            Enterprise: { Value: "ACME" },
                            Site: { Value: "Plant1" },
                        },
                    },
                    ...extra,
                },
            };
        }

        async function emptyTree() {
            const tree = makeTree();
            await tree.init();
            return tree;
        }

        it("addDevice places the device under its ISA-95 hierarchy", async () => {
            const tree = await emptyTree();
            tree.addDevice("dev-A", mkDevInfo("dev-A", "Device A"), { name: "Device A" });

            const dev = tree.getObject("dev-A");
            expect(dev).toBeDefined();
            expect(dev!.displayName).toBe("Device A");
            expect(dev!.parentId).not.toBe("/"); // re-parented under ISA-95
            expect(tree.getNodeSource("dev-A")).toBe("config");
        });

        it("removeDevice removes the device, descendants, and orphan ISA-95 ancestors", async () => {
            const tree = await emptyTree();
            tree.addDevice("dev-A", mkDevInfo("dev-A", "Device A"), { name: "Device A" });

            const dev = tree.getObject("dev-A")!;
            const isa95Parent = dev.parentId!;

            tree.removeDevice("dev-A");

            expect(tree.getObject("dev-A")).toBeUndefined();
            // ISA-95 parent was the only path to dev-A → should be gone
            expect(tree.getObject(isa95Parent)).toBeUndefined();
        });

        it("removeDevice keeps ISA-95 ancestors that still have other children", async () => {
            const tree = await emptyTree();
            tree.addDevice("dev-A", mkDevInfo("dev-A", "Device A"), { name: "Device A" });
            tree.addDevice("dev-B", mkDevInfo("dev-B", "Device B"), { name: "Device B" });

            const isa95Parent = tree.getObject("dev-A")!.parentId!;
            // Both devices share the same ISA-95 path
            expect(tree.getObject("dev-B")!.parentId).toBe(isa95Parent);

            tree.removeDevice("dev-A");

            expect(tree.getObject("dev-A")).toBeUndefined();
            expect(tree.getObject("dev-B")).toBeDefined();
            expect(tree.getObject(isa95Parent)).toBeDefined();
        });

        it("replaceDeviceSubtree preserves UNS descendants under surviving parents", async () => {
            const tree = await emptyTree();
            tree.addDevice("dev-A", mkDevInfo("dev-A", "Device A"), { name: "Device A" });

            // UNS adds a child under the device
            const unsChild = "uns-child-1";
            tree.addCompositionFromUns(
                ["dev-A", unsChild],
                [SCHEMA_UUID, "child-schema"],
                ["AdHocMetric"],
            );
            expect(tree.getNodeSource(unsChild)).toBe("uns");

            // Replace with a new DeviceInformation that adds a real child
            tree.replaceDeviceSubtree("dev-A",
                mkDevInfo("dev-A", "Device A v2", {
                    Spec_Metric: { Schema_UUID: "spec", Sparkplug_Type: "Float" },
                }),
                { name: "Device A v2" });

            // Device survives, UNS child survives (parent dev-A still exists)
            expect(tree.getObject("dev-A")).toBeDefined();
            expect(tree.getObject("dev-A")!.displayName).toBe("Device A v2");
            expect(tree.getObject(unsChild)).toBeDefined();
            expect(tree.getNodeSource(unsChild)).toBe("uns");
        });

        it("updateDeviceName mutates only the displayName", async () => {
            const tree = await emptyTree();
            tree.addDevice("dev-A", mkDevInfo("dev-A", "Device A"), { name: "Device A" });

            const childCount = tree.getChildElementIds("dev-A").length;
            tree.updateDeviceName("dev-A", "Renamed");

            const dev = tree.getObject("dev-A")!;
            expect(dev.displayName).toBe("Renamed");
            // Subtree untouched
            expect(tree.getChildElementIds("dev-A").length).toBe(childCount);
        });

        it("addObjectType / updateObjectType / removeObjectType", async () => {
            const tree = await emptyTree();

            tree.addObjectType("schema-X", { type: "object", title: "X-v1" }, { name: "Schema X" });
            let t = tree.getObjectType("schema-X");
            expect(t).toBeDefined();
            expect(t!.displayName).toBe("Schema X");

            tree.updateObjectType("schema-X",
                { type: "object", title: "X-v2" },
                { name: "Schema X v2" });
            t = tree.getObjectType("schema-X");
            expect(t!.displayName).toBe("Schema X v2");
            expect((t!.schema as any).title).toBe("X-v2");

            tree.removeObjectType("schema-X");
            expect(tree.getObjectType("schema-X")).toBeUndefined();
        });
    });
});
