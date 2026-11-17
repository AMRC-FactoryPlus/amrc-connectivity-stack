/*
 * ACS Edge Agent
 * Golden-output harness: an HTTP stub serving recorded REST responses
 * Copyright 2026 University of Sheffield
 */

import http from "http";
import net from "net";

import type { Fixture, HttpEvent } from "../../fixtures/drivers/fixture.js";
import { DeviceOpts, FakeDevice, sleep } from "./device.js";

/* The request path the agent's URLs start with. The connection's
 * baseURL becomes the stub's origin plus this, and the agent appends
 * each address to it as it is (REST.ts does `baseURL + address`), so
 * an address of "/a" gives "/g/a" and "a" gives "/ga". */
const PREFIX = "/g";

/* A fixture REST event is the response a path gives from its time t
 * until the next event for that path. Serving by wall-clock time would
 * make the response a poll gets depend on how late the poll was, so
 * the stub serves by poll count instead: the n-th GET of a path gets
 * the response that was current at fixture time n * interval_ms. Both
 * runs then see the same sequence of responses for each path, however
 * their timing differs, and a driver that makes one GET per poll sees
 * exactly what the built-in connection saw. */
export class HttpDevice implements FakeDevice {
    fixture:    Fixture
    opts:       DeviceOpts
    server?:    http.Server
    base = ""
    /* path -> events for that path in time order */
    paths:      Map<string, HttpEvent[]> = new Map()
    counts:     Map<string, number> = new Map()
    polls:      number
    delivered = 0
    t0?:        number
    #done!:     () => void
    #finished:  Promise<void>

    constructor (fixture: Fixture, opts: DeviceOpts) {
        this.fixture = fixture;
        this.opts = opts;

        for (const ev of fixture.events) {
            if (ev.type != "http") continue;
            const list = this.paths.get(ev.path) ?? [];
            list.push(ev);
            this.paths.set(ev.path, list);
        }
        for (const list of this.paths.values())
            list.sort((a, b) => a.t - b.t);

        const { duration_ms, interval_ms } = fixture.meta;
        this.polls = Math.floor(duration_ms / interval_ms) + 1;
        this.#finished = new Promise(r => this.#done = r);
    }

    async start () {
        const srv = this.server = http.createServer((req, res) =>
            this.request(req, res));
        await new Promise<void>(r => srv.listen(0, "127.0.0.1", () => r()));
        const { port } = srv.address() as net.AddressInfo;
        this.base = `http://127.0.0.1:${port}${PREFIX}`;
    }

    connection (conn: any) {
        return {
            ...conn,
            RESTConnDetails: {
                ...conn.RESTConnDetails,
                baseURL: this.base,
            },
        };
    }

    /* The fixture path a request is for. */
    path (url: string) {
        if (!url.startsWith(PREFIX)) return;
        const rest = url.slice(PREFIX.length);
        if (this.paths.has(rest)) return rest;
        let decoded;
        try { decoded = decodeURI(rest); } catch { return; }
        return this.paths.has(decoded) ? decoded : undefined;
    }

    request (req: http.IncomingMessage, res: http.ServerResponse) {
        const path = this.path(req.url ?? "");
        if (req.method != "GET" || path == undefined) {
            res.writeHead(404).end();
            return;
        }

        const n = this.counts.get(path) ?? 0;
        this.counts.set(path, n + 1);
        const now = n * this.fixture.meta.interval_ms;
        const events = this.paths.get(path)!;
        let ev = events[0];
        for (const e of events) {
            if (e.t > now) break;
            ev = e;
        }

        this.t0 ??= Date.now();
        this.delivered++;
        res.writeHead(ev.status, { "Content-Type": ev.content_type });
        res.end(ev.body);

        if ([...this.paths.keys()].every(p =>
                (this.counts.get(p) ?? 0) >= this.polls))
            this.#done();
    }

    async finished () {
        await this.#finished;
        /* Let the last responses reach the agent and be published. */
        await sleep(Math.max(250, this.fixture.meta.interval_ms / this.opts.speed / 2));
    }

    async stop () {
        const srv = this.server;
        if (!srv) return;
        this.server = undefined;
        (srv as any).closeAllConnections?.();
        await new Promise<void>(r => srv.close(() => r()));
    }
}
