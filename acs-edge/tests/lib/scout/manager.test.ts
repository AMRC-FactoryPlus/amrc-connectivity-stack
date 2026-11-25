/*
 * ACS Edge Agent
 * The ScoutManager against fake ConfigDB, Files, broker and driver
 * Copyright 2026 University of Sheffield
 */

import { clamp_limits, DEFAULT_LIMITS, MAX_BACKLOG, MAX_ENTRY, WINDOW } from "../../../lib/scout";
import { sha256_hash } from "../../../lib/scout-snapshot";
import * as UUIDs from "../../../lib/uuids";

import {
    check_snapshot, conn_uuid, GateBudget, item, NODE, OTHER_NODE, rig, schemas, sleep, TIMING, until,
} from "./harness";

const C0 = conn_uuid(0);

/* Keep the agent's stderr out of the test output. */
let errors: jest.SpyInstance;
beforeEach(() => { errors = jest.spyOn(console, "error").mockImplementation(() => {}); });

const running: any[] = [];
async function make (opts: any = {}) {
    const r = await rig(opts);
    running.push(r);
    return r;
}
afterEach(async () => {
    for (const r of running.splice(0)) await r.mgr.stop();
    errors.mockRestore();
});

const last_status = (r: any, i = 0) => r.svc.status(conn_uuid(i));

describe("hello and support", () => {
    it("says hello when the driver subscribes, and records the answer", async () => {
        const r = await make();
        await r.ready();
        expect(r.broker.scout("drv0")).toEqual([{ op: "hello", version: 1 }]);
        const st = last_status(r);
        expect(st).toMatchObject({ version: 1, node: NODE, supported: true });
        expect(r.svc.puts).toHaveLength(1);
    });

    it("writes the hello result only when it changes", async () => {
        const r = await make();
        await r.ready();
        r.conns[0].found("hello", { seq: 0, type: "hello", versions: [1], supported: true });
        await sleep(50);
        expect(r.svc.puts).toHaveLength(1);

        r.conns[0].found("hello", { seq: 0, type: "hello", versions: [1], supported: false });
        await until(() => last_status(r).supported === false, "change");
        expect(r.svc.puts).toHaveLength(2);
    });

    it("writes nothing after a restart when the answer is unchanged", async () => {
        const r = await make({ before: (svc: any) =>
            svc.set_status(C0, { version: 1, node: NODE, supported: true, reads: false }) });
        r.conns[0].set_status("UP");
        r.broker.subscribe("drv0");
        await until(() => r.broker.scout("drv0").length > 0, "hello");
        r.conns[0].found("hello", { seq: 0, type: "hello", versions: [1], supported: true });
        await sleep(50);
        expect(r.svc.puts).toHaveLength(0);
    });

    it("treats a hello without version 1 as unsupported", async () => {
        const r = await make();
        r.conns[0].set_status("UP");
        r.broker.subscribe("drv0");
        await until(() => r.broker.scout("drv0").length > 0, "hello");
        r.conns[0].found("hello", { seq: 0, type: "hello", versions: [2], supported: true });
        await until(() => last_status(r)?.supported === false, "unsupported");
    });

    it("records a driver UP for the library wait without subscribing as built before scouting", async () => {
        const r = await make();
        r.conns[0].set_status("UP");
        await sleep(TIMING.library_ms / 2);
        expect(last_status(r)).toBeUndefined();
        await until(() => last_status(r)?.supported == "library", "library");

        r.request({});
        await until(() => last_status(r).last_request, "refusal");
        expect(last_status(r).last_request).toMatchObject({ code: "LIBRARY" });
        expect(last_status(r).scan).toBeUndefined();
    });

    it("answers LIBRARY for a driver UP longer than the wait, before the check has run", async () => {
        const r = await make();
        r.conns[0].status = "UP";
        r.conns[0].up_since = Date.now() - 60_000;
        r.request({});
        await until(() => last_status(r)?.last_request, "refusal");
        expect(last_status(r).last_request.code).toBe("LIBRARY");
    });
});

describe("refusals", () => {
    it.each(["DOWN", "READY", "CONF", "ADDR", "CONN", "AUTH", "ERR"])(
        "answers NODRIVER with the driver's status %s", async status => {
            const r = await make();
            r.conns[0].status = status;
            r.request({});
            await until(() => last_status(r)?.last_request, "refusal");
            const lr = last_status(r).last_request;
            expect(lr.code).toBe("NODRIVER");
            expect(lr.message).toContain(status);
            expect(lr.request).toMatch(/^00000000-0000-4000-9000-/);
        });

    it("answers NODRIVER for a driver that has only just come UP", async () => {
        const r = await make();
        r.conns[0].set_status("UP");
        r.request({});
        await until(() => last_status(r)?.last_request, "refusal");
        expect(last_status(r).last_request.code).toBe("NODRIVER");
        expect(last_status(r).last_request.message).toMatch(/just started/);
    });

    it("answers UNDEPLOYED for a connection it doesn't run, in a new entry", async () => {
        const r = await make();
        const other = conn_uuid(7);
        r.request({ connection: other });
        await until(() => r.svc.status(other), "refusal");
        expect(r.svc.status(other)).toMatchObject({
            version: 1, node: NODE, supported: null,
            last_request: { code: "UNDEPLOYED" },
        });
        expect(r.svc.status(other).state).toBeUndefined();
    });

    it("leaves another node's entry alone when refusing UNDEPLOYED", async () => {
        const other = conn_uuid(7);
        const theirs = { version: 1, node: OTHER_NODE, supported: true };
        const r = await make({ before: (svc: any) => svc.set_status(other, theirs) });
        r.request({ connection: other });
        await sleep(50);
        expect(r.svc.status(other)).toEqual(theirs);
    });

    it("answers REQUEST to a malformed request, with a null request UUID when it has none", async () => {
        const r = await make();
        await r.ready();
        r.request({ op: "begin", request: "nope" });
        await until(() => last_status(r).last_request, "refusal");
        expect(last_status(r).last_request).toMatchObject({ code: "REQUEST", request: null });
    });

    it("answers REQUEST to options over 8 KiB", async () => {
        const r = await make();
        await r.ready();
        r.request({ options: { big: "x".repeat(9000) } });
        await until(() => last_status(r).last_request, "refusal");
        expect(last_status(r).last_request.code).toBe("REQUEST");
        expect(last_status(r).last_request.message).toMatch(/8192 bytes/);
    });

    it("writes nothing for a request with no connection UUID", async () => {
        const r = await make();
        r.request({ connection: "not-a-uuid" });
        await sleep(30);
        expect(r.svc.puts).toHaveLength(0);
    });

    it("answers BUSY and leaves the running scan's fields alone", async () => {
        const r = await make();
        await r.ready();
        await r.start();
        const before = last_status(r);
        r.request({});
        await until(() => last_status(r).last_request.code == "BUSY", "refusal");
        const after = last_status(r);
        for (const k of ["scan", "request", "state", "started", "options_hash"])
            expect(after[k]).toEqual(before[k]);
    });

    it("answers NOTRUNNING to a cancel with no scan", async () => {
        const r = await make();
        await r.ready();
        r.request({ op: "cancel" });
        await until(() => last_status(r).last_request, "refusal");
        expect(last_status(r).last_request.code).toBe("NOTRUNNING");
    });

    it("queues up to four scans, then answers LIMIT", async () => {
        const r = await make({ conns: 6 });
        for (let i = 0; i < 6; i++) await r.ready(i);
        await r.start({}, 0);
        for (let i = 1; i <= 4; i++) r.request({}, i);
        await until(() => r.mgr.queued == 4, "queue");
        for (let i = 1; i <= 4; i++)
            await until(() => last_status(r, i).state == "queued", "queued");
        r.request({}, 5);
        await until(() => last_status(r, 5).last_request, "refusal");
        expect(last_status(r, 5).last_request.code).toBe("LIMIT");

        /* The next queued scan starts when the first ends. */
        const [start] = r.broker.scout("drv0").filter(m => m.op == "start");
        r.conns[0].found(start.id, { type: "end", error: { code: "ERR", message: "boom" } });
        await until(() => r.broker.scout("drv1").some(m => m.op == "start"), "next scan");
        expect(r.mgr.queued).toBe(3);
    });

    it("runs SCOUT_MAX_CONCURRENT scans at once", async () => {
        const r = await make({ conns: 2, env: { SCOUT_MAX_CONCURRENT: "2" } });
        await r.ready(0);
        await r.ready(1);
        await r.start({}, 0);
        await r.start({}, 1);
        expect(r.mgr.active).toBe(2);
    });
});

describe("a full scan", () => {
    it("runs, uploads a valid snapshot, and records it as current", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start({ options: { root: "x" }, limits: { items: 10 } });

        expect(start).toEqual({
            op: "start", id: expect.stringMatching(/^[0-9a-f]{32}$/), version: 1,
            root: null, folder_id: null, options: { root: "x" },
            limits: { ...DEFAULT_LIMITS, items: 10 }, window: WINDOW,
        });
        expect(schemas_ok("request", start)).toBe(true);

        const st = last_status(r);
        const scan = st.scan;
        expect(scan.replace(/-/g, "")).toBe(start.id);
        expect(st).toMatchObject({ state: "running", code: null,
            options_hash: sha256_hash({ root: "x" }),
            config_hash: "sha256:" + "c".repeat(64),
            last_request: { code: null } });
        expect(r.svc.objects.has(scan)).toBe(true);
        /* The object is made before the driver is asked. */
        expect(r.svc.calls.indexOf(`create_object ${scan}`)).toBeGreaterThan(-1);

        const c = r.conns[0];
        c.found(start.id, { type: "accept" });
        c.found(start.id, { type: "items", items: [
            { id: "f", parent: null, name: "F", kind: "folder" },
            item("f/a", "f"), item("f/b", "f", { access: "rw", unit: "rpm" }),
        ] });
        c.found(start.id, { type: "progress", visited: 7, found: 3, note: "f" });
        await until(() => last_status(r).progress?.found == 3, "progress");
        expect(last_status(r).progress).toEqual({ visited: 7, found: 3, note: "f" });

        c.found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null,
            excluded: [{ id: "i=2253", reason: "skipped", prefixes: ["i="], extra: 1 }] });
        await until(() => last_status(r).state == "done", "done");

        const done = last_status(r);
        expect(done.current).toMatchObject({
            file: scan, items: 3, exhaustive: true, truncated: false, reason: null,
            root: null, options_hash: sha256_hash({ root: "x" }),
            excluded: [{ id: "i=2253", reason: "skipped", prefixes: ["i="] }],
            branches: [],
        });
        expect(done.current.bytes_gz).toBe(r.svc.files.get(scan)!.length);
        expect(done.previous).toBeNull();
        expect(schemas_ok("status", done)).toBe(true);

        const lines = r.svc.snapshot(scan);
        expect(check_snapshot(lines)).toEqual([]);
        expect(lines[0]).toMatchObject({ version: 1, scan, connection: C0,
            driver: "test-driver 1.0.0", root: null, folder_id: null, options: { root: "x" } });
        expect(lines.slice(1, -1).map(l => l.id)).toEqual(["f", "f/a", "f/b"]);
        expect(lines[lines.length - 1].end).toMatchObject({ items: 3, rejected: 0, exhaustive: true });
        expect(r.mgr.active).toBe(0);
    });

    it("uploads the snapshot as a Buffer, so a retry after a 401 sends the same bytes", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        r.conns[0].found(start.id, { type: "items", items: [item("a")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");
        expect(r.svc.bodies).toHaveLength(1);
        expect(Buffer.isBuffer(r.svc.bodies[0])).toBe(true);
    });

    it("drops bad and repeated items, truncates long strings, and counts what it dropped", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        r.conns[0].found(start.id, { type: "items", items: [
            item("a"),
            item("a"),                                      // repeated
            { id: "", parent: null, name: "x", kind: "folder" },    // empty id
            { id: "y".repeat(513), parent: null, name: "x", kind: "folder" },
            { parent: null, name: "no id", kind: "folder" },
            { id: "v", parent: null, name: "v", kind: "value" },    // no address
            { id: "k", parent: null, name: "k", kind: "thing" },    // bad kind
            item("t", null, { type: "Int16BE" }),           // byte order
            item("long", null, { name: "n".repeat(300), unit: "u".repeat(80),
                description: "d".repeat(2000), sample: "s".repeat(300), extra: "dropped" }),
            item("detail", null, { detail: { big: "x".repeat(3000) } }),
        ] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");

        const lines = r.svc.snapshot(last_status(r).scan);
        const items = lines.slice(1, -1);
        expect(items.map(i => i.id)).toEqual(["a", "long", "detail"]);
        const long = items[1];
        expect(long.name).toHaveLength(256);
        expect(long.unit).toHaveLength(64);
        expect(long.description).toHaveLength(1024);
        expect(long.sample).toHaveLength(256);
        expect(long.extra).toBeUndefined();
        expect(items[2].detail).toBeNull();
        expect(lines[lines.length - 1].end).toMatchObject({ items: 3, rejected: 7 });
        expect(check_snapshot(lines)).toEqual([]);
    });

    it("drops a whole items message over 256 KiB", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        const big = Array.from({ length: 300 }, (_, i) =>
            item(`n${i}`, null, { description: "d".repeat(1000) }));
        r.conns[0].found(start.id, { type: "items", items: big });
        r.conns[0].found(start.id, { type: "items", items: [item("ok")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");
        const lines = r.svc.snapshot(last_status(r).scan);
        expect(lines[lines.length - 1].end).toMatchObject({ items: 1, rejected: 300 });
    });

    it("keeps a truncated scan's reason", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        r.conns[0].found(start.id, { type: "items", items: [item("a")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: true, reason: "depth" });
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current).toMatchObject({ truncated: true, reason: "depth" });
    });

    it("stops a driver that sends more than its item cap, and keeps what it allowed", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start({ limits: { items: 2 } });
        r.conns[0].found(start.id, { type: "items", items: [item("a"), item("b"), item("c")] });
        await until(() => r.broker.scout("drv0").some(m => m.op == "cancel"), "cancel");
        r.conns[0].found(start.id, { type: "end", error: { code: "CANCELLED", message: "stopped" } });
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current).toMatchObject({
            items: 2, exhaustive: false, truncated: true, reason: "items" });
    });

    it("stops at SCOUT_MAX_BYTES with reason size", async () => {
        const r = await make({ env: { SCOUT_MAX_BYTES: "600" } });
        await r.ready();
        const start = await r.start();
        r.conns[0].found(start.id, { type: "items", items:
            Array.from({ length: 20 }, (_, i) => item(`node${i}`)) });
        await until(() => r.broker.scout("drv0").some(m => m.op == "cancel"), "cancel");
        r.conns[0].found(start.id, { type: "end", error: { code: "CANCELLED" } });
        await until(() => last_status(r).state == "done", "done");
        const cur = last_status(r).current;
        expect(cur).toMatchObject({ truncated: true, reason: "size" });
        expect(cur.items).toBeGreaterThan(0);
        expect(cur.items).toBeLessThan(20);
        expect(check_snapshot(r.svc.snapshot(cur.file))).toEqual([]);
    });

    it("keeps a capped scan when the driver sends more before its end", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start({ limits: { items: 2 } });
        const c = r.conns[0];
        c.found(start.id, { type: "items", items: [item("a"), item("b"), item("c")] });
        await until(() => r.broker.scout("drv0").some(m => m.op == "cancel"), "cancel");
        /* Sent before the driver saw the cancel. */
        c.found(start.id, { type: "items", items: [item("d")] });
        c.found(start.id, { type: "progress", visited: 9, found: 4 });
        c.found(start.id, { type: "end", error: { code: "CANCELLED", message: "stopped" } });
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current).toMatchObject({ items: 2, truncated: true, reason: "items" });
        expect(r.broker.scout("drv0").filter(m => m.op == "cancel")).toHaveLength(1);
        expect(check_snapshot(r.svc.snapshot(last_status(r).current.file))).toEqual([]);
    });

    it("keeps a capped scan when messages after the cap are lost", async () => {
        const r = await make({ env: { SCOUT_MAX_BYTES: "600" } });
        await r.ready();
        const start = await r.start();
        r.conns[0].found(start.id, { seq: 0, type: "items", items:
            Array.from({ length: 20 }, (_, i) => item(`node${i}`)) });
        await until(() => r.broker.scout("drv0").some(m => m.op == "cancel"), "cancel");
        r.conns[0].found(start.id, { seq: 5, type: "end", error: { code: "CANCELLED" } });
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current.reason).toBe("size");
    });

    it("saves what it has when a capped scan's driver never ends", async () => {
        const r = await make({ env: { SCOUT_MAX_BYTES: "600" } });
        await r.ready();
        const start = await r.start();
        r.conns[0].found(start.id, { type: "items", items:
            Array.from({ length: 20 }, (_, i) => item(`node${i}`)) });
        await until(() => last_status(r).state == "done", "done", 3000);
        expect(last_status(r).current.reason).toBe("size");
    });

    it("rewrites progress at most once per throttle interval", async () => {
        const r = await make({ timing: { throttle_ms: 200 } });
        await r.ready();
        const start = await r.start();
        const before = r.svc.puts.length;
        for (let i = 0; i < 20; i++)
            r.conns[0].found(start.id, { type: "progress", visited: i, found: 0 });
        await sleep(100);
        expect(r.svc.puts.length - before).toBeLessThanOrEqual(1);
        await sleep(250);
        expect(last_status(r).progress.visited).toBe(19);
    });
});

describe("ending a scan early", () => {
    async function running_scan (opts: any = {}) {
        const r = await make(opts);
        await r.ready();
        const start = await r.start(opts.req ?? {});
        return { r, start, scan: last_status(r).scan };
    }

    it("cancels a running scan through the driver, and deletes its object", async () => {
        const { r, start, scan } = await running_scan();
        r.request({ op: "cancel" });
        await until(() => r.broker.scout("drv0").some(m => m.op == "cancel"), "cancel");
        expect(r.broker.scout("drv0").pop()).toEqual({ op: "cancel", id: start.id });
        r.conns[0].found(start.id, { type: "end", error: { code: "CANCELLED", message: "Stopped" } });
        await until(() => last_status(r).state == "cancelled", "cancelled");
        expect(last_status(r).code).toBe("CANCELLED");
        expect(last_status(r).current).toBeUndefined();
        await until(() => !r.svc.objects.has(scan), "object deleted");
        /* Files first, because it checks the object's class. */
        expect(r.svc.calls.indexOf(`files DELETE ${scan}`))
            .toBeLessThan(r.svc.calls.indexOf(`delete_object ${scan}`));
    });

    it("cancels a queued scan without asking the driver", async () => {
        const r = await make({ conns: 2 });
        await r.ready(0);
        await r.ready(1);
        await r.start({}, 0);
        r.request({}, 1);
        await until(() => last_status(r, 1).state == "queued", "queued");
        r.request({ op: "cancel" }, 1);
        await until(() => last_status(r, 1).state == "cancelled", "cancelled");
        expect(r.broker.scout("drv1").filter(m => m.op != "hello")).toEqual([]);
        expect(r.mgr.queued).toBe(0);
    });

    it("fails with the driver's code, keeping the previous snapshot", async () => {
        const { r, start } = await running_scan();
        r.conns[0].found(start.id, { type: "end", error: { code: "CONN", message: "No server" } });
        await until(() => last_status(r).state == "failed", "failed");
        expect(last_status(r)).toMatchObject({ code: "CONN", message: "No server" });
    });

    it("ends with LOST on a gap in seq, and cancels", async () => {
        const { r, start, scan } = await running_scan();
        r.conns[0].found(start.id, { seq: 0, type: "accept" });
        r.conns[0].found(start.id, { seq: 2, type: "items", items: [item("a")] });
        await until(() => last_status(r).state == "failed", "failed");
        expect(last_status(r).code).toBe("LOST");
        expect(r.broker.scout("drv0").pop()).toEqual({ op: "cancel", id: start.id });
        await until(() => !r.svc.objects.has(scan), "object deleted");
    });

    it("ends with AGENT on a message that isn't valid", async () => {
        const { r, start } = await running_scan();
        r.conns[0].found(start.id, {}, "{not json");
        await until(() => last_status(r).state == "failed", "failed");
        expect(last_status(r).code).toBe("AGENT");
    });

    it("ends with TIMEOUT when the driver goes quiet", async () => {
        const { r, start } = await running_scan();
        r.conns[0].found(start.id, { type: "accept" });
        await sleep(TIMING.silence_ms / 2);
        r.conns[0].found(start.id, { type: "progress", visited: 1, found: 0 });
        await sleep(TIMING.silence_ms / 2 + 50);
        expect(last_status(r).state).toBe("running");
        await until(() => last_status(r).state == "failed", "timeout", 2000);
        expect(last_status(r).code).toBe("TIMEOUT");
        expect(last_status(r).message).toMatch(/sent nothing/);
        expect(r.broker.scout("drv0").pop()).toEqual({ op: "cancel", id: start.id });
    });

    it("ends with TIMEOUT at the deadline even while the driver talks", async () => {
        const { r, start } = await running_scan({ req: { limits: { seconds: 1 } } });
        const t = setInterval(() =>
            r.conns[0].found(start.id, { type: "progress", visited: 1, found: 0 }), 50);
        try {
            await until(() => last_status(r).state == "failed", "deadline", 3000);
        }
        finally {
            clearInterval(t);
        }
        expect(last_status(r).code).toBe("TIMEOUT");
        expect(last_status(r).message).toMatch(/deadline/);
    });

    it.each([
        ["the driver leaves UP", (r: any) => r.conns[0].set_status("CONN")],
        ["the driver disconnects", (r: any) => r.broker.unsubscribe("drv0")],
        ["the driver sends a new hello", (r: any) => r.conns[0].found("hello",
            { seq: 0, type: "hello", versions: [1], supported: true })],
    ])("ends with INTERRUPTED when %s", async (_why, act) => {
        const { r, start } = await running_scan();
        act(r);
        await until(() => last_status(r).state == "failed", "interrupted");
        expect(last_status(r).code).toBe("INTERRUPTED");
        expect(r.broker.scout("drv0").pop()).toEqual({ op: "cancel", id: start.id });
    });

    it("keeps the connection busy until the driver ends a scan the agent stopped", async () => {
        const { r, start } = await running_scan();
        r.conns[0].found(start.id, { seq: 3, type: "accept" });
        await until(() => last_status(r).state == "failed", "failed");
        expect(last_status(r).code).toBe("LOST");

        r.request({});
        await until(() => last_status(r).last_request.code == "BUSY", "busy");
        expect(last_status(r).last_request.message).toMatch(/still stopping/);
        expect(r.broker.scout("drv0").filter(m => m.op == "cancel")).toHaveLength(1);

        /* The driver's end for the old scan frees the connection. */
        r.conns[0].found(start.id, { seq: 4, type: "end", error: { code: "CANCELLED" } });
        const next = await r.start();
        expect(next.id).not.toBe(start.id);
    });

    it("frees a stopped connection after the drain time if the driver never ends", async () => {
        const { r } = await running_scan();
        r.conns[0].found(r.broker.scout("drv0").pop().id, {}, "{not json");
        await until(() => last_status(r).state == "failed", "failed");
        r.request({});
        await until(() => last_status(r).last_request.code == "BUSY", "busy");
        await sleep(TIMING.drain_ms + 50);
        await r.start();
        expect(last_status(r).state).toBe("running");
    });

    it("doesn't hold a connection whose driver has gone", async () => {
        const { r } = await running_scan();
        r.broker.unsubscribe("drv0");
        await until(() => last_status(r).state == "failed", "interrupted");
        r.broker.subscribe("drv0");
        await r.start();
        expect(last_status(r).state).toBe("running");
    });

    it("ignores messages for a scan that isn't running", async () => {
        const { r, start } = await running_scan();
        r.conns[0].found("0123456789abcdef0123456789abcdef", { seq: 0, type: "accept" });
        r.conns[0].found(start.id, { type: "items", items: [item("a")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current.items).toBe(1);
    });

    it("ends with STORE when the File object can't be made, before asking the driver", async () => {
        const r = await make({ before: (svc: any) => svc.create_fails = true });
        await r.ready();
        r.request({});
        await until(() => last_status(r).state == "failed", "failed");
        expect(last_status(r).code).toBe("STORE");
        expect(r.broker.scout("drv0").filter(m => m.op == "start")).toEqual([]);
    });

    it.each([
        [403, /Upload permission/],
        [404, /File object/],
        [409, /already holds/],
        [0, /Can't reach/],
        [500, /answered 500/],
    ])("ends with STORE naming the cause when Files answers %s", async (status, why) => {
        const { r, start, scan } = await running_scan({ before: (svc: any) => svc.upload_status = status });
        r.conns[0].found(start.id, { type: "items", items: [item("a")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "failed", "failed");
        expect(last_status(r).code).toBe("STORE");
        expect(last_status(r).message).toMatch(why);
        expect(last_status(r).current).toBeUndefined();
        await until(() => !r.svc.objects.has(scan), "object deleted");
    });
});

describe("retention and recovery", () => {
    async function full_scan (r: any, items: string[]) {
        const start = await r.start();
        r.conns[0].found(start.id, { type: "items", items: items.map(i => item(i)) });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done" && last_status(r).scan.replace(/-/g, "") == start.id, "done");
        return last_status(r).scan;
    }

    it("keeps the current and previous snapshots and deletes the one that drops out", async () => {
        const r = await make();
        await r.ready();
        const a = await full_scan(r, ["a"]);
        const b = await full_scan(r, ["b"]);
        expect(last_status(r).current.file).toBe(b);
        expect(last_status(r).previous.file).toBe(a);
        const c = await full_scan(r, ["c"]);
        expect(last_status(r).current.file).toBe(c);
        expect(last_status(r).previous.file).toBe(b);
        await until(() => !r.svc.objects.has(a) && !r.svc.files.has(a), "a deleted");
        expect(r.svc.objects.has(b) && r.svc.objects.has(c)).toBe(true);
    });

    it("stores the queued entry before making the File object", async () => {
        const r = await make();
        await r.ready();
        let open!: () => void;
        r.svc.put_gate = new Promise<void>(res => open = res);
        r.request({});
        await sleep(50);
        expect(r.svc.calls.some(c => c.startsWith("create_object"))).toBe(false);
        r.svc.put_gate = null;
        open();
        await until(() => last_status(r).state == "running", "running");
        const scan = last_status(r).scan;
        expect(r.svc.puts.some(p => p.entry.scan == scan && p.entry.state == "queued")).toBe(true);
        expect(r.svc.objects.has(scan)).toBe(true);
    });

    it("ends with STORE and makes no object when the queued entry can't be stored", async () => {
        const r = await make();
        await r.ready();
        r.svc.put_fails = true;
        r.request({});
        await sleep(100);
        expect(r.svc.calls.some(c => c.startsWith("create_object"))).toBe(false);
        expect(r.broker.scout("drv0").filter(m => m.op == "start")).toEqual([]);
        r.svc.put_fails = false;
        await until(() => last_status(r).state == "failed", "failed recorded");
        expect(last_status(r).code).toBe("STORE");
    });

    it("keeps the dropped snapshot until the done entry is stored", async () => {
        const r = await make();
        await r.ready();
        const a = await full_scan(r, ["a"]);
        const b = await full_scan(r, ["b"]);

        const start = await r.start();
        r.svc.put_fails = true;
        r.conns[0].found(start.id, { type: "items", items: [item("c")] });
        r.conns[0].found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        const c = start.id;
        await until(() => [...r.svc.files.keys()].some(f => f.replace(/-/g, "") == c), "upload");
        await sleep(150);
        /* ConfigDB still names a as previous, so it stays. */
        expect(last_status(r)).toMatchObject({ state: "running", current: { file: b }, previous: { file: a } });
        expect(r.svc.objects.has(a) && r.svc.files.has(a)).toBe(true);

        r.svc.put_fails = false;
        await until(() => last_status(r).state == "done", "done after a retry");
        expect(last_status(r).current.file.replace(/-/g, "")).toBe(c);
        expect(last_status(r).previous.file).toBe(b);
        await until(() => !r.svc.objects.has(a) && !r.svc.files.has(a), "a deleted");
        expect(r.svc.objects.has(b)).toBe(true);
    });

    it("tries a failed end write again until it is stored", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        r.svc.put_fails = true;
        r.conns[0].found(start.id, { type: "end", error: { code: "CONN", message: "No server" } });
        await sleep(150);
        expect(last_status(r).state).toBe("running");
        r.svc.put_fails = false;
        await until(() => last_status(r).state == "failed", "failed after a retry");
        expect(last_status(r).code).toBe("CONN");
    });

    it("holds a merged snapshot to the agent's size cap", async () => {
        const r = await make({ env: { SCOUT_MAX_BYTES: "2000" } });
        await r.ready();
        const start = await r.start();
        const c = r.conns[0];
        c.found(start.id, { type: "items", items: [
            { id: "f", parent: null, name: "f", kind: "folder" },
            ...Array.from({ length: 10 }, (_, i) => item(`a${i}`)),
        ] });
        c.found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "base done");
        const base = last_status(r).current.file;

        const branch = await r.start({ root: "f", folder_id: "f" });
        c.found(branch.id, { type: "items", items: [
            { id: "f", parent: null, name: "f", kind: "folder" },
            ...Array.from({ length: 14 }, (_, i) => item(`f/b${i}`, "f")),
        ] });
        c.found(branch.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done" && last_status(r).current.file != base,
            "branch done");

        const cur = last_status(r).current;
        expect(cur).toMatchObject({ exhaustive: false, truncated: true, reason: "size" });
        expect(cur.items).toBeLessThan(25);
        expect(cur.items).toBeGreaterThan(10);
        const lines = r.svc.snapshot(cur.file);
        expect(check_snapshot(lines)).toEqual([]);
        /* The end line may pass the cap, as for a full scan. */
        const raw = lines.slice(0, -1).map(l => JSON.stringify(l) + "\n").join("");
        expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(2000);
        expect(cur.branches.map((b: any) => b.folder_id)).toEqual(["f"]);
        expect(last_status(r).previous.file).toBe(base);
    });

    it("records a scan left running by a restart as interrupted, and deletes its object", async () => {
        const lost = "abcdef00-0000-4000-8000-000000000001";
        const r = await make({ before: (svc: any) => {
            svc.objects.add(lost);
            svc.set_status(C0, { version: 1, node: NODE, supported: true,
                scan: lost, state: "running", code: null, current: null });
        } });
        expect(last_status(r)).toMatchObject({ state: "failed", code: "INTERRUPTED" });
        expect(r.svc.objects.has(lost)).toBe(false);
        expect(r.svc.calls.indexOf(`files DELETE ${lost}`))
            .toBeLessThan(r.svc.calls.indexOf(`delete_object ${lost}`));
    });

    it("finishes interrupted status writes before stop() returns", async () => {
        const r = await make();
        await r.ready();
        await r.start();
        let open!: () => void;
        r.svc.put_gate = new Promise<void>(res => open = res);
        let stopped = false;
        const stopping = r.mgr.stop().then(() => stopped = true);
        await sleep(30);
        expect(stopped).toBe(false);
        open();
        await stopping;
        expect(last_status(r)).toMatchObject({ state: "failed", code: "INTERRUPTED" });
        expect(r.broker.scout("drv0").pop().op).toBe("cancel");
    });

    it("keeps an entry under 16 KiB by dropping old branches, then excluded prefixes", async () => {
        const long = "p".repeat(256);
        const ref = (file: string) => ({
            file, items: 1, bytes_gz: 1, exhaustive: true, truncated: false, reason: null,
            finished: "2026-11-24T10:00:00.000Z", root: null,
            options_hash: "sha256:" + "a".repeat(64), config_hash: null,
            excluded: Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, reason: "skipped",
                prefixes: [long, long, long, long] })),
            branches: Array.from({ length: 10 }, (_, i) => ({
                folder_id: `f${i}`.padEnd(1000, "f"), finished: "2026-11-24T10:00:00.000Z" })),
        });
        const r = await make({ before: (svc: any) => svc.set_status(C0, {
            version: 1, node: NODE, supported: null,
            current: ref("aaaaaaaa-0000-4000-8000-000000000001"),
            previous: ref("aaaaaaaa-0000-4000-8000-000000000002"),
        }) });
        await r.ready();
        const st = last_status(r);
        expect(Buffer.byteLength(JSON.stringify(st))).toBeLessThanOrEqual(MAX_ENTRY + 64);
        expect(st.current.branches.length).toBeLessThan(10);
        expect(schemas_ok("status", st)).toBe(true);
    });
});

describe("pacing and flow control", () => {
    const acks = (r: any) => r.broker.scout("drv0").filter((m: any) => m.op == "ack");

    it("acks each items message once it is written, for a driver that keeps to the window", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        const c = r.conns[0];
        c.found(start.id, { type: "accept", window: WINDOW });
        c.found(start.id, { type: "items", items: [item("a")] });
        c.found(start.id, { type: "progress", visited: 1, found: 1 });
        c.found(start.id, { type: "items", items: [item("b")] });
        await until(() => acks(r).length == 2, "two acks");
        expect(acks(r)).toEqual([
            { op: "ack", id: start.id, seq: 1 },
            { op: "ack", id: start.id, seq: 3 },
        ]);
        expect(acks(r).every((m: any) => schemas_ok("request", m))).toBe(true);
        c.found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current.items).toBe(2);
    });

    it("sends no acks to a driver whose accept has no window", async () => {
        const r = await make();
        await r.ready();
        const start = await r.start();
        const c = r.conns[0];
        c.found(start.id, { type: "accept" });
        c.found(start.id, { type: "items", items: [item("a")] });
        c.found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");
        expect(acks(r)).toEqual([]);
    });

    it("handles items only while the CPU budget allows", async () => {
        const budget = new GateBudget();
        const r = await make({ budget });
        await r.ready();
        const start = await r.start();
        const c = r.conns[0];
        budget.open = false;
        c.found(start.id, { type: "accept", window: WINDOW });
        c.found(start.id, { type: "items", items: [item("a"), item("b")] });
        await sleep(100);
        expect(acks(r)).toEqual([]);
        expect(last_status(r).progress).toBeNull();

        budget.open = true;
        await until(() => acks(r).length == 1, "the ack");
        await until(() => last_status(r).progress?.found == 2, "progress");
        c.found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await until(() => last_status(r).state == "done", "done");
    });

    it("sees the driver's end at once, so a slow agent doesn't time the scan out", async () => {
        const budget = new GateBudget();
        const r = await make({ budget, timing: { deadline_extra_ms: 100, silence_ms: 300 } });
        await r.ready();
        const start = await r.start({ limits: { seconds: 1 } });
        const c = r.conns[0];
        budget.open = false;
        c.found(start.id, { type: "accept", window: WINDOW });
        c.found(start.id, { type: "items", items: [item("a")] });
        c.found(start.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        await sleep(1300);
        expect(last_status(r).state).toBe("running");

        budget.open = true;
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current).toMatchObject({ items: 1, truncated: false });
    });

    it("stops a driver that runs MAX_BACKLOG ahead at its size cap, keeping what it handled", async () => {
        const budget = new GateBudget();
        const r = await make({ budget });
        await r.ready();
        const start = await r.start();
        const c = r.conns[0];
        c.found(start.id, { type: "accept" });
        c.found(start.id, { type: "items", items: [item("a"), item("b")] });
        await until(() => last_status(r).progress?.found == 2, "the first items");

        budget.open = false;
        const big = (n: number) => Array.from({ length: 200 }, (_, i) =>
            item(`m${n}/${i}`, null, { description: "d".repeat(1000) }));
        let sent = 0;
        for (let n = 0; sent <= MAX_BACKLOG; n++) {
            const msg = { type: "items", items: big(n) };
            sent += JSON.stringify(msg).length;
            c.found(start.id, msg);
        }
        expect(r.broker.scout("drv0").filter((m: any) => m.op == "cancel")).toHaveLength(1);
        c.found(start.id, { type: "end", error: { code: "CANCELLED", message: "stopped" } });

        budget.open = true;
        await until(() => last_status(r).state == "done", "done");
        expect(last_status(r).current).toMatchObject({
            items: 2, exhaustive: false, truncated: true, reason: "size" });
        expect(check_snapshot(r.svc.snapshot(last_status(r).current.file))).toEqual([]);
    });

    it("takes turns between scans on two connections", async () => {
        const r = await make({ conns: 2, env: { SCOUT_MAX_CONCURRENT: "2" } });
        await r.ready(0);
        await r.ready(1);
        const s0 = await r.start({}, 0);
        const s1 = await r.start({}, 1);
        const many = (p: string) => Array.from({ length: 500 }, (_, i) => item(`${p}${i}`));
        for (const [i, s] of [[0, s0], [1, s1]] as const) {
            r.conns[i].found(s.id, { type: "accept" });
            for (let n = 0; n < 4; n++)
                r.conns[i].found(s.id, { type: "items", items: many(`${n}/`) });
            r.conns[i].found(s.id, { type: "end", exhaustive: true, truncated: false, reason: null });
        }
        await until(() => last_status(r, 0).state == "done" && last_status(r, 1).state == "done",
            "both done");
        expect(last_status(r, 0).current.items).toBe(2000);
        expect(last_status(r, 1).current.items).toBe(2000);
    });
});

describe("limits", () => {
    it("fills in defaults and holds requests to the ceilings", () => {
        expect(clamp_limits(undefined)).toEqual(DEFAULT_LIMITS);
        expect(clamp_limits({ items: 1e6, depth: 99, seconds: 9999, pace_ms: 5, samples: true }))
            .toEqual({ items: 50000, depth: 32, seconds: 600, pace_ms: 5, samples: true });
        expect(clamp_limits({ items: 0, depth: -1, pace_ms: -3 }))
            .toMatchObject({ items: 1, depth: 1, pace_ms: 0 });
    });
});

function schemas_ok (name: string, v: any) {
    const bad = schemas.check(name, v);
    if (bad) console.log(`${name}: ${bad}`);
    return bad == null;
}

/* The status app UUID the entries go under. */
test("status entries go under the Edge scout status app", async () => {
    const r = await make();
    await r.ready();
    expect([...r.svc.configs.keys()]).toEqual([`${UUIDs.App.ScoutStatus}/${C0}`]);
});
