import { jest } from "@jest/globals";
import { ObjectTree } from "../src/object-tree.js";
import { RelType } from "../src/constants.js";
import { createMockFplus } from "./helpers/mock-services.js";

const DEVICE_CLASS_UUID = "18773d6d-a70d-443a-b29a-3f1583195290";
const REGISTRATION_APP_UUID = "cb40bed5-49ad-4443-a7f5-08c75009da8f";
const CONFIG_SCHEMA_APP_UUID = "dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3";

const NS_NAME = "Factory+";
const NS_URI = "urn:factoryplus:ns";

function makeTree(fplus?: ReturnType<typeof createMockFplus>) {
    return new ObjectTree({
        fplus: fplus ?? createMockFplus(),
        namespaceName: NS_NAME,
        namespaceUri: NS_URI,
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
}

/**
 * Helper: set up mock fplus to return two devices with distinct classes and schemas.
 */
function setupMockDevices(fplus: ReturnType<typeof createMockFplus>) {
    const dev1 = "aaaa-1111";
    const dev2 = "bbbb-2222";
    const class1 = "class-1111";
    const class2 = "class-2222";
    const schema1 = { type: "object", properties: { temp: { type: "number" } } };
    const schema2 = { type: "object", properties: { speed: { type: "number" } } };

    fplus.ConfigDB.class_members.mockResolvedValue([dev1, dev2]);

    fplus.ConfigDB.get_config.mockImplementation(
        (appUuid: string, objectUuid: string) => {
            if (appUuid === REGISTRATION_APP_UUID) {
                if (objectUuid === dev1) return Promise.resolve({ class: class1 });
                if (objectUuid === dev2) return Promise.resolve({ class: class2 });
            }
            if (appUuid === CONFIG_SCHEMA_APP_UUID) {
                if (objectUuid === class1) return Promise.resolve(schema1);
                if (objectUuid === class2) return Promise.resolve(schema2);
            }
            return Promise.resolve(null);
        },
    );

    fplus.Directory.get_device_info.mockImplementation(
        (uuid: string) => {
            if (uuid === dev1) return Promise.resolve({ online: true });
            if (uuid === dev2) return Promise.resolve({ online: false });
            return Promise.resolve({ online: false });
        },
    );

    return { dev1, dev2, class1, class2, schema1, schema2 };
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

            // Verify object types were created
            const types = tree.getObjectTypes();
            expect(types).toHaveLength(2);
            const typeIds = types.map(t => t.elementId).sort();
            expect(typeIds).toEqual([class1, class2].sort());

            // Verify schemas
            const type1 = tree.getObjectType(class1);
            expect(type1).toBeDefined();
            expect(type1!.schema).toEqual(schema1);
            expect(type1!.namespaceUri).toBe(NS_URI);

            const type2 = tree.getObjectType(class2);
            expect(type2).toBeDefined();
            expect(type2!.schema).toEqual(schema2);

            // Verify device objects were created
            const objects = tree.getObjects();
            expect(objects).toHaveLength(2);

            const obj1 = tree.getObject(dev1);
            expect(obj1).toBeDefined();
            expect(obj1!.typeElementId).toBe(class1);
            expect(obj1!.parentId).toBeNull();
            expect(obj1!.isComposition).toBe(true);

            const obj2 = tree.getObject(dev2);
            expect(obj2).toBeDefined();
            expect(obj2!.typeElementId).toBe(class2);
            expect(obj2!.parentId).toBeNull();
            expect(obj2!.isComposition).toBe(true);
        });

        it("getObjects() returns all device objects", async () => {
            const fplus = createMockFplus();
            setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const objects = tree.getObjects();
            expect(objects).toHaveLength(2);
        });

        it("getObjects({ root: true }) returns only top-level objects", async () => {
            const fplus = createMockFplus();
            const { dev1 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            const roots = tree.getObjects({ root: true });
            expect(roots).toHaveLength(2);
            for (const obj of roots) {
                expect(obj.parentId).toBeNull();
            }
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

            expect(tree.getObjectTypes(NS_URI)).toHaveLength(2);
            expect(tree.getObjectTypes("urn:other:ns")).toHaveLength(0);
        });
    });

    describe("addCompositionFromUns", () => {
        async function treeWithDevice() {
            const fplus = createMockFplus();
            const dev1 = "dev-uuid-1";
            const classA = "class-aaa";
            const schemaA = { type: "object" };

            fplus.ConfigDB.class_members.mockResolvedValue([dev1]);
            fplus.ConfigDB.get_config.mockImplementation(
                (appUuid: string, objectUuid: string) => {
                    if (appUuid === REGISTRATION_APP_UUID && objectUuid === dev1)
                        return Promise.resolve({ class: classA });
                    if (appUuid === CONFIG_SCHEMA_APP_UUID && objectUuid === classA)
                        return Promise.resolve(schemaA);
                    return Promise.resolve(null);
                },
            );
            fplus.Directory.get_device_info.mockResolvedValue({ online: true });

            const tree = makeTree(fplus);
            await tree.init();
            return { tree, dev1, classA };
        }

        it("adds sub-objects with correct parent chain", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            const sub2 = "sub-2-uuid";
            const subSchema1 = "sub-schema-1";
            const subSchema2 = "sub-schema-2";

            tree.addCompositionFromUns(
                dev1,
                [dev1, sub1, sub2],
                ["top-schema", subSchema1, subSchema2],
                ["Device", "Axes", "X"],
            );

            // sub1 should be a child of dev1
            const obj1 = tree.getObject(sub1);
            expect(obj1).toBeDefined();
            expect(obj1!.parentId).toBe(dev1);
            expect(obj1!.typeElementId).toBe(subSchema1);
            expect(obj1!.displayName).toBe("Axes");
            expect(obj1!.isComposition).toBe(true);

            // sub2 should be a child of sub1
            const obj2 = tree.getObject(sub2);
            expect(obj2).toBeDefined();
            expect(obj2!.parentId).toBe(sub1);
            expect(obj2!.typeElementId).toBe(subSchema2);
            expect(obj2!.displayName).toBe("X");
            expect(obj2!.isComposition).toBe(true);
        });

        it("is idempotent - calling twice does not duplicate objects", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            const args: [string, string[], string[], string[]] = [
                dev1,
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Device", "Axes"],
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
                dev1,
                [dev1, sub1, sub2],
                ["top-schema", "sub-schema-1", "sub-schema-2"],
                ["Device", "Axes", "X"],
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
                dev1,
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Device", "Axes"],
            );

            const children = tree.getRelated(dev1, RelType.HasChildren);
            expect(children).toHaveLength(1);
            expect(children[0].elementId).toBe(sub1);
        });

        it("getRelated(childId, HasParent) returns parent", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            tree.addCompositionFromUns(
                dev1,
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Device", "Axes"],
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
                dev1,
                [dev1, sub1, sub2],
                ["top-schema", "sub-schema-1", "sub-schema-2"],
                ["Device", "Axes", "X"],
            );

            // sub1 has a parent (dev1) and a child (sub2)
            const related = tree.getRelated(sub1);
            expect(related.length).toBe(2);
            const relatedIds = related.map(r => r.elementId).sort();
            expect(relatedIds).toEqual([dev1, sub2].sort());
        });

        it("getRelated for root with no parent returns only children", async () => {
            const { tree, dev1 } = await treeWithDevice();

            const sub1 = "sub-1-uuid";
            tree.addCompositionFromUns(
                dev1,
                [dev1, sub1],
                ["top-schema", "sub-schema-1"],
                ["Device", "Axes"],
            );

            // dev1 has no parent, only children
            const related = tree.getRelated(dev1);
            expect(related).toHaveLength(1);
            expect(related[0].elementId).toBe(sub1);
        });

        it("getRelated for nonexistent element returns empty array", async () => {
            const { tree } = await treeWithDevice();
            expect(tree.getRelated("nonexistent")).toEqual([]);
        });

        it("getChildElementIds for element with no children returns empty array", async () => {
            const { tree, dev1 } = await treeWithDevice();
            expect(tree.getChildElementIds(dev1)).toEqual([]);
        });

        it("refresh re-fetches data from ConfigDB/Directory", async () => {
            const fplus = createMockFplus();
            const { dev1, class1 } = setupMockDevices(fplus);
            const tree = makeTree(fplus);
            await tree.init();

            expect(tree.getObjects()).toHaveLength(2);

            // Now mock returns only one device
            fplus.ConfigDB.class_members.mockResolvedValue([dev1]);

            await tree.refresh();
            expect(tree.getObjects()).toHaveLength(1);
            expect(tree.getObject(dev1)).toBeDefined();
        });
    });
});
