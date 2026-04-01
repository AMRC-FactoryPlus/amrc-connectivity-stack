import {
    toI3xNamespace,
    toI3xObjectType,
    toI3xObject,
    toI3xVqt,
    toI3xRelationshipType,
    wrapResponse,
    wrapError,
    wrapBulkResponse,
} from "../src/mapping.js";
import type {
    I3xBulkItem,
    I3xQuality,
} from "../src/types/i3x.js";

describe("toI3xNamespace", () => {
    it("returns a namespace with uri and displayName", () => {
        const ns = toI3xNamespace("Factory+", "urn:factoryplus:ns");
        expect(ns).toEqual({
            uri: "urn:factoryplus:ns",
            displayName: "Factory+",
        });
    });

    it("handles empty strings", () => {
        const ns = toI3xNamespace("", "");
        expect(ns).toEqual({ uri: "", displayName: "" });
    });
});

describe("toI3xObjectType", () => {
    it("returns a full ObjectType shape", () => {
        const schema = { type: "object", properties: { temp: { type: "number" } } };
        const ot = toI3xObjectType(
            "el-001",
            "Temperature Sensor",
            "urn:factoryplus:ns",
            "src-type-42",
            schema,
        );
        expect(ot).toEqual({
            elementId: "el-001",
            displayName: "Temperature Sensor",
            namespaceUri: "urn:factoryplus:ns",
            sourceTypeId: "src-type-42",
            schema,
        });
    });

    it("preserves an empty schema object", () => {
        const ot = toI3xObjectType("el-002", "Empty", "urn:ns", "src-1", {});
        expect(ot.schema).toEqual({});
    });
});

describe("toI3xObject", () => {
    it("returns a full Object shape with parentId set", () => {
        const obj = toI3xObject("el-100", "Machine A", "type-el-1", "parent-el-50", false);
        expect(obj).toEqual({
            elementId: "el-100",
            displayName: "Machine A",
            typeElementId: "type-el-1",
            parentId: "parent-el-50",
            isComposition: false,
            isExtended: false,
        });
    });

    it("returns null parentId when given null", () => {
        const obj = toI3xObject("el-101", "Root Node", "type-el-1", null, false);
        expect(obj.parentId).toBeNull();
    });

    it("sets isComposition to true when requested", () => {
        const obj = toI3xObject("el-102", "SubPart", "type-el-2", "parent-el-100", true);
        expect(obj.isComposition).toBe(true);
    });

    it("sets isComposition to false when requested", () => {
        const obj = toI3xObject("el-103", "Sibling", "type-el-2", "parent-el-100", false);
        expect(obj.isComposition).toBe(false);
    });

    it("always sets isExtended to false", () => {
        const obj = toI3xObject("el-104", "Test", "type-el-3", null, true);
        expect(obj.isExtended).toBe(false);
    });
});

describe("toI3xVqt", () => {
    it("returns a VQT with numeric value", () => {
        const vqt = toI3xVqt(42, "Good", "2025-01-15T10:30:00.000Z");
        expect(vqt).toEqual({
            value: 42,
            quality: "Good",
            timestamp: "2025-01-15T10:30:00.000Z",
        });
    });

    it("converts a Date object to ISO string", () => {
        const date = new Date("2025-06-01T12:00:00Z");
        const vqt = toI3xVqt("hello", "Good", date);
        expect(vqt.timestamp).toBe(date.toISOString());
        expect(typeof vqt.timestamp).toBe("string");
    });

    it("passes through a string timestamp unchanged", () => {
        const ts = "2025-01-15T10:30:00.000Z";
        const vqt = toI3xVqt(null, "Bad", ts);
        expect(vqt.timestamp).toBe(ts);
    });

    it("supports all quality values", () => {
        const qualities: I3xQuality[] = ["Good", "GoodNoData", "Bad", "Uncertain"];
        for (const q of qualities) {
            const vqt = toI3xVqt(0, q, "2025-01-01T00:00:00Z");
            expect(vqt.quality).toBe(q);
        }
    });

    it("handles null value", () => {
        const vqt = toI3xVqt(null, "GoodNoData", "2025-01-01T00:00:00Z");
        expect(vqt.value).toBeNull();
    });

    it("handles object value", () => {
        const val = { x: 1, y: 2 };
        const vqt = toI3xVqt(val, "Good", "2025-01-01T00:00:00Z");
        expect(vqt.value).toEqual(val);
    });
});

describe("toI3xRelationshipType", () => {
    it("returns a full RelationshipType shape", () => {
        const rt = toI3xRelationshipType(
            "rel-el-1",
            "Has Parent",
            "urn:factoryplus:ns",
            "i3x:rel:has-parent",
            "i3x:rel:has-children",
        );
        expect(rt).toEqual({
            elementId: "rel-el-1",
            displayName: "Has Parent",
            namespaceUri: "urn:factoryplus:ns",
            relationshipId: "i3x:rel:has-parent",
            reverseOf: "i3x:rel:has-children",
        });
    });

    it("handles empty reverseOf", () => {
        const rt = toI3xRelationshipType("rel-el-2", "Standalone", "urn:ns", "rel-2", "");
        expect(rt.reverseOf).toBe("");
    });
});

describe("wrapResponse", () => {
    it("wraps a value in a success envelope", () => {
        const resp = wrapResponse({ foo: "bar" });
        expect(resp).toEqual({
            success: true,
            result: { foo: "bar" },
        });
    });

    it("wraps a primitive value", () => {
        const resp = wrapResponse(42);
        expect(resp).toEqual({ success: true, result: 42 });
    });

    it("wraps null", () => {
        const resp = wrapResponse(null);
        expect(resp).toEqual({ success: true, result: null });
    });

    it("wraps an array", () => {
        const resp = wrapResponse([1, 2, 3]);
        expect(resp).toEqual({ success: true, result: [1, 2, 3] });
    });
});

describe("wrapError", () => {
    it("wraps a message in an error envelope", () => {
        const resp = wrapError("something went wrong");
        expect(resp).toEqual({
            success: false,
            error: { message: "something went wrong" },
        });
    });

    it("handles empty message", () => {
        const resp = wrapError("");
        expect(resp).toEqual({
            success: false,
            error: { message: "" },
        });
    });
});

describe("wrapBulkResponse", () => {
    it("returns success true when all items succeeded", () => {
        const items: I3xBulkItem<string>[] = [
            { success: true, elementId: "a", result: "ok" },
            { success: true, elementId: "b", result: "ok" },
        ];
        const resp = wrapBulkResponse(items);
        expect(resp).toEqual({ success: true, results: items });
    });

    it("returns success false when one item failed", () => {
        const items: I3xBulkItem<string>[] = [
            { success: true, elementId: "a", result: "ok" },
            { success: false, elementId: "b", error: { message: "not found" } },
        ];
        const resp = wrapBulkResponse(items);
        expect(resp.success).toBe(false);
        expect(resp.results).toEqual(items);
    });

    it("returns success false when all items failed", () => {
        const items: I3xBulkItem<string>[] = [
            { success: false, elementId: "a", error: { message: "err1" } },
            { success: false, elementId: "b", error: { message: "err2" } },
        ];
        const resp = wrapBulkResponse(items);
        expect(resp.success).toBe(false);
    });

    it("returns success true for an empty array", () => {
        const resp = wrapBulkResponse([]);
        expect(resp).toEqual({ success: true, results: [] });
    });
});
