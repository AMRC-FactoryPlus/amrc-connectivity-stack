/*
 * ACS Edge Agent
 * Edge Scout live values against fake ConfigDB, broker and driver
 * Copyright 2026 University of Sheffield
 */

import { MAX_VALUES_ENTRY, read_interval } from "../../../lib/scout-reads";

import {
    conn_uuid, GateBudget, item, NODE, rig, schemas, sleep, TIMING, until,
} from "./harness";

const C0 = conn_uuid(0);
const LEASE = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
/* Reads every 50 ms in these tests. */
const ENV = { SCOUT_READ_INTERVAL_MS: "50" };

let errors: jest.SpyInstance;
beforeEach(() => { errors = jest.spyOn(console, "error").mockImplementation(() => {}); });

const running: any[] = [];
async function make (opts: any = {}) {
    const r = await rig({ env: ENV, ...opts });
    running.push(r);
    return r;
}
afterEach(async () => {
    for (const r of running.splice(0)) await r.mgr.stop();
    errors.mockRestore();
});

/* A rig whose driver is UP and reads values. */
async function reading (opts: any = {}) {
    const r = await make(opts);
    await r.ready(0, { reads: true });
    await until(() => r.svc.status(C0).reads === true, "reads to be recorded");
    return r;
}

const watch = (r: any, lease: number, addresses: string[], i = 0) =>
    r.request({ op: "watch", lease: LEASE(lease), addresses }, i);
const unwatch = (r: any, lease: number, i = 0) =>
    r.request({ op: "unwatch", lease: LEASE(lease) }, i);

/* The reads sent to the driver so far. */
const reads = (r: any, i = 0) => r.broker.scout(`drv${i}`).filter((m: any) => m.op == "read");

async function next_read (r: any, after: number, i = 0) {
    await until(() => reads(r, i).length > after, "a read");
    return reads(r, i)[after];
}

/* Answer a read with a value for each address, made by `fn`. */
function answer (r: any, read: any, fn = (a: string) => ({ value: `v:${a}` }), i = 0) {
    r.conns[i].found(read.id, {
        seq: 0, type: "values",
        values: read.addresses.map((a: string) => ({
            address: a, value: null, type: "String", ts: 1795600000000, error: null, ...fn(a),
        })),
    });
}

const values = (r: any, i = 0) => r.svc.values(conn_uuid(i));
const last_request = (r: any, i = 0) => r.svc.status(conn_uuid(i))?.last_request;

describe("the hello", () => {
    it("records reads in the status entry", async () => {
        const r = await reading();
        expect(r.svc.status(C0)).toMatchObject({ supported: true, reads: true });
        const bad = schemas.check("status", r.svc.status(C0));
        expect(bad).toBeNull();
    });

    it("records reads false for a hello without the key", async () => {
        const r = await make();
        await r.ready();
        expect(r.svc.status(C0).reads).toBe(false);
    });
});

describe("watch refusals", () => {
    it("answers NOREADS when the hello says the driver can't read", async () => {
        const r = await make();
        await r.ready();
        watch(r, 1, ["a"]);
        await until(() => last_request(r)?.code, "refusal");
        expect(last_request(r)).toMatchObject({ code: "NOREADS" });
        await sleep(100);
        expect(reads(r)).toHaveLength(0);
    });

    it.each([["DOWN", "NODRIVER"], ["CONF", "NODRIVER"]])(
        "answers %s with %s", async (status, code) => {
            const r = await make();
            r.conns[0].status = status;
            watch(r, 1, ["a"]);
            await until(() => last_request(r)?.code, "refusal");
            expect(last_request(r).code).toBe(code);
        });

    it("answers LIBRARY for a driver built before scouting", async () => {
        const r = await make();
        r.conns[0].status = "UP";
        r.conns[0].up_since = Date.now() - 60_000;
        watch(r, 1, ["a"]);
        await until(() => last_request(r)?.code, "refusal");
        expect(last_request(r).code).toBe("LIBRARY");
    });

    it("answers REQUEST to a malformed watch", async () => {
        const r = await reading();
        watch(r, 1, Array.from({ length: 41 }, (_, i) => `a${i}`));
        await until(() => last_request(r)?.code, "refusal");
        expect(last_request(r).code).toBe("REQUEST");
    });

    it("answers UNDEPLOYED for a connection it doesn't run", async () => {
        const r = await make();
        r.request({ op: "watch", lease: LEASE(1), addresses: ["a"], connection: conn_uuid(7) });
        await until(() => r.svc.status(conn_uuid(7)), "refusal");
        expect(r.svc.status(conn_uuid(7)).last_request.code).toBe("UNDEPLOYED");
    });

    it("answers LIMIT to a fifth lease, and renewing one of four is fine", async () => {
        const r = await reading();
        for (let i = 1; i <= 4; i++) watch(r, i, [`a${i}`]);
        await until(() => r.mgr && reads(r).length > 0, "a read");
        const puts = r.svc.puts.length;
        watch(r, 2, ["b"]);
        await sleep(30);
        expect(r.svc.puts).toHaveLength(puts);

        watch(r, 5, ["c"]);
        await until(() => last_request(r)?.code, "refusal");
        expect(last_request(r).code).toBe("LIMIT");
    });

    it("writes nothing to the status entry for an accepted watch", async () => {
        const r = await reading();
        const puts = r.svc.puts.length;
        watch(r, 1, ["a"]);
        await next_read(r, 0);
        watch(r, 1, ["a"]);
        await sleep(50);
        expect(r.svc.puts).toHaveLength(puts);
    });
});

describe("the read loop", () => {
    it("reads the leased addresses and writes the values entry", async () => {
        const r = await reading();
        watch(r, 1, ["a", "b"]);
        const read = await next_read(r, 0);
        expect(read).toMatchObject({ op: "read", version: 1, addresses: ["a", "b"] });
        expect(read.id).toMatch(/^\w{1,64}$/);
        expect(schemas.check("request", read)).toBeNull();

        answer(r, read);
        await until(() => values(r)?.values?.b, "values");
        const entry = values(r);
        expect(schemas.check("values", entry)).toBeNull();
        expect(entry).toMatchObject({
            version: 1, node: NODE, interval_ms: 50, leases: 1, dropped: 0,
            values: {
                a: { value: "v:a", type: "String", ts: 1795600000000, error: null },
                b: { value: "v:b", type: "String", ts: 1795600000000, error: null },
            },
        });
        expect(typeof entry.values.a.read).toBe("string");
    });

    it("keeps one read in flight, and records TIMEOUT for an unanswered one", async () => {
        const r = await reading();
        watch(r, 1, ["a", "b"]);
        await next_read(r, 0);
        await sleep(TIMING.read_timeout_ms - 50);
        expect(reads(r)).toHaveLength(1);

        await until(() => values(r)?.values?.a, "timeout");
        expect(values(r).values).toMatchObject({
            a: { value: null, error: "TIMEOUT" },
            b: { value: null, error: "TIMEOUT" },
        });
        await next_read(r, 1);
    });

    it("keeps the last value with a TIMEOUT", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        answer(r, await next_read(r, 0));
        await until(() => values(r)?.values?.a, "value");
        await next_read(r, 1);
        await until(() => values(r).values.a.error == "TIMEOUT", "timeout");
        expect(values(r).values.a.value).toBe("v:a");
    });

    it("writes only when a value changes, and at least every refresh", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        answer(r, await next_read(r, 0));
        await until(() => r.svc.value_puts.length == 1, "first write");
        const t0 = Date.now();

        /* The same value again and again: no write until the refresh. */
        let n = 1;
        while (Date.now() - t0 < TIMING.values_refresh_ms - 100) {
            watch(r, 1, ["a"]);
            answer(r, await next_read(r, n++));
            await sleep(5);
            expect(r.svc.value_puts).toHaveLength(1);
        }
        while (r.svc.value_puts.length == 1) {
            watch(r, 1, ["a"]);
            answer(r, await next_read(r, n++));
            await sleep(5);
        }
        expect(Date.now() - t0).toBeGreaterThanOrEqual(TIMING.values_refresh_ms - 60);

        /* A changed value is written at once. */
        const writes = r.svc.value_puts.length;
        answer(r, await next_read(r, n++), () => ({ value: "changed" }));
        await until(() => r.svc.value_puts.length > writes, "change");
        expect(values(r).values.a.value).toBe("changed");
    });

    it("checks each value, cuts long ones and drops addresses it didn't ask for", async () => {
        const r = await reading();
        watch(r, 1, ["a", "b", "c"]);
        const read = await next_read(r, 0);
        r.conns[0].found(read.id, { seq: 0, type: "values", values: [
            { address: "a", value: "x".repeat(2000), type: "String", ts: null, error: "e".repeat(300) },
            { address: "b", value: 12, type: "Int32", ts: null, error: null },
            { address: "zz", value: "1", type: null, ts: null, error: null },
        ] });
        await until(() => values(r)?.values?.c, "values");
        const v = values(r).values;
        expect(v.a.value).toHaveLength(1024);
        expect(v.a.error).toHaveLength(256);
        expect(v.b).toMatchObject({ value: null, error: "The driver gave no valid value" });
        expect(v.c).toMatchObject({ value: null, error: "The driver gave no valid value" });
        expect(v.zz).toBeUndefined();
    });

    it("records a driver's error end against every address", async () => {
        const r = await reading();
        watch(r, 1, ["a", "b"]);
        const read = await next_read(r, 0);
        r.conns[0].found(read.id, { seq: 0, type: "end",
            error: { code: "CONN", message: "The PLC went away" } });
        await until(() => values(r)?.values?.b, "values");
        expect(values(r).values.a.error).toBe("CONN: The PLC went away");
        expect(values(r).values.b.error).toBe("CONN: The PLC went away");
    });

    it("records an invalid answer as an error", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        const read = await next_read(r, 0);
        r.conns[0].found(read.id, {}, "not json");
        await until(() => values(r)?.values?.a, "values");
        expect(values(r).values.a.error).toBe("The driver sent an invalid answer");
    });

    it("records why when the driver is not UP, and reads again when it is", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        answer(r, await next_read(r, 0));
        r.conns[0].set_status("CONF");
        await until(() => values(r)?.values?.a?.error, "error");
        expect(values(r).values.a.error).toMatch(/CONF/);
        expect(values(r).values.a.value).toBe("v:a");
        const n = reads(r).length;
        r.conns[0].set_status("UP", 60_000);
        await next_read(r, n);
    });

    it("waits for the CPU budget", async () => {
        const budget = new GateBudget();
        const r = await reading({ budget });
        budget.open = false;
        watch(r, 1, ["a"]);
        await sleep(150);
        expect(reads(r)).toHaveLength(0);
        budget.open = true;
        await next_read(r, 0);
    });

    it("reads beside a running scan on the same connection", async () => {
        const r = await reading();
        const start = await r.start();
        r.conns[0].found(start.id, { type: "accept" });
        r.conns[0].found(start.id, { type: "items", items: [item("x")] });

        watch(r, 1, ["x"]);
        const read = await next_read(r, 0);
        answer(r, read);
        await until(() => values(r)?.values?.x, "values");
        expect(r.svc.status(C0).state).toBe("running");

        r.conns[0].found(start.id, { type: "items", items: [item("y")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => r.svc.status(C0).state == "done", "scan done");
        expect(r.svc.status(C0).current.items).toBe(2);
    });
});

describe("leases", () => {
    it("caps the union at 40 in lease order, and counts the rest as dropped", async () => {
        const r = await reading();
        const first = Array.from({ length: 30 }, (_, i) => `a${i}`);
        const second = [...first.slice(0, 5), ...Array.from({ length: 20 }, (_, i) => `b${i}`)];
        watch(r, 1, first);
        await next_read(r, 0);
        watch(r, 2, second);
        await until(() => reads(r).some((m: any) => m.addresses.includes("b0")), "union");
        const read = reads(r).find((m: any) => m.addresses.includes("b0"));
        expect(read.addresses).toEqual([...first, ...second.slice(5, 15)]);
        answer(r, read);
        await until(() => values(r)?.leases == 2, "entry");
        expect(values(r).dropped).toBe(10);
    });

    it("writes the empty entry once when the last lease ends", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        watch(r, 2, ["b"]);
        answer(r, await next_read(r, 0));
        await until(() => values(r)?.leases == 2, "entry");

        unwatch(r, 1);
        unwatch(r, 9);
        await sleep(30);
        expect(values(r).leases).toBe(2);
        unwatch(r, 2);
        await until(() => values(r).leases == 0, "empty");
        expect(values(r)).toEqual({ version: 1, node: NODE, updated: expect.any(String),
            leases: 0, values: {} });
        expect(schemas.check("values", values(r))).toBeNull();

        const n = reads(r).length;
        const writes = r.svc.value_puts.length;
        await sleep(150);
        expect(reads(r).length).toBeLessThanOrEqual(n + 1);
        expect(r.svc.value_puts).toHaveLength(writes);
    });

    it("lets a lease expire without renewal", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        answer(r, await next_read(r, 0));
        await until(() => values(r)?.leases == 1, "entry");
        await until(() => values(r).leases == 0, "expiry", TIMING.lease_ms + 500);
    });

    it("keeps a renewed lease alive", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        const t0 = Date.now();
        while (Date.now() - t0 < TIMING.lease_ms * 1.5) {
            watch(r, 1, ["a"]);
            await sleep(50);
        }
        const last = reads(r).length;
        await next_read(r, last);
        expect(values(r)?.leases).not.toBe(0);
    });

    it("drops values of addresses no lease watches", async () => {
        const r = await reading();
        watch(r, 1, ["a", "b"]);
        answer(r, await next_read(r, 0));
        await until(() => values(r)?.values?.b, "values");
        watch(r, 1, ["a"]);
        await until(() => reads(r).some((m: any) => m.addresses.length == 1), "new read");
        const read = reads(r).find((m: any) => m.addresses.length == 1);
        answer(r, read, () => ({ value: "again" }));
        await until(() => values(r).values.a.value == "again", "write");
        expect(values(r).values.b).toBeUndefined();
    });

    it("keeps the entry under 64 KiB, dropping the largest values", async () => {
        const r = await reading();
        const addrs = Array.from({ length: 40 }, (_, i) => `${i}`.padStart(800, "a"));
        watch(r, 1, addrs);
        const read = await next_read(r, 0);
        answer(r, read, a => ({ value: "v".repeat(a.endsWith("0") ? 1024 : 1000) }));
        await until(() => values(r)?.values, "values");
        const entry = values(r);
        expect(Buffer.byteLength(JSON.stringify(entry))).toBeLessThanOrEqual(MAX_VALUES_ENTRY);
        const big = Object.values(entry.values).filter((v: any) => v.error == "Too large to show");
        expect(big.length).toBeGreaterThan(0);
        /* The 1024-character values went first. */
        for (const [a, v] of Object.entries(entry.values) as any)
            if (v.value != null) expect(a.endsWith("0")).toBe(false);
    });
});

describe("start and stop", () => {
    it("writes an entry left with leases empty on init", async () => {
        const r = await make({ conns: 2, before: (svc: any) => {
            svc.set_values(conn_uuid(0), { version: 1, node: NODE, updated: "2026-11-25T10:00:00Z",
                interval_ms: 5000, leases: 2, dropped: 0, values: { a: {
                    value: "1", type: null, ts: null, read: "2026-11-25T10:00:00Z", error: null } } });
            svc.set_values(conn_uuid(1), { version: 1, node: NODE, updated: "2026-11-25T10:00:00Z",
                leases: 0, values: {} });
        } });
        expect(values(r, 0)).toMatchObject({ leases: 0, values: {} });
        expect(r.svc.value_puts.map((p: any) => p.obj)).toEqual([conn_uuid(0)]);
    });

    it("writes the empty entry on stop", async () => {
        const r = await reading();
        watch(r, 1, ["a"]);
        answer(r, await next_read(r, 0));
        await until(() => values(r)?.leases == 1, "entry");
        await r.mgr.stop();
        expect(values(r)).toMatchObject({ leases: 0, values: {} });
    });

    it("holds the read interval to its minimum", () => {
        expect(read_interval({}, 2000)).toBe(5000);
        expect(read_interval({ SCOUT_READ_INTERVAL_MS: "1000" }, 2000)).toBe(2000);
        expect(read_interval({ SCOUT_READ_INTERVAL_MS: "8000" }, 2000)).toBe(8000);
        expect(read_interval({ SCOUT_READ_INTERVAL_MS: "x" }, 2000)).toBe(5000);
    });
});
