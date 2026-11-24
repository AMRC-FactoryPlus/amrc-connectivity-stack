/*
 * ACS Edge Agent
 * The branch-scan merge against the shared merge fixtures in
 * lib/edge-scout-schemas, both as functions and through a whole scan
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import path from "path";

import {
    index_snapshot, merge_flags, merged_items, read_lines, SnapshotWriter, subtree_test,
} from "../../../lib/scout-snapshot";
import { sha256_hash } from "../../../lib/scout-snapshot";

import { check_snapshot, conn_uuid, rig, until } from "./harness";

const DIR = path.resolve(__dirname, "../../../../lib/edge-scout-schemas/fixtures/merge");
const fixtures = fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) }));

const BASE = "bbbbbbbb-0000-4000-8000-000000000001";
const C0 = conn_uuid(0);

function base_lines (base: any) {
    return [
        { version: 1, scan: BASE, connection: C0, driver: null,
            started: "2026-11-24T10:40:00.000Z", root: base.root, folder_id: null, options: {} },
        ...base.items,
        { end: { finished: "2026-11-24T10:41:00.000Z", exhaustive: base.exhaustive,
            truncated: base.truncated, reason: base.reason, excluded: base.excluded,
            rejected: 0, items: base.items.length, branches: base.branches } },
    ];
}

async function* each<T> (xs: T[]) { for (const x of xs) yield x; }

const by_id = (items: any[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

test("there are merge fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
});

describe.each(fixtures.map(f => [f.file, f]))("merge fixture %s", (_name, fx: any) => {
    it("matches as a streamed merge", async () => {
        const { base, scan, expected } = fx;
        const lines = base_lines(base);
        const index = await index_snapshot(each(lines));

        if (scan.folder_id == null) {
            /* A full scan isn't merged. Only the flags apply. */
            expect(expected.branches).toEqual([]);
            return;
        }
        if (expected.error) {
            expect(index.parents.has(scan.folder_id)).toBe(false);
            expect(expected.error).toBe("OPTIONS");
            return;
        }

        const items: any[] = [];
        for await (const i of merged_items(index, scan.folder_id, each(lines), each(scan.items)))
            items.push(i);
        expect(by_id(items)).toEqual(by_id(expected.items));

        const flags = merge_flags(base, scan);
        expect(flags).toEqual({
            exhaustive: expected.exhaustive, truncated: expected.truncated,
            reason: expected.reason, excluded: expected.excluded, branches: expected.branches,
        });
    });

    it("matches through a whole scan in the agent", async () => {
        const { base, scan, expected } = fx;
        const r = await rig({ before: svc => {
            svc.store_snapshot(BASE, base_lines(base));
            svc.set_status(C0, { version: 1, node: "11111111-2222-4333-8444-555555555555",
                supported: true, current: {
                    file: BASE, items: base.items.length, bytes_gz: 1,
                    exhaustive: base.exhaustive, truncated: base.truncated, reason: base.reason,
                    finished: "2026-11-24T10:41:00.000Z", root: base.root,
                    options_hash: base.options_hash, config_hash: null,
                    excluded: base.excluded, branches: base.branches,
                }, previous: null });
        } });
        const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            await r.ready();
            const req = { root: scan.root, folder_id: scan.folder_id };

            if (expected.error) {
                r.request(req);
                await until(() => r.svc.status(C0).state == "failed", "failed");
                expect(r.svc.status(C0).code).toBe(expected.error);
                expect(r.broker.scout("drv0").filter(m => m.op == "start")).toEqual([]);
                expect(r.svc.status(C0).current.file).toBe(BASE);
                return;
            }

            const start = await r.start(req);
            expect(start).toMatchObject(req);
            r.conns[0].found(start.id, { type: "accept" });
            r.conns[0].found(start.id, { type: "items", items: scan.items });
            r.conns[0].found(start.id, { type: "end", exhaustive: scan.exhaustive,
                truncated: scan.truncated, reason: scan.reason, excluded: scan.excluded });
            await until(() => r.svc.status(C0).state == "done", "done");

            const st = r.svc.status(C0);
            const lines = r.svc.snapshot(st.current.file);
            expect(check_snapshot(lines)).toEqual([]);
            expect(by_id(lines.slice(1, -1))).toEqual(by_id(expected.items));

            const end = lines[lines.length - 1].end;
            for (const k of ["exhaustive", "truncated", "reason", "excluded"]) {
                expect(end[k]).toEqual(expected[k]);
                expect(st.current[k]).toEqual(expected[k]);
            }
            /* The branch just made carries this scan's finish time. */
            const strip = (bs: any[]) => bs.map(b => b.folder_id);
            expect(strip(end.branches)).toEqual(strip(expected.branches));
            expect(end.branches.slice(0, -1)).toEqual(expected.branches.slice(0, -1));
            expect(st.current.branches).toEqual(end.branches);

            expect(st.current.root).toEqual(expected.root);
            expect(lines[0].root).toEqual(expected.root);
            expect(lines[0].folder_id).toEqual(scan.folder_id);
            expect(st.current.options_hash).toBe(scan.folder_id == null
                ? sha256_hash({}) : expected.options_hash);
            expect(st.previous.file).toBe(BASE);
        }
        finally {
            await r.mgr.stop();
            quiet.mockRestore();
        }
    });
});

describe("snapshot helpers", () => {
    it("round-trips lines through gzip", async () => {
        const w = new SnapshotWriter();
        for (let i = 0; i < 1000; i++) w.force_write({ id: `n${i}` });
        const buf = await w.finish();
        const got: any[] = [];
        for await (const l of read_lines(buf)) got.push(l);
        expect(got).toHaveLength(1000);
        expect(got[999]).toEqual({ id: "n999" });
        expect(w.raw_bytes).toBeGreaterThan(buf.length);
    });

    it("gathers lines into chunks before gzip sees them", async () => {
        const w = new SnapshotWriter();
        for (let i = 0; i < 100; i++) expect(w.write({ id: `n${i}` })).toBe(true);
        await new Promise(r => setImmediate(r));
        expect(w.gz_bytes).toBe(0);
        expect(w.needs_drain).toBe(false);
        const got: any[] = [];
        for await (const l of read_lines(await w.finish())) got.push(l);
        expect(got.map(l => l.id)).toEqual(Array.from({ length: 100 }, (_, i) => `n${i}`));
    });

    it("refuses a line past the raw cap", () => {
        const w = new SnapshotWriter({ raw: 20 });
        expect(w.write({ id: "a" })).toBe(true);
        expect(w.write({ id: "this is longer" })).toBe(false);
        expect(w.lines).toBe(1);
        w.destroy();
    });

    it("rejects a snapshot with no end line or the wrong count", async () => {
        const header = { version: 1, scan: BASE };
        await expect(index_snapshot(each([header, { id: "a", parent: null }])))
            .rejects.toThrow(/no end line/);
        await expect(index_snapshot(each([header, { id: "a", parent: null }, { end: { items: 2 } }])))
            .rejects.toThrow(/counts 2/);
        await expect(index_snapshot(each([{ id: "a" }]))).rejects.toThrow(/header/);
    });

    it("finds a subtree through deep and cyclic parent chains", () => {
        const parents = new Map<string, string | null>([
            ["root", null], ["a", "root"], ["b", "a"], ["c", "b"],
            ["x", "y"], ["y", "x"],
        ]);
        const inside = subtree_test(parents, "a");
        expect(["root", "a", "b", "c", "x", "y"].map(inside))
            .toEqual([false, true, true, true, false, false]);
    });

    it("keeps at most ten branches and eight excluded scopes", () => {
        const scope = (id: string) => ({ id, reason: "skipped" });
        const f = merge_flags(
            { exhaustive: true, truncated: false, reason: null,
                excluded: Array.from({ length: 6 }, (_, i) => scope(`b${i}`)),
                branches: Array.from({ length: 10 }, (_, i) => ({ folder_id: `f${i}`, finished: "t" })) },
            { exhaustive: true, truncated: false, reason: null, folder_id: "new", finished: "t",
                excluded: Array.from({ length: 6 }, (_, i) => scope(`s${i}`)) });
        expect(f.branches).toHaveLength(10);
        expect(f.branches[9].folder_id).toBe("new");
        expect(f.branches[0].folder_id).toBe("f1");
        expect(f.excluded.map(e => e.id)).toEqual(["b0", "b1", "b2", "b3", "b4", "b5", "s0", "s1"]);
    });
});
