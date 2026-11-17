/*
 * ACS Edge Agent
 * Split-driver cluster rig: a mock REST endpoint
 * Copyright 2026 University of Sheffield
 */

import http from "http";

import type { Fixture, HttpEvent } from "../../fixtures/drivers/fixture.js";
import type { RigConnection } from "../rig.js";
import { Mock, MockStatus, record_write } from "./mock.js";

/* An HTTP server answering every address the connection reads with a
 * body of the same shape (JSON or XML) and content type.
 *
 * Each path serves the fixture event current at the time of the
 * request, taken in a loop over the fixture's length, so the values
 * change at the connection's poll interval however often it polls.
 * The golden harness's HTTP stub serves by poll count instead, which
 * a comparison needs and a long run doesn't.
 *
 * Requests must carry the source's base URL path in front of the
 * address. A connection with Basic auth must send the rig's
 * credentials or gets 401. Any other method is a write: the mock
 * records it and answers 200. */
export class HttpMock implements Mock {
    conn:       RigConnection
    fixture:    Fixture
    paths:      Map<string, HttpEvent[]> = new Map()
    duration:   number
    server?:    http.Server
    started = 0
    delivered = 0
    refused = 0
    clients:    Set<any> = new Set()
    writes:     NonNullable<MockStatus["writes"]> = []

    constructor (conn: RigConnection, fixture: Fixture) {
        this.conn = conn;
        this.fixture = fixture;
        for (const ev of fixture.events) {
            if (ev.type != "http") continue;
            const list = this.paths.get(ev.path) ?? [];
            list.push(ev);
            this.paths.set(ev.path, list);
        }
        for (const list of this.paths.values())
            list.sort((a, b) => a.t - b.t);
        this.duration = Math.max(1, fixture.meta.duration_ms);
    }

    async start () {
        if (this.server) return;
        const srv = http.createServer((req, res) => this.request(req, res));
        srv.on("connection", sock => {
            this.clients.add(sock);
            sock.once("close", () => this.clients.delete(sock));
        });
        await new Promise<void>((resolve, reject) => {
            srv.once("error", reject);
            srv.listen(this.conn.port, () => resolve());
        });
        this.server = srv;
        this.started = Date.now();
    }

    /* The fixture path a request URL is for, or undefined. */
    path (url: string) {
        const base = this.conn.base_path ?? "";
        if (!url.startsWith(base)) return;
        const rest = url.slice(base.length);
        if (this.paths.has(rest)) return rest;
        let decoded;
        try { decoded = decodeURI(rest); } catch { return; }
        return this.paths.has(decoded) ? decoded : undefined;
    }

    authorised (req: http.IncomingMessage) {
        if (!this.conn.username) return true;
        const want = "Basic " + Buffer.from(
            `${this.conn.username}:${this.conn.password}`).toString("base64");
        return req.headers.authorization == want;
    }

    request (req: http.IncomingMessage, res: http.ServerResponse) {
        if (!this.authorised(req)) {
            this.refused++;
            res.writeHead(401, { "WWW-Authenticate": "Basic" }).end();
            return;
        }
        const url = req.url ?? "";
        if (req.method != "GET") {
            let body = "";
            req.on("data", c => body += c);
            req.on("end", () => {
                record_write(this.writes, url, body);
                res.writeHead(200, { "Content-Type": "application/json" })
                    .end("{}");
            });
            return;
        }

        const path = this.path(url);
        if (path == undefined) {
            res.writeHead(404).end();
            return;
        }
        const now = (Date.now() - this.started) % this.duration;
        const events = this.paths.get(path)!;
        let ev = events[0];
        for (const e of events) {
            if (e.t > now) break;
            ev = e;
        }
        this.delivered++;
        res.writeHead(ev.status, { "Content-Type": ev.content_type });
        res.end(ev.body);
    }

    async stop () {
        const srv = this.server;
        if (!srv) return;
        this.server = undefined;
        for (const s of this.clients) s.destroy();
        await new Promise<void>(r => srv.close(() => r()));
    }

    status (): MockStatus {
        return {
            id: this.conn.id, protocol: this.conn.protocol,
            name: this.conn.name, port: this.conn.port,
            running: !!this.server, delivered: this.delivered,
            clients: this.clients.size, refused: this.refused,
            writes: this.writes,
        };
    }
}
