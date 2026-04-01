import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SubscriptionManager } from "../src/subscriptions.js";
import type { I3xVqt, I3xSyncItem } from "../src/types/i3x.js";

/* ---- Mock helpers ---- */

function mockValueCache() {
    return {
        onValueChange: jest.fn(),
        offValueChange: jest.fn(),
    };
}

function mockSseRes() {
    const res: any = {
        writeHead: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        on: jest.fn(),
        headersSent: false,
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
    };
    return res;
}

const TTL = 30_000;

function makeVqt(value: unknown = 42, timestamp?: string): I3xVqt {
    return {
        value,
        quality: "Good",
        timestamp: timestamp ?? "2026-04-01T12:00:00Z",
    };
}

describe("SubscriptionManager", () => {
    let valueCache: ReturnType<typeof mockValueCache>;
    let mgr: SubscriptionManager;

    beforeEach(() => {
        jest.useFakeTimers();
        valueCache = mockValueCache();
        mgr = new SubscriptionManager({ valueCache: valueCache as any, ttl: TTL });
    });

    afterEach(() => {
        mgr.destroy();
        jest.useRealTimers();
    });

    /* ---- create ---- */

    describe("create", () => {
        it("returns subscription with clientId, subscriptionId, displayName", () => {
            const sub = mgr.create("client-1");

            expect(sub.clientId).toBe("client-1");
            expect(sub.subscriptionId).toBeDefined();
            expect(typeof sub.subscriptionId).toBe("string");
            expect(sub.subscriptionId.length).toBeGreaterThan(0);
            expect(sub.displayName).toBeDefined();
        });

        it("uses provided displayName", () => {
            const sub = mgr.create("client-1", "My Subscription");

            expect(sub.displayName).toBe("My Subscription");
        });

        it("uses empty string when no displayName provided", () => {
            const sub = mgr.create("client-1");

            expect(sub.displayName).toBe("");
        });

        it("creates two separate subscriptions for same clientId", () => {
            const sub1 = mgr.create("client-1");
            const sub2 = mgr.create("client-1");

            expect(sub1.subscriptionId).not.toBe(sub2.subscriptionId);
        });
    });

    /* ---- list ---- */

    describe("list", () => {
        it("returns matching subscriptions", () => {
            const sub1 = mgr.create("client-1", "Sub A");
            const sub2 = mgr.create("client-1", "Sub B");

            const result = mgr.list("client-1", [sub1.subscriptionId, sub2.subscriptionId]);

            expect(result).toHaveLength(2);
            expect(result.map(s => s.subscriptionId).sort()).toEqual(
                [sub1.subscriptionId, sub2.subscriptionId].sort(),
            );
        });

        it("returns empty for unknown subscriptionId", () => {
            mgr.create("client-1");

            const result = mgr.list("client-1", ["nonexistent-id"]);

            expect(result).toHaveLength(0);
        });

        it("filters out subscriptions belonging to different clientId", () => {
            const sub = mgr.create("client-1");

            const result = mgr.list("client-2", [sub.subscriptionId]);

            expect(result).toHaveLength(0);
        });
    });

    /* ---- delete ---- */

    describe("delete", () => {
        it("removes subscription", () => {
            const sub = mgr.create("client-1");
            mgr.delete("client-1", [sub.subscriptionId]);

            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(0);
        });

        it("is idempotent for unknown subscription", () => {
            expect(() => mgr.delete("client-1", ["nonexistent-id"])).not.toThrow();
        });

        it("does not delete subscription owned by different clientId", () => {
            const sub = mgr.create("client-1");
            mgr.delete("client-2", [sub.subscriptionId]);

            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(1);
        });
    });

    /* ---- register ---- */

    describe("register", () => {
        it("adds elementIds to subscription", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1", "elem-2"]);

            // After registering, value changes for elem-1 should be captured
            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(1);
            expect(items[0].elementId).toBe("elem-1");
        });

        it("is idempotent re-registering same elementId", () => {
            const sub = mgr.create("client-1");

            expect(() => {
                mgr.register("client-1", sub.subscriptionId, ["elem-1"]);
                mgr.register("client-1", sub.subscriptionId, ["elem-1"]);
            }).not.toThrow();
        });

        it("throws for wrong clientId", () => {
            const sub = mgr.create("client-1");

            expect(() =>
                mgr.register("client-2", sub.subscriptionId, ["elem-1"]),
            ).toThrow();
        });
    });

    /* ---- unregister ---- */

    describe("unregister", () => {
        it("removes elementIds from subscription", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1", "elem-2"]);
            mgr.unregister("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(0);
        });

        it("still receives changes for remaining registered elements", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1", "elem-2"]);
            mgr.unregister("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-2", makeVqt(200));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(1);
            expect(items[0].elementId).toBe("elem-2");
        });
    });

    /* ---- onValueChange ---- */

    describe("onValueChange", () => {
        it("queues item with correct sequenceNumber", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100, "2026-04-01T12:00:00Z"));
            listener("elem-1", makeVqt(200, "2026-04-01T12:00:01Z"));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(2);
            expect(items[0].sequenceNumber).toBe(1);
            expect(items[1].sequenceNumber).toBe(2);
        });

        it("only queues for subscriptions that have the elementId registered", () => {
            const sub1 = mgr.create("client-1");
            const sub2 = mgr.create("client-1");
            mgr.register("client-1", sub1.subscriptionId, ["elem-1"]);
            mgr.register("client-1", sub2.subscriptionId, ["elem-2"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));

            const items1 = mgr.sync("client-1", sub1.subscriptionId);
            const items2 = mgr.sync("client-1", sub2.subscriptionId);
            expect(items1).toHaveLength(1);
            expect(items2).toHaveLength(0);
        });
    });

    /* ---- sync ---- */

    describe("sync", () => {
        it("returns all queued items without lastSequenceNumber", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));
            listener("elem-1", makeVqt(200));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(2);
        });

        it("removes acknowledged items when lastSequenceNumber provided", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));
            listener("elem-1", makeVqt(200));
            listener("elem-1", makeVqt(300));

            const items = mgr.sync("client-1", sub.subscriptionId, 2);
            expect(items).toHaveLength(1);
            expect(items[0].sequenceNumber).toBe(3);
            expect(items[0].value).toBe(300);
        });

        it("returns empty array on empty queue", () => {
            const sub = mgr.create("client-1");

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(0);
        });

        it("sequence numbers are monotonically increasing", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            for (let i = 0; i < 10; i++) {
                listener("elem-1", makeVqt(i));
            }

            const items = mgr.sync("client-1", sub.subscriptionId);
            for (let i = 1; i < items.length; i++) {
                expect(items[i].sequenceNumber).toBeGreaterThan(items[i - 1].sequenceNumber);
            }
        });

        it("throws for wrong clientId", () => {
            const sub = mgr.create("client-1");

            expect(() => mgr.sync("client-2", sub.subscriptionId)).toThrow();
        });
    });

    /* ---- stream (SSE) ---- */

    describe("stream", () => {
        it("sets SSE headers on response", () => {
            const sub = mgr.create("client-1");
            const res = mockSseRes();

            mgr.stream("client-1", sub.subscriptionId, res);

            expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
            expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
            expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
            expect(res.flushHeaders).toHaveBeenCalled();
        });

        it("flushes queued items immediately", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));
            listener("elem-1", makeVqt(200));

            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            // Should have written the queued items
            expect(res.write).toHaveBeenCalled();
            const writtenData = res.write.mock.calls.map(
                (c: any[]) => c[0] as string,
            ).join("");
            expect(writtenData).toContain("data:");
        });

        it("sends new items as they arrive", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(999, "2026-04-01T12:05:00Z"));

            // The item should have been written to the response
            const writtenData = res.write.mock.calls.map(
                (c: any[]) => c[0] as string,
            ).join("");
            expect(writtenData).toContain("999");
        });

        it("throws error on second stream call (one stream per subscription)", () => {
            const sub = mgr.create("client-1");
            const res1 = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res1);

            const res2 = mockSseRes();
            expect(() =>
                mgr.stream("client-1", sub.subscriptionId, res2),
            ).toThrow();
        });

        it("clears activeStream on res close", () => {
            const sub = mgr.create("client-1");
            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            // Simulate res close by calling the 'close' handler
            const closeCall = res.on.mock.calls.find(
                (c: any[]) => c[0] === "close",
            );
            expect(closeCall).toBeDefined();
            const closeHandler = closeCall![1] as () => void;
            closeHandler();

            // Should be able to open a new stream now
            const res2 = mockSseRes();
            expect(() =>
                mgr.stream("client-1", sub.subscriptionId, res2),
            ).not.toThrow();
        });

        it("uses correct SSE format for each item", () => {
            const sub = mgr.create("client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1"]);

            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(42, "2026-04-01T12:00:00Z"));

            const lastWrite = res.write.mock.calls[res.write.mock.calls.length - 1][0] as string;
            // Should match SSE format: data: JSON\n\n
            expect(lastWrite).toMatch(/^data: \[.*\]\n\n$/);
            const parsed = JSON.parse(lastWrite.replace("data: ", "").trim());
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed[0].elementId).toBe("elem-1");
        });
    });

    /* ---- TTL ---- */

    describe("TTL", () => {
        it("subscription expires after timeout", () => {
            const sub = mgr.create("client-1");

            jest.advanceTimersByTime(TTL + 1);

            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(0);
        });

        it("access resets the timer", () => {
            const sub = mgr.create("client-1");

            // Advance just under TTL
            jest.advanceTimersByTime(TTL - 1000);

            // Access the subscription via sync (resets TTL)
            mgr.sync("client-1", sub.subscriptionId);

            // Advance another TTL - 1000 ms (total elapsed since reset < TTL)
            jest.advanceTimersByTime(TTL - 1000);

            // Should still exist
            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(1);
        });

        it("subscription is gone after reset TTL elapses", () => {
            const sub = mgr.create("client-1");

            // Advance just under TTL
            jest.advanceTimersByTime(TTL - 1000);

            // Access resets timer
            mgr.sync("client-1", sub.subscriptionId);

            // Now advance full TTL + 1 from the reset point
            jest.advanceTimersByTime(TTL + 1);

            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(0);
        });

        it("closes active stream on expiry", () => {
            const sub = mgr.create("client-1");
            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            jest.advanceTimersByTime(TTL + 1);

            expect(res.end).toHaveBeenCalled();
        });
    });

    /* ---- destroy ---- */

    describe("destroy", () => {
        it("cleans up all subscriptions and timers", () => {
            const sub1 = mgr.create("client-1");
            const sub2 = mgr.create("client-2");

            mgr.destroy();

            const result1 = mgr.list("client-1", [sub1.subscriptionId]);
            const result2 = mgr.list("client-2", [sub2.subscriptionId]);
            expect(result1).toHaveLength(0);
            expect(result2).toHaveLength(0);
        });

        it("calls offValueChange to deregister listener", () => {
            mgr.destroy();

            expect(valueCache.offValueChange).toHaveBeenCalled();
        });

        it("closes active streams on destroy", () => {
            const sub = mgr.create("client-1");
            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            mgr.destroy();

            expect(res.end).toHaveBeenCalled();
        });
    });

    /* ---- constructor ---- */

    describe("constructor", () => {
        it("registers a value change listener on the valueCache", () => {
            expect(valueCache.onValueChange).toHaveBeenCalledTimes(1);
            expect(valueCache.onValueChange).toHaveBeenCalledWith(expect.any(Function));
        });
    });
});
