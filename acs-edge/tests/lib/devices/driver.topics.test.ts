/*
 * ACS Edge Agent
 * Data topic names given to a split driver's addresses
 * Copyright 2026 University of Sheffield
 */

/* The Edge Agent gives each address a short data topic name (see
 * docs/edge-split.md). Giving one must always finish, whatever the
 * random start, and the names must stay decimal integers, unique
 * within the connection. */

import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";

class FakeBroker {
    sent: any[] = [];
    on () {}
    off () {}
    publish (p: any) { this.sent.push(p); }
}

describe("DriverConnection data topics", () => {
    let conn: DriverConnection | undefined;

    afterEach(async () => {
        jest.restoreAllMocks();
        await conn?.stopSubscription("dev", () => {});
        conn = undefined;
    });

    async function subscribe (addresses: string[]) {
        conn = new DriverConnection("Driver", {}, "drv",
            new FakeBroker() as unknown as DriverBroker);
        await conn.startSubscription({ addresses } as any, "JSON" as any, "",
            3_600_000, "dev", () => {});
        return conn;
    }

    it("gives every address its own name even when the random draw repeats", async () => {
        /* The same draw every time, and a stop after many: a loop
         * that only draws again would never finish. */
        let draws = 0;
        jest.spyOn(Math, "random").mockImplementation(() => {
            if (++draws > 1000) throw new Error("topic allocation did not finish");
            return 0.5;
        });

        const addrs = ["a", "b", "c", "d", "e"];
        const c = await subscribe(addrs);

        const names = addrs.map(a => c.topics.get(a)!);
        expect(new Set(names).size).toBe(addrs.length);
        for (const n of names)
            expect(n).toMatch(/^\d+$/);
        for (const [n, a] of c.addrs)
            expect(c.topics.get(a)).toBe(n);
    });

    it("never reuses a name already given", async () => {
        const c = await subscribe(["a"]);
        const first = c.topics.get("a")!;
        /* A name set by hand, as a driver test does, is skipped. */
        c.addrs.set(String(Number(first) + 1), "x");
        c.topics.set("x", String(Number(first) + 1));

        await c.startSubscription({ addresses: ["b"] } as any, "JSON" as any, "",
            3_600_000, "dev2", () => {});
        await c.stopSubscription("dev2", () => {});

        const b = c.topics.get("b")!;
        expect(b).not.toBe(first);
        expect(b).not.toBe(String(Number(first) + 1));
        expect(c.addrs.get(b)).toBe("b");
    });
});
