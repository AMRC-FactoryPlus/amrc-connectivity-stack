/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { ValueCache } from "../src/value-cache.js";
import type { I3xVqt, I3xValueResponse } from "../src/types/i3x.js";

/* ---- Mock helpers ---- */

function createMockObjectTree() {
    return {
        addCompositionFromUns: jest.fn(),
        getObject: jest.fn().mockReturnValue(undefined) as jest.Mock<() => any>,
        getChildElementIds: jest.fn().mockReturnValue([]) as jest.Mock<() => string[]>,
        isReady: jest.fn().mockReturnValue(true),
    };
}

function mockLogger() {
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
}

/**
 * Build a fake MQTT v5 packet with userProperties.
 */
function makePacket(userProps: Record<string, string>) {
    return {
        properties: {
            userProperties: userProps,
        },
    };
}

/**
 * Encode a UNS payload.
 */
function makePayload(data: { timestamp: string; value: unknown; batch?: unknown }) {
    return Buffer.from(JSON.stringify(data));
}

/* ---- Defaults used in tests ---- */
const STALE_MS = 60_000;

const DEFAULT_TOPIC =
    "UNS/v1/AMRC/Factory2050/Assembly/Line1/Station1/Edge/my-device/CNC/Axes/X/Position/Actual";
const DEFAULT_PAYLOAD = makePayload({
    timestamp: "2026-04-01T12:00:00Z",
    value: 125.3,
});
const DEFAULT_PROPS = makePacket({
    InstanceUUID: "dev-uuid",
    SchemaUUID: "cnc-schema",
    InstanceUUIDPath: "dev-uuid:axes-uuid:x-uuid:pos-uuid",
    SchemaUUIDPath: "cnc-schema:axis-schema:pos-schema:cmdval-schema",
    Type: "Double",
    Unit: "mm",
    Transient: "false",
});

describe("ValueCache", () => {
    let objectTree: ReturnType<typeof createMockObjectTree>;
    let cache: ValueCache;

    beforeEach(() => {
        objectTree = createMockObjectTree();
        cache = new ValueCache({
            objectTree: objectTree as any,
            staleThreshold: STALE_MS,
            logger: mockLogger(),
        });
    });

    /* ---- isReady ---- */

    describe("isReady", () => {
        it("returns false before init", () => {
            expect(cache.isReady()).toBe(false);
        });

        it("returns true after init", async () => {
            const mockMqtt = {
                subscribe: jest.fn<any>(),
                on: jest.fn<any>(),
            };
            const fplus = {
                mqtt_client: jest.fn<any>().mockResolvedValue(mockMqtt),
            };
            await cache.init(fplus);
            expect(cache.isReady()).toBe(true);
        });
    });

    /* ---- onUnsMessage with valid topic ---- */

    describe("onUnsMessage with valid UNS topic", () => {
        it("stores VQT in cache keyed by bottomLevelInstanceUuid/metricName", () => {
            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            const result = cache.getValue("pos-uuid/Actual");
            expect(result).not.toBeNull();
            expect(result!.elementId).toBe("pos-uuid/Actual");
            expect(result!.value).toBe(125.3);
            expect(result!.quality).toBe("Good");
            expect(result!.timestamp).toBe("2026-04-01T12:00:00Z");
        });

        it("parses ISA-95 hierarchy from topic", () => {
            // This test verifies the topic is correctly parsed — the cache
            // should not reject topics with full ISA-95 hierarchy.
            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);
            const result = cache.getValue("pos-uuid/Actual");
            expect(result).not.toBeNull();
        });

        it("calls objectTree.addCompositionFromUns with UUID paths and display names", () => {
            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            expect(objectTree.addCompositionFromUns).toHaveBeenCalledWith(
                ["dev-uuid", "axes-uuid", "x-uuid", "pos-uuid"],
                ["cnc-schema", "axis-schema", "pos-schema", "cmdval-schema"],
                expect.any(Array),
                expect.any(Array),
            );
        });

        it("skips messages without Enterprise (no ISA-95)", () => {
            // Topic with nothing between "v1/" and "Edge/"
            const topic = "UNS/v1/Edge/my-device/CNC/Temperature";
            const packet = makePacket({
                InstanceUUID: "dev-uuid",
                SchemaUUID: "cnc-schema",
                InstanceUUIDPath: "dev-uuid",
                SchemaUUIDPath: "cnc-schema",
                Type: "Double",
                Unit: "C",
                Transient: "false",
            });
            const payload = makePayload({ timestamp: "2026-04-01T12:00:00Z", value: 42 });

            cache.onUnsMessage(topic, payload, packet);

            expect(objectTree.addCompositionFromUns).not.toHaveBeenCalled();
            // No value stored
            expect(cache.getValue("dev-uuid/Temperature")).toBeNull();
        });

        it("notifies change listeners", () => {
            const listener = jest.fn<(elementId: string, vqt: I3xVqt) => void>();
            cache.onValueChange(listener);

            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                "pos-uuid/Actual",
                expect.objectContaining({
                    value: 125.3,
                    quality: "Good",
                    timestamp: "2026-04-01T12:00:00Z",
                }),
            );
        });
    });

    /* ---- getValue ---- */

    describe("getValue", () => {
        it("returns VQT for a known metric", () => {
            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            const result = cache.getValue("pos-uuid/Actual");
            expect(result).not.toBeNull();
            expect(result!.value).toBe(125.3);
            expect(result!.isComposition).toBe(false);
        });

        it("returns null for an unknown metric", () => {
            expect(cache.getValue("nonexistent/metric")).toBeNull();
        });

        it("returns assembled value with isComposition=true for a composition object", () => {
            // First, populate some child values under pos-uuid
            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            // Set up objectTree to recognize "pos-uuid" as an object (composition)
            objectTree.getObject.mockImplementation((id: string) => {
                if (id === "pos-uuid") {
                    return {
                        elementId: "pos-uuid",
                        displayName: "Position",
                        typeElementId: "pos-schema",
                        parentId: "x-uuid",
                        isComposition: true,
                        isExtended: false,
                    };
                }
                return undefined;
            });

            // pos-uuid has no child element IDs in the tree, but it has
            // cached leaf values keyed "pos-uuid/Actual"
            objectTree.getChildElementIds.mockReturnValue([]);

            const result = cache.getValue("pos-uuid");
            expect(result).not.toBeNull();
            expect(result!.isComposition).toBe(true);
            expect(result!.elementId).toBe("pos-uuid");
            // components should contain the child leaf values
            expect(result!.components).toBeDefined();
            expect(result!.components!["pos-uuid/Actual"]).toBeDefined();
            expect(result!.components!["pos-uuid/Actual"].value).toBe(125.3);
        });
    });

    /* ---- getChildValues ---- */

    describe("getChildValues", () => {
        it("returns direct children only when maxDepth=1", () => {
            // Set up two metrics under different parents
            const topic1 = "UNS/v1/AMRC/Factory2050/Edge/dev1/Motor/Speed";
            const payload1 = makePayload({ timestamp: "2026-04-01T12:00:00Z", value: 1500 });
            const packet1 = makePacket({
                InstanceUUID: "dev1-uuid",
                SchemaUUID: "motor-schema",
                InstanceUUIDPath: "dev1-uuid:motor-uuid",
                SchemaUUIDPath: "motor-schema:speed-schema",
                Type: "Double",
                Unit: "rpm",
                Transient: "false",
            });
            cache.onUnsMessage(topic1, payload1, packet1);

            const topic2 = "UNS/v1/AMRC/Factory2050/Edge/dev1/Motor/Temp";
            const payload2 = makePayload({ timestamp: "2026-04-01T12:00:01Z", value: 55.2 });
            const packet2 = makePacket({
                InstanceUUID: "dev1-uuid",
                SchemaUUID: "motor-schema",
                InstanceUUIDPath: "dev1-uuid:motor-uuid",
                SchemaUUIDPath: "motor-schema:temp-schema",
                Type: "Double",
                Unit: "C",
                Transient: "false",
            });
            cache.onUnsMessage(topic2, payload2, packet2);

            // motor-uuid has two leaf children in cache
            // Also set up a nested child object
            objectTree.getChildElementIds.mockImplementation((id: string) => {
                if (id === "motor-uuid") return ["nested-uuid"];
                return [];
            });

            const result = cache.getChildValues("motor-uuid", 1);
            expect(result).not.toBeNull();
            // Should contain the two direct leaf metrics
            expect(result!["motor-uuid/Speed"]).toBeDefined();
            expect(result!["motor-uuid/Speed"].value).toBe(1500);
            expect(result!["motor-uuid/Temp"]).toBeDefined();
            expect(result!["motor-uuid/Temp"].value).toBe(55.2);
        });

        it("returns all descendants when maxDepth=0 (infinite)", () => {
            // motor-uuid has a nested child nested-uuid, which has leaf values
            const topic1 = "UNS/v1/AMRC/Factory2050/Edge/dev1/Motor/Speed";
            const payload1 = makePayload({ timestamp: "2026-04-01T12:00:00Z", value: 1500 });
            const packet1 = makePacket({
                InstanceUUID: "dev1-uuid",
                SchemaUUID: "motor-schema",
                InstanceUUIDPath: "dev1-uuid:motor-uuid",
                SchemaUUIDPath: "motor-schema:speed-schema",
                Type: "Double",
                Unit: "rpm",
                Transient: "false",
            });
            cache.onUnsMessage(topic1, payload1, packet1);

            const topic2 = "UNS/v1/AMRC/Factory2050/Edge/dev1/Motor/Axes/X/Position";
            const payload2 = makePayload({ timestamp: "2026-04-01T12:00:01Z", value: 99.9 });
            const packet2 = makePacket({
                InstanceUUID: "dev1-uuid",
                SchemaUUID: "motor-schema",
                InstanceUUIDPath: "dev1-uuid:motor-uuid:axes-uuid",
                SchemaUUIDPath: "motor-schema:axes-schema:pos-schema",
                Type: "Double",
                Unit: "mm",
                Transient: "false",
            });
            cache.onUnsMessage(topic2, payload2, packet2);

            // Set up tree: motor-uuid -> axes-uuid
            objectTree.getChildElementIds.mockImplementation((id: string) => {
                if (id === "motor-uuid") return ["axes-uuid"];
                return [];
            });

            const result = cache.getChildValues("motor-uuid", 0);
            expect(result).not.toBeNull();
            // Should contain both motor-uuid direct leaves and axes-uuid leaves
            expect(result!["motor-uuid/Speed"]).toBeDefined();
            expect(result!["axes-uuid/Position"]).toBeDefined();
        });

        it("returns null for unknown elementId with no cached children", () => {
            const result = cache.getChildValues("nonexistent-uuid", 1);
            // No children in tree and no cached leaves
            expect(result).toBeNull();
        });
    });

    /* ---- onValueChange / offValueChange ---- */

    describe("onValueChange / offValueChange", () => {
        it("listener receives updates on value change", () => {
            const listener = jest.fn<(elementId: string, vqt: I3xVqt) => void>();
            cache.onValueChange(listener);

            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                "pos-uuid/Actual",
                expect.objectContaining({ value: 125.3 }),
            );
        });

        it("listener stops receiving after offValueChange", () => {
            const listener = jest.fn<(elementId: string, vqt: I3xVqt) => void>();
            cache.onValueChange(listener);
            cache.offValueChange(listener);

            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            expect(listener).not.toHaveBeenCalled();
        });

        it("multiple listeners all receive updates", () => {
            const listener1 = jest.fn<(elementId: string, vqt: I3xVqt) => void>();
            const listener2 = jest.fn<(elementId: string, vqt: I3xVqt) => void>();
            cache.onValueChange(listener1);
            cache.onValueChange(listener2);

            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            expect(listener1).toHaveBeenCalledTimes(1);
            expect(listener2).toHaveBeenCalledTimes(1);
        });
    });

    /* ---- Multiple messages to same metric ---- */

    describe("multiple messages to same metric", () => {
        it("latest value wins", () => {
            cache.onUnsMessage(DEFAULT_TOPIC, DEFAULT_PAYLOAD, DEFAULT_PROPS);

            const updatedPayload = makePayload({
                timestamp: "2026-04-01T12:01:00Z",
                value: 200.5,
            });
            cache.onUnsMessage(DEFAULT_TOPIC, updatedPayload, DEFAULT_PROPS);

            const result = cache.getValue("pos-uuid/Actual");
            expect(result).not.toBeNull();
            expect(result!.value).toBe(200.5);
            expect(result!.timestamp).toBe("2026-04-01T12:01:00Z");
        });
    });

    /* ---- init ---- */

    describe("init", () => {
        it("subscribes to UNS/v1/# on the MQTT client", async () => {
            const mockMqtt = {
                subscribe: jest.fn<any>(),
                on: jest.fn<any>(),
            };
            const fplus = {
                mqtt_client: jest.fn<any>().mockResolvedValue(mockMqtt),
            };

            await cache.init(fplus);

            expect(mockMqtt.subscribe).toHaveBeenCalledWith("UNS/v1/#");
        });

        it("registers a message handler on the MQTT client", async () => {
            const mockMqtt = {
                subscribe: jest.fn<any>(),
                on: jest.fn<any>(),
            };
            const fplus = {
                mqtt_client: jest.fn<any>().mockResolvedValue(mockMqtt),
            };

            await cache.init(fplus);

            expect(mockMqtt.on).toHaveBeenCalledWith("message", expect.any(Function));
        });
    });

    /* ---- Edge cases ---- */

    describe("edge cases", () => {
        it("ignores messages with invalid JSON payload", () => {
            const badPayload = Buffer.from("not-json");
            cache.onUnsMessage(DEFAULT_TOPIC, badPayload, DEFAULT_PROPS);

            const result = cache.getValue("pos-uuid/Actual");
            expect(result).toBeNull();
        });

        it("handles topic with minimal ISA-95 (just Enterprise)", () => {
            const topic = "UNS/v1/AMRC/Edge/my-device/Temperature";
            const payload = makePayload({ timestamp: "2026-04-01T12:00:00Z", value: 22.5 });
            const packet = makePacket({
                InstanceUUID: "dev-uuid",
                SchemaUUID: "temp-schema",
                InstanceUUIDPath: "dev-uuid",
                SchemaUUIDPath: "temp-schema",
                Type: "Double",
                Unit: "C",
                Transient: "false",
            });

            cache.onUnsMessage(topic, payload, packet);

            const result = cache.getValue("dev-uuid/Temperature");
            expect(result).not.toBeNull();
            expect(result!.value).toBe(22.5);
        });

        it("handles missing userProperties gracefully", () => {
            const packet = { properties: {} };
            const payload = makePayload({ timestamp: "2026-04-01T12:00:00Z", value: 42 });

            // Should not throw
            cache.onUnsMessage(DEFAULT_TOPIC, payload, packet);
        });
    });
});
