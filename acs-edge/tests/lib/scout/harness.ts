/*
 * ACS Edge Agent
 * Fakes for the Edge Scout tests: ConfigDB, the Files service, the
 * driver broker and a driver connection
 * Copyright 2026 University of Sheffield
 */

import { EventEmitter } from "events";
import zlib from "zlib";

import type { DriverBroker } from "../../../lib/driverBroker";
import type { DriverConnection } from "../../../lib/devices/driver";
import { ScoutManager, ScoutTiming } from "../../../lib/scout";
import type { CpuBudget } from "../../../lib/scout-budget";
import { ScoutSchemas } from "../../../lib/scout-schemas";
import * as UUIDs from "../../../lib/uuids";

export const NODE = "11111111-2222-4333-8444-555555555555";
export const OTHER_NODE = "99999999-2222-4333-8444-555555555555";

export function conn_uuid (n: number) {
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export const TIMING: ScoutTiming = {
    silence_ms:         300,
    deadline_extra_ms:  200,
    library_ms:         150,
    throttle_ms:        20,
    stop_ms:            1000,
    retry_ms:           30,
    retry_max_ms:       100,
    drain_ms:           300,
};

/* One set of validators for every test. */
export const schemas = new ScoutSchemas();

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function until (cond: () => boolean, what: string, ms = 5000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end)
            throw new Error(`Timed out waiting for ${what}`);
        await sleep(5);
    }
}

/* An HTTP-ish response, enough for the agent. */
function response (status: number, body?: Buffer) {
    return {
        status,
        headers: { get: () => null },
        body: body ? (async function* () { yield body; })() : null,
    };
}

/* ConfigDB and the Files service in memory. */
export class FakeServices {
    configs: Map<string, any> = new Map()
    objects: Set<string> = new Set()
    files: Map<string, Buffer> = new Map()
    /* Every call, in order, as text. */
    calls: string[] = []
    puts: { obj: string, entry: any }[] = []
    /* Knobs for failure tests. */
    upload_status = 201
    create_fails = false
    put_fails = false
    /* A promise each status write waits for, when set. */
    put_gate: Promise<void> | null = null
    /* What the agent passed as each upload body. */
    bodies: any[] = []

    fplus () {
        const svc = this;
        return {
            ConfigDB: {
                async get_config (app: string, obj: string) {
                    svc.calls.push(`get_config ${obj}`);
                    return svc.configs.get(`${app}/${obj}`);
                },
                async put_config (app: string, obj: string, json: any) {
                    if (svc.put_gate) await svc.put_gate;
                    svc.calls.push(`put_config ${obj}`);
                    if (svc.put_fails) throw new Error("ConfigDB: Can't set: 503");
                    /* Through JSON, as over HTTP. */
                    const copy = JSON.parse(JSON.stringify(json));
                    svc.configs.set(`${app}/${obj}`, copy);
                    if (app == UUIDs.App.ScoutStatus)
                        svc.puts.push({ obj, entry: copy });
                },
                async create_object (klass: string, obj: string, excl: boolean) {
                    svc.calls.push(`create_object ${obj}`);
                    if (svc.create_fails) throw new Error("ConfigDB: Creating failed: 403");
                    expect(klass).toBe(UUIDs.Class.ScoutResult);
                    expect(excl).toBe(true);
                    svc.objects.add(obj);
                    return obj;
                },
                async delete_object (obj: string) {
                    svc.calls.push(`delete_object ${obj}`);
                    svc.objects.delete(obj);
                },
            },
            Fetch: {
                async fetch (opts: any) {
                    expect(opts.service).toBe(UUIDs.Service.Files);
                    const uuid = opts.url.replace(/^\/v1\/file\//, "");
                    const method = opts.method ?? "GET";
                    svc.calls.push(`files ${method} ${uuid}`);
                    switch (method) {
                    case "PUT": {
                        svc.bodies.push(opts.body);
                        if (svc.upload_status != 201) return response(svc.upload_status);
                        if (!svc.objects.has(uuid)) return response(404);
                        if (svc.files.has(uuid)) return response(409);
                        /* Read the body twice, as Fetch does when it
                         * sends the request again after a 401. */
                        const first = Buffer.from(opts.body);
                        const again = Buffer.from(opts.body);
                        expect(again.equals(first)).toBe(true);
                        svc.files.set(uuid, again);
                        return response(201);
                    }
                    case "GET": {
                        const f = svc.files.get(uuid);
                        return f ? response(200, f) : response(404);
                    }
                    case "DELETE":
                        svc.files.delete(uuid);
                        return response(204);
                    }
                    return response(405);
                },
            },
        };
    }

    status (conn: string) {
        return this.configs.get(`${UUIDs.App.ScoutStatus}/${conn}`);
    }

    set_status (conn: string, entry: any) {
        this.configs.set(`${UUIDs.App.ScoutStatus}/${conn}`, entry);
    }

    /* A stored snapshot as parsed lines. */
    snapshot (uuid: string): any[] {
        const f = this.files.get(uuid);
        if (!f) throw new Error(`No snapshot ${uuid}`);
        return zlib.gunzipSync(f).toString().split("\n")
            .filter(l => l != "").map(l => JSON.parse(l));
    }

    store_snapshot (uuid: string, lines: any[]) {
        this.objects.add(uuid);
        this.files.set(uuid, zlib.gzipSync(
            Buffer.from(lines.map(l => JSON.stringify(l) + "\n").join(""))));
    }
}

/* A CPU budget a test opens and shuts. While shut, scan work never
 * runs. */
export class GateBudget {
    open = true
    rate = 1
    slice_ms = 2
    max_wait = 1e9
    wait () { return this.open ? 0 : 10; }
}

/* The driver broker as the ScoutManager sees it. */
export class FakeBroker extends EventEmitter {
    sent: { id: string, msg: string, data?: string, payload: Buffer }[] = []
    subscribed: Set<string> = new Set()

    async publish (p: any) { this.sent.push(p); }
    scouts (id: string) { return this.subscribed.has(id); }

    subscribe (id: string) {
        this.subscribed.add(id);
        this.emit("scout", id, true);
    }
    unsubscribe (id: string) {
        this.subscribed.delete(id);
        this.emit("scout", id, false);
    }

    /* The scout messages to one driver, parsed. */
    scout (id: string): any[] {
        return this.sent.filter(p => p.id == id && p.msg == "scout")
            .map(p => JSON.parse(p.payload.toString()));
    }
}

/* A driver connection as the ScoutManager sees it. */
export class FakeConn extends EventEmitter {
    status = "DOWN"
    up_since: number | null = null
    seq: Map<string, number> = new Map()

    constructor (public id: string) { super(); }

    set_status (status: string, up_for = 0) {
        const old = this.status;
        this.status = status;
        this.up_since = status == "UP" ? Date.now() - up_for : null;
        this.emit("status", status, old);
    }

    /* Send a found message, numbering it unless seq is given. */
    found (id: string, msg: any, raw?: string) {
        if (raw === undefined && !("seq" in msg) && id != "hello") {
            const seq = this.seq.get(id) ?? 0;
            this.seq.set(id, seq + 1);
            msg = { seq, ...msg };
        }
        this.emit("found", id, Buffer.from(raw ?? JSON.stringify(msg)));
    }
}

export interface Rig {
    svc:    FakeServices,
    broker: FakeBroker,
    mgr:    ScoutManager,
    conns:  FakeConn[],
    /* Make the connection's driver UP, subscribed and supported. */
    ready:  (i?: number) => Promise<void>,
    /* Send a start request and wait for the start to reach the driver. */
    start:  (req?: any, i?: number) => Promise<any>,
    request: (req: any, i?: number) => void,
}

export async function rig (opts: {
    conns?: number, env?: any, timing?: Partial<ScoutTiming>,
    before?: (svc: FakeServices) => void, budget?: CpuBudget,
} = {}): Promise<Rig> {
    const svc = new FakeServices();
    opts.before?.(svc);
    const broker = new FakeBroker();
    const mgr = new ScoutManager({
        fplus:  svc.fplus(),
        broker: broker as unknown as DriverBroker,
        node:   NODE,
        env:    opts.env ?? {},
        timing: { ...TIMING, ...opts.timing },
        schemas,
        budget: opts.budget,
    });
    const conns: FakeConn[] = [];
    for (let i = 0; i < (opts.conns ?? 1); i++) {
        const c = new FakeConn(`drv${i}`);
        conns.push(c);
        mgr.add_connection(conn_uuid(i), c as unknown as DriverConnection,
            { config_hash: "sha256:" + "c".repeat(64) });
    }
    await mgr.init();

    let reqs = 0;
    const request = (req: any, i = 0) => mgr.request({
        version: 1, op: "start",
        request: `00000000-0000-4000-9000-${String(++reqs).padStart(12, "0")}`,
        connection: conn_uuid(i), ...req,
    });

    const ready = async (i = 0) => {
        const c = conns[i];
        c.set_status("UP");
        broker.subscribe(c.id);
        await until(() => broker.scout(c.id).some(m => m.op == "hello"), "hello");
        c.found("hello", { seq: 0, type: "hello", versions: [1], supported: true,
            library: "test-driver 1.0.0" });
        await until(() => svc.status(conn_uuid(i))?.supported === true, "hello to be recorded");
    };

    const start = async (req: any = {}, i = 0) => {
        const before = broker.scout(conns[i].id).filter(m => m.op == "start").length;
        request(req, i);
        await until(() => broker.scout(conns[i].id).filter(m => m.op == "start").length > before,
            "start to reach the driver");
        return broker.scout(conns[i].id).filter(m => m.op == "start").pop();
    };

    return { svc, broker, mgr, conns, ready, start, request };
}

/* An item for a scan. */
export function item (id: string, parent: string | null = null, extra: any = {}) {
    return {
        id, parent, name: id.split("/").pop(), kind: "value",
        address: id, path: null, type: "Double", ...extra,
    };
}

/* Check a snapshot line by line against the schemas, as
 * check_snapshot in lib/edge-scout-schemas does. */
export function check_snapshot (lines: any[]): string[] {
    const problems: string[] = [];
    if (lines.length < 2) return ["too short"];
    const bad = (name: string, v: any) => schemas.check(name, v);
    const h = bad("snapshot-header", lines[0]);
    if (h) problems.push(`header: ${h}`);
    const last = lines[lines.length - 1];
    const e = bad("snapshot-end", last);
    if (e) problems.push(`end: ${e}`);
    const ids = new Set();
    for (const l of lines.slice(1, -1)) {
        const i = bad("item", l);
        if (i) problems.push(`item ${l.id}: ${i}`);
        if (ids.has(l.id)) problems.push(`repeat ${l.id}`);
        ids.add(l.id);
    }
    if (last?.end?.items != lines.length - 2)
        problems.push("count");
    return problems;
}
