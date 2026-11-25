/*
 * ACS Edge Agent
 * Edge Scout end-to-end tests: the central services over HTTP
 * Copyright 2026 University of Sheffield
 *
 * The Auth, Directory, ConfigDB and Files routes the Edge Agent's
 * ServiceClient calls, on one HTTP server, so the agent under test
 * runs its real service client against real HTTP. Every service
 * answers on the same base URL. ConfigDB keeps configs and objects in
 * memory, and Files keeps uploaded content in memory, refusing an
 * upload with no File object (404) or one that already has content
 * (409), as the real services do.
 */

import crypto from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import zlib from "zlib";

import * as UUIDs from "../../../lib/uuids";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/* One status entry as the agent wrote it, and when. */
export interface StatusWrite {
    at:     number,
    obj:    string,
    entry:  any,
}

export class FakeAcs {
    server:     http.Server
    url = ""
    /* app/object -> config */
    configs:    Map<string, any> = new Map()
    /* object -> class */
    objects:    Map<string, string> = new Map()
    files:      Map<string, Buffer> = new Map()
    /* Every request, as "METHOD /path status". */
    calls:      string[] = []
    status_writes: StatusWrite[] = []
    /* Answer the next Files upload 401 once, as a service whose token
     * has expired does. The client must send the same body again. */
    expire_next_upload = false
    uploads_retried = 0
    tokens = 0

    constructor () {
        this.server = http.createServer((req, res) => {
            this.#handle(req, res).catch(e => {
                res.writeHead(500);
                res.end(String(e));
            });
        });
        this.server.on("connection", s => {
            this.#sockets.add(s);
            s.once("close", () => this.#sockets.delete(s));
        });
    }

    #sockets: Set<import("net").Socket> = new Set()

    async start (): Promise<this> {
        await new Promise<void>(r => this.server.listen(0, "127.0.0.1", () => r()));
        const { port } = this.server.address() as AddressInfo;
        this.url = `http://127.0.0.1:${port}`;
        return this;
    }

    async stop () {
        for (const s of this.#sockets) s.destroy();
        await new Promise(r => this.server.close(r));
    }

    /* Forget everything but the agent configs, between tests. */
    reset_scans () {
        for (const k of [...this.configs.keys()])
            if (k.startsWith(`${UUIDs.App.ScoutStatus}/`) || k.startsWith(`${UUIDs.App.ScoutValues}/`))
                this.configs.delete(k);
        for (const [o, c] of [...this.objects])
            if (c == UUIDs.Class.ScoutResult) this.objects.delete(o);
        this.files.clear();
        this.status_writes = [];
        this.calls = [];
    }

    set_config (app: string, obj: string, json: any) {
        this.configs.set(`${app}/${obj}`, JSON.parse(JSON.stringify(json)));
    }

    status (conn: string) {
        return this.configs.get(`${UUIDs.App.ScoutStatus}/${conn}`);
    }

    /* The connection's live values entry. */
    values (conn: string) {
        return this.configs.get(`${UUIDs.App.ScoutValues}/${conn}`);
    }

    /* The states a connection's status passed through, without
     * repeats. */
    states (conn: string): string[] {
        const out: string[] = [];
        for (const w of this.status_writes) {
            if (w.obj != conn || !w.entry.state) continue;
            if (out[out.length - 1] != w.entry.state) out.push(w.entry.state);
        }
        return out;
    }

    /* A stored snapshot as parsed lines. */
    snapshot (uuid: string): any[] {
        const f = this.files.get(uuid);
        if (!f) throw new Error(`No snapshot ${uuid} in Files`);
        return zlib.gunzipSync(f).toString().split("\n")
            .filter(l => l != "").map(l => JSON.parse(l));
    }

    /* The Edge scout result objects ConfigDB holds. */
    scout_objects (): string[] {
        return [...this.objects].filter(([, c]) => c == UUIDs.Class.ScoutResult).map(([o]) => o);
    }

    async #body (req: http.IncomingMessage): Promise<Buffer> {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        return Buffer.concat(chunks);
    }

    async #handle (req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url!, this.url);
        const path = url.pathname;
        const method = req.method!;
        const body = await this.#body(req);
        let st = 404;

        const json = (status: number, value: any) => {
            st = status;
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(value));
        };
        const empty = (status: number) => {
            st = status;
            res.writeHead(status);
            res.end();
        };
        const auth = req.headers.authorization ?? "";
        let m: RegExpMatchArray | null;

        try {
            if (method == "POST" && path == "/token") {
                if (!auth.startsWith("Basic ")) return empty(401);
                return json(200, { token: `tok-${++this.tokens}`, expiry: Date.now() + 3600_000 });
            }
            /* Everything else needs a token. */
            if (!auth.startsWith("Bearer tok-")) return empty(401);

            /* Auth: who the agent is. */
            if (method == "GET" && path == "/authz/principal/find")
                return json(200, AGENT.uuid);
            if (method == "GET" && (m = path.match(`^/authz/principal/(${UUID})$`)))
                return m[1] == AGENT.uuid
                    ? json(200, { uuid: AGENT.uuid, kerberos: "edge-agent@E2E" })
                    : empty(404);

            /* Directory: every service is here. */
            if (method == "GET" && (m = path.match(`^/v1/service/(${UUID})$`)))
                return json(200, [{ service: m[1], url: this.url, device: null }]);

            if (method == "GET" && path == "/ping")
                return json(200, { version: "2.0.0" });

            /* ConfigDB. */
            if ((m = path.match(`^/v[12]/app/(${UUID})/object/(${UUID})$`))) {
                const key = `${m[1]}/${m[2]}`;
                if (method == "GET" || method == "HEAD") {
                    if (!this.configs.has(key)) return empty(404);
                    st = 200;
                    res.writeHead(200, { "Content-Type": "application/json",
                        "ETag": `"${crypto_uuid(key, this.configs.get(key))}"` });
                    return res.end(method == "HEAD" ? undefined : JSON.stringify(this.configs.get(key)));
                }
                if (method == "PUT") {
                    if (!this.objects.has(m[2])) return empty(404);
                    const entry = JSON.parse(body.toString());
                    const had = this.configs.has(key);
                    this.configs.set(key, entry);
                    if (m[1] == UUIDs.App.ScoutStatus)
                        this.status_writes.push({ at: Date.now(), obj: m[2], entry });
                    return empty(had ? 204 : 201);
                }
                if (method == "DELETE") {
                    if (!this.configs.delete(key)) return empty(404);
                    return empty(204);
                }
            }
            if (method == "POST" && path.match(/^\/v[12]\/object$/)) {
                const { class: klass, uuid } = JSON.parse(body.toString());
                if (this.objects.has(uuid)) return json(200, { uuid, class: this.objects.get(uuid) });
                this.objects.set(uuid, klass);
                return json(201, { uuid, class: klass });
            }
            if (method == "DELETE" && (m = path.match(`^/v[12]/object/(${UUID})$`))) {
                if (!this.objects.delete(m[1])) return empty(404);
                for (const k of [...this.configs.keys()])
                    if (k.endsWith(`/${m[1]}`)) this.configs.delete(k);
                return empty(204);
            }

            /* Files. */
            if ((m = path.match(`^/v1/file/(${UUID})$`))) {
                const uuid = m[1];
                if (method == "PUT") {
                    if (this.expire_next_upload) {
                        this.expire_next_upload = false;
                        this.#last_401_body = body;
                        return empty(401);
                    }
                    if (this.#last_401_body) {
                        if (this.#last_401_body.equals(body) && body.length > 0)
                            this.uploads_retried++;
                        this.#last_401_body = null;
                    }
                    if (this.objects.get(uuid) != UUIDs.Class.ScoutResult) return empty(404);
                    if (this.files.has(uuid)) return empty(409);
                    this.files.set(uuid, body);
                    return empty(201);
                }
                if (method == "GET") {
                    const f = this.files.get(uuid);
                    if (!f) return empty(404);
                    st = 200;
                    res.writeHead(200, { "Content-Type": "application/octet-stream" });
                    return res.end(f);
                }
                if (method == "DELETE") {
                    if (!this.objects.has(uuid)) return empty(403);
                    this.files.delete(uuid);
                    return empty(204);
                }
            }
            return empty(404);
        }
        finally {
            this.calls.push(`${method} ${path} ${st}`);
        }
    }

    #last_401_body: Buffer | null = null
}

/* The agent's identity. */
export const AGENT = {
    uuid:   "00000000-0000-4000-8000-0000000e2e01",
    group:  "E2E",
    node:   "Scout_Agent",
};

/* ConfigDB's Sparkplug address app, which the agent's service client
 * reads its own address from, and a class for the agent object. */
const SPARKPLUG_ADDRESS = "8e32801b-f35a-4cbf-a5c3-2af64d3debd7";
const EDGE_AGENT_CLASS = "00000000-0000-4000-8000-0000000e2ec1";
const CONNECTION_CLASS = "00000000-0000-4000-8000-0000000e2ec2";

/* An ETag-shaped UUID that changes with the entry. */
function crypto_uuid (key: string, value: any): string {
    const h = crypto.createHash("sha256")
        .update(key + JSON.stringify(value)).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* The ConfigDB entries an agent needs to start: its Sparkplug address
 * and its config. */
export function load_agent (acs: FakeAcs, config: any) {
    acs.objects.set(AGENT.uuid, EDGE_AGENT_CLASS);
    acs.set_config(SPARKPLUG_ADDRESS, AGENT.uuid,
        { group_id: AGENT.group, node_id: AGENT.node });
    acs.set_config(UUIDs.App.AgentConfig, AGENT.uuid, config);
    /* Every connection object exists, as the Admin UI makes them. */
    for (const c of config.deviceConnections ?? [])
        if (c.uuid) acs.objects.set(c.uuid, CONNECTION_CLASS);
}
