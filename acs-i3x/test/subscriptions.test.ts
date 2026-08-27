import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SubscriptionManager } from "../lib/subscriptions.js";
import type { I3xVqt, I3xSyncItem } from "../lib/types/i3x.js";

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
            const sub = mgr.create("client-1", "client-1");

            expect(sub.clientId).toBe("client-1");
            expect(sub.subscriptionId).toBeDefined();
            expect(typeof sub.subscriptionId).toBe("string");
            expect(sub.subscriptionId.length).toBeGreaterThan(0);
            expect(sub.displayName).toBeDefined();
        });

        it("uses provided displayName", () => {
            const sub = mgr.create("client-1", "client-1", "My Subscription");

            expect(sub.displayName).toBe("My Subscription");
        });

        it("uses empty string when no displayName provided", () => {
            const sub = mgr.create("client-1", "client-1");

            expect(sub.displayName).toBe("");
        });

        it("creates two separate subscriptions for same clientId", () => {
            const sub1 = mgr.create("client-1", "client-1");
            const sub2 = mgr.create("client-1", "client-1");

            expect(sub1.subscriptionId).not.toBe(sub2.subscriptionId);
        });
    });

    /* ---- list ---- */

    describe("list", () => {
        it("returns matching subscriptions", () => {
            const sub1 = mgr.create("client-1", "client-1", "Sub A");
            const sub2 = mgr.create("client-1", "client-1", "Sub B");

            const result = mgr.list("client-1", [sub1.subscriptionId, sub2.subscriptionId]);

            expect(result).toHaveLength(2);
            expect(result.map(s => s.subscriptionId).sort()).toEqual(
                [sub1.subscriptionId, sub2.subscriptionId].sort(),
            );
        });

        it("returns empty for unknown subscriptionId", () => {
            mgr.create("client-1", "client-1");

            const result = mgr.list("client-1", ["nonexistent-id"]);

            expect(result).toHaveLength(0);
        });

        it("filters out subscriptions belonging to different clientId", () => {
            const sub = mgr.create("client-1", "client-1");

            const result = mgr.list("client-2", [sub.subscriptionId]);

            expect(result).toHaveLength(0);
        });
    });

    /* ---- getOne ---- */

    describe("getOne", () => {
        it("returns subscription with empty monitoredObjects initially", () => {
            const sub = mgr.create("client-1", "client-1", "Sub A");

            const result = mgr.getOne("client-1", sub.subscriptionId);

            expect(result).toEqual({
                clientId: "client-1",
                subscriptionId: sub.subscriptionId,
                displayName: "Sub A",
                monitoredObjects: [],
            });
        });

        it("includes registered elements with their maxDepth", () => {
            const sub = mgr.create("client-1", "client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1", "elem-2"], 3);

            const result = mgr.getOne("client-1", sub.subscriptionId);

            expect(result.monitoredObjects).toEqual(
                expect.arrayContaining([
                    { elementId: "elem-1", maxDepth: 3 },
                    { elementId: "elem-2", maxDepth: 3 },
                ]),
            );
            expect(result.monitoredObjects).toHaveLength(2);
        });

        it("reflects different maxDepth per element when registered separately", () => {
            const sub = mgr.create("client-1", "client-1");
            mgr.registerOne("client-1", sub.subscriptionId, "elem-1", 1);
            mgr.registerOne("client-1", sub.subscriptionId, "elem-2", 5);

            const result = mgr.getOne("client-1", sub.subscriptionId);

            expect(result.monitoredObjects).toEqual(
                expect.arrayContaining([
                    { elementId: "elem-1", maxDepth: 1 },
                    { elementId: "elem-2", maxDepth: 5 },
                ]),
            );
        });

        it("throws 404 for unknown subscriptionId", () => {
            try {
                mgr.getOne("client-1", "does-not-exist");
                fail("expected getOne to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");
            try {
                mgr.getOne("client-2", sub.subscriptionId);
                fail("expected getOne to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- deleteOne ---- */

    describe("deleteOne", () => {
        it("removes subscription", () => {
            const sub = mgr.create("client-1", "client-1");
            mgr.deleteOne("client-1", sub.subscriptionId);

            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(0);
        });

        it("throws 404 for unknown subscription", () => {
            try {
                mgr.deleteOne("client-1", "nonexistent-id");
                throw new Error("expected throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
                expect(err.message).toMatch(/not found/);
            }
        });

        it("throws 404 when subscription belongs to a different owner", () => {
            const sub = mgr.create("client-1", "client-1");
            try {
                mgr.deleteOne("client-2", sub.subscriptionId);
                throw new Error("expected throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }

            /* Subscription is untouched */
            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(1);
        });
    });

    /* ---- register ---- */

    describe("register", () => {
        it("adds elementIds to subscription", () => {
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");

            expect(() => {
                mgr.register("client-1", sub.subscriptionId, ["elem-1"]);
                mgr.register("client-1", sub.subscriptionId, ["elem-1"]);
            }).not.toThrow();
        });

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");

            try {
                mgr.register("client-2", sub.subscriptionId, ["elem-1"]);
                fail("expected register to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for unknown subscriptionId", () => {
            try {
                mgr.register("client-1", "does-not-exist", ["elem-1"]);
                fail("expected register to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- registerOne ---- */

    describe("registerOne", () => {
        it("adds a single elementId to subscription", () => {
            const sub = mgr.create("client-1", "client-1");
            mgr.registerOne("client-1", sub.subscriptionId, "elem-1");

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(1);
            expect(items[0].elementId).toBe("elem-1");
        });

        it("throws 404 for unknown subscriptionId", () => {
            try {
                mgr.registerOne("client-1", "does-not-exist", "elem-1");
                fail("expected registerOne to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");
            try {
                mgr.registerOne("client-2", sub.subscriptionId, "elem-1");
                fail("expected registerOne to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- unregister ---- */

    describe("unregister", () => {
        it("removes elementIds from subscription", () => {
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");
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

        it("throws 404 for unknown subscriptionId", () => {
            try {
                mgr.unregister("client-1", "does-not-exist", ["elem-1"]);
                fail("expected unregister to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");
            try {
                mgr.unregister("client-2", sub.subscriptionId, ["elem-1"]);
                fail("expected unregister to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- unregisterOne ---- */

    describe("unregisterOne", () => {
        it("removes a single elementId from subscription", () => {
            const sub = mgr.create("client-1", "client-1");
            mgr.register("client-1", sub.subscriptionId, ["elem-1", "elem-2"]);
            mgr.unregisterOne("client-1", sub.subscriptionId, "elem-1");

            const listener = valueCache.onValueChange.mock.calls[0][0] as (
                elementId: string,
                vqt: I3xVqt,
            ) => void;
            listener("elem-1", makeVqt(100));

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(0);
        });

        it("throws 404 for unknown subscriptionId", () => {
            try {
                mgr.unregisterOne("client-1", "does-not-exist", "elem-1");
                fail("expected unregisterOne to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");
            try {
                mgr.unregisterOne("client-2", sub.subscriptionId, "elem-1");
                fail("expected unregisterOne to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- onValueChange ---- */

    describe("onValueChange", () => {
        it("queues item with correct sequenceNumber", () => {
            const sub = mgr.create("client-1", "client-1");
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
            const sub1 = mgr.create("client-1", "client-1");
            const sub2 = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");

            const items = mgr.sync("client-1", sub.subscriptionId);
            expect(items).toHaveLength(0);
        });

        it("sequence numbers are monotonically increasing", () => {
            const sub = mgr.create("client-1", "client-1");
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

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");

            try {
                mgr.sync("client-2", sub.subscriptionId);
                fail("expected sync to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for unknown subscriptionId", () => {
            try {
                mgr.sync("client-1", "does-not-exist");
                fail("expected sync to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- stream (SSE) ---- */

    describe("stream", () => {
        it("sets SSE headers on response", () => {
            const sub = mgr.create("client-1", "client-1");
            const res = mockSseRes();

            mgr.stream("client-1", sub.subscriptionId, res);

            expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream; charset=utf-8");
            expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
            expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
            expect(res.flushHeaders).toHaveBeenCalled();
        });

        it("flushes queued items immediately", () => {
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");
            const res1 = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res1);

            const res2 = mockSseRes();
            expect(() =>
                mgr.stream("client-1", sub.subscriptionId, res2),
            ).toThrow();
        });

        it("clears activeStream on res close", () => {
            const sub = mgr.create("client-1", "client-1");
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
            const sub = mgr.create("client-1", "client-1");
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

        it("throws 404 for unknown subscriptionId", () => {
            const res = mockSseRes();
            try {
                mgr.stream("client-1", "does-not-exist", res);
                fail("expected stream to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });

        it("throws 404 for a different owner", () => {
            const sub = mgr.create("client-1", "client-1");
            const res = mockSseRes();
            try {
                mgr.stream("client-2", sub.subscriptionId, res);
                fail("expected stream to throw");
            } catch (err: any) {
                expect(err.status).toBe(404);
            }
        });
    });

    /* ---- TTL ---- */

    describe("TTL", () => {
        it("subscription expires after timeout", () => {
            const sub = mgr.create("client-1", "client-1");

            jest.advanceTimersByTime(TTL + 1);

            const result = mgr.list("client-1", [sub.subscriptionId]);
            expect(result).toHaveLength(0);
        });

        it("access resets the timer", () => {
            const sub = mgr.create("client-1", "client-1");

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
            const sub = mgr.create("client-1", "client-1");

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
            const sub = mgr.create("client-1", "client-1");
            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            jest.advanceTimersByTime(TTL + 1);

            expect(res.end).toHaveBeenCalled();
        });
    });

    /* ---- destroy ---- */

    describe("destroy", () => {
        it("cleans up all subscriptions and timers", () => {
            const sub1 = mgr.create("client-1", "client-1");
            const sub2 = mgr.create("client-2", "client-2");

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
            const sub = mgr.create("client-1", "client-1");
            const res = mockSseRes();
            mgr.stream("client-1", sub.subscriptionId, res);

            mgr.destroy();

            expect(res.end).toHaveBeenCalled();
        });
    });

    /* ---- ownership ---- */

    describe("ownership", () => {
        /* The two principals both call themselves the same thing on the
         * wire. Under the old clientId-only check that was enough to
         * take the subscription over. */
        const OWNER = "alice@REALM";
        const ATTACKER = "mallory@REALM";
        const CLIENT_ID = "shared-client-id";

        function expect_not_found(fn: () => unknown, what: string) {
            try {
                fn();
                fail(`expected ${what} to throw`);
            } catch (err: any) {
                expect(err.status).toBe(404);
                expect(err.message).toMatch(/not found/);
            }
        }

        it("does not let a caller claim a subscription by sending its clientId", () => {
            const sub = mgr.create(OWNER, CLIENT_ID);

            /* Mallory knows the subscriptionId and the clientId. */
            expect_not_found(() => mgr.getOne(ATTACKER, sub.subscriptionId), "getOne");
            expect_not_found(() => mgr.sync(ATTACKER, sub.subscriptionId), "sync");
            expect_not_found(
                () => mgr.stream(ATTACKER, sub.subscriptionId, mockSseRes()), "stream");
            expect_not_found(
                () => mgr.register(ATTACKER, sub.subscriptionId, ["elem-1"]), "register");
            expect_not_found(
                () => mgr.registerOne(ATTACKER, sub.subscriptionId, "elem-1"), "registerOne");
            expect_not_found(
                () => mgr.unregister(ATTACKER, sub.subscriptionId, ["elem-1"]), "unregister");
            expect_not_found(
                () => mgr.unregisterOne(ATTACKER, sub.subscriptionId, "elem-1"), "unregisterOne");
            expect_not_found(() => mgr.deleteOne(ATTACKER, sub.subscriptionId), "deleteOne");

            /* Nothing was destroyed along the way. */
            expect(mgr.list(OWNER, [sub.subscriptionId])).toHaveLength(1);
        });

        it("reports a foreign subscription identically to an unknown one", () => {
            const sub = mgr.create(OWNER, CLIENT_ID);

            const foreign = (() => {
                try { mgr.getOne(ATTACKER, sub.subscriptionId); return null; }
                catch (err: any) { return err; }
            })();
            const unknown = (() => {
                try { mgr.getOne(ATTACKER, "9d1e0e4e-0000-0000-0000-000000000000"); return null; }
                catch (err: any) { return err; }
            })();

            expect(foreign.status).toBe(404);
            expect(unknown.status).toBe(404);
            /* Both messages are the plain "not found" form; neither
             * leaks that the id exists or who owns it. */
            expect(foreign.message).toBe(`Subscription ${sub.subscriptionId} not found`);
            expect(foreign.message).not.toMatch(new RegExp(OWNER));
            expect(foreign.message).not.toMatch(/belong/);
        });

        it("never reports 403 from any subscription operation", () => {
            const sub = mgr.create(OWNER, CLIENT_ID);
            const calls: Array<() => unknown> = [
                () => mgr.getOne(ATTACKER, sub.subscriptionId),
                () => mgr.sync(ATTACKER, sub.subscriptionId),
                () => mgr.deleteOne(ATTACKER, sub.subscriptionId),
                () => mgr.getOne("", sub.subscriptionId),
                () => mgr.getOne(undefined as any, sub.subscriptionId),
            ];
            for (const call of calls) {
                try {
                    call();
                    fail("expected throw");
                } catch (err: any) {
                    expect(err.status).toBe(404);
                }
            }
        });

        it("keeps two principals which share a clientId apart", () => {
            const a = mgr.create("alice@REALM", CLIENT_ID);
            const b = mgr.create("bob@REALM", CLIENT_ID);

            expect(mgr.list("alice@REALM", [a.subscriptionId, b.subscriptionId]))
                .toEqual([expect.objectContaining({ subscriptionId: a.subscriptionId })]);
            expect(mgr.list("bob@REALM", [a.subscriptionId, b.subscriptionId]))
                .toEqual([expect.objectContaining({ subscriptionId: b.subscriptionId })]);
        });

        it("lets one principal use two different clientIds", () => {
            /* Two browser tabs, one login, different random clientIds. */
            const tab1 = mgr.create(OWNER, "tab-1");
            const tab2 = mgr.create(OWNER, "tab-2");

            expect(mgr.getOne(OWNER, tab1.subscriptionId).clientId).toBe("tab-1");
            expect(mgr.getOne(OWNER, tab2.subscriptionId).clientId).toBe("tab-2");
        });

        it("survives the full lifecycle for a single principal", () => {
            const sub = mgr.create(OWNER, CLIENT_ID, "Lifecycle");
            expect(sub.clientId).toBe(CLIENT_ID);

            mgr.register(OWNER, sub.subscriptionId, ["elem-1"], 2);
            expect(mgr.getOne(OWNER, sub.subscriptionId).monitoredObjects)
                .toEqual([{ elementId: "elem-1", maxDepth: 2 }]);

            const listener = valueCache.onValueChange.mock.calls[0][0] as
                (elementId: string, vqt: I3xVqt) => void;
            listener("elem-1", makeVqt(7));

            const items = mgr.sync(OWNER, sub.subscriptionId);
            expect(items).toHaveLength(1);
            expect(items[0].value).toBe(7);

            const res = mockSseRes();
            mgr.stream(OWNER, sub.subscriptionId, res);
            listener("elem-1", makeVqt(8));
            expect(res.write).toHaveBeenCalled();

            mgr.deleteOne(OWNER, sub.subscriptionId);
            expect(mgr.list(OWNER, [sub.subscriptionId])).toHaveLength(0);
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
