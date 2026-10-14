/*
 * ACS FTP driver
 * Test doubles: an in-memory file server and the driver library.
 * Copyright 2026 University of Sheffield AMRC
 */

import { split } from "../lib/address.js";
import { AuthError, NotFound, TooLarge } from "../lib/transport.js";

/* A file server holding { path: { data, modified } }. Directories are
 * implied by the paths. Tests poke at `files`, `fail` and the counts. */
export function fake_server (files = {}) {
    const server = {
        files: new Map(Object.entries(files).map(([p, f]) => [p, {
            data:       Buffer.from(f.data ?? ""),
            modified:   f.modified ?? "2026-10-14T09:00:00.000Z",
        }])),
        /* "auth" or "conn" makes the next connect fail. */
        fail: null,
        connects: 0,
        reads: 0,
        log: [],
    };
    server.Transport = class FakeTransport {
        constructor () { this.closed = true; }

        async connect () {
            server.connects++;
            if (server.fail == "auth") throw new AuthError("530 Login incorrect");
            if (server.fail == "conn") throw new Error("ECONNREFUSED");
            this.closed = false;
        }

        file (path) {
            const f = server.files.get(path);
            if (!f) throw new NotFound(path);
            return f;
        }

        async read (path, max) {
            server.reads++;
            const f = this.file(path);
            if (f.data.length > max) throw new TooLarge(path, f.data.length, max);
            return f.data;
        }

        async stat (path) {
            if (server.files.has(path)) {
                const f = server.files.get(path);
                return { type: "file", size: f.data.length, modified: f.modified };
            }
            if ([...server.files.keys()].some(p => split(p).dir == path))
                return { type: "dir", size: 0, modified: null };
            throw new NotFound(path);
        }

        async list (dir) {
            const entries = [...server.files.entries()]
                .filter(([p]) => split(p).dir == dir)
                .map(([p, f]) => ({
                    name:       split(p).base,
                    type:       "file",
                    size:       f.data.length,
                    modified:   f.modified,
                }));
            if (!entries.length) throw new NotFound(dir);
            return entries;
        }

        async modified (path) { return this.file(path).modified; }

        async write (path, buf) {
            server.log.push(["write", path]);
            server.files.set(path, { data: buf, modified: new Date().toISOString() });
        }

        async replace (from, to) {
            server.log.push(["replace", from, to]);
            server.files.set(to, this.file(from));
            server.files.delete(from);
        }

        async rename (from, to) {
            if (server.files.has(to)) throw new Error("550 target exists");
            server.files.set(to, this.file(from));
            server.files.delete(from);
        }

        async remove (path) {
            this.file(path);
            server.files.delete(path);
        }

        async close () { this.closed = true; }
    };
    return server;
}

/* The parts of the edge-driver Driver the handler uses, plus the edge
 * agent on the far side of the local broker. `agent(uuid)` answers
 * req/file with a reply body, or null for no reply. */
export function fake_driver (agent = async () => null) {
    const handlers = new Map();
    const driver = {
        status: [],
        published: [],
        debug: { bound: () => () => {} },
        topic: (msg, data) => `fpEdge1/test/${msg}` + (data ? `/${data}` : ""),
        message: (k, h) => handlers.set(k, h),
        connFailed () { this.status.push("CONN"); },
        connUnauth () { this.status.push("AUTH"); },
        mqtt: {
            subscribeAsync: async () => {},
            publishAsync: async (topic, payload) => {
                driver.published.push([topic, payload]);
                if (topic != "fpEdge1/test/req/file") return;
                const body = await agent(payload);
                if (body != null)
                    handlers.get("rsp")(Buffer.from(JSON.stringify(body)), "file");
            },
        },
    };
    return driver;
}
