/*
 * ACS ConfigDB
 * Bench harness: run the real ConfigDB HTTP API and notify/v2 server
 * against a local Postgres, with Kerberos and the Auth service stubbed.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Everything on the request and notify paths is the production code:
 * Model, routes, WebAPI (express + bearer auth), CDBNotify and the
 * service-api Notify/Session/SearchFilter classes. Only these parts are
 * replaced:
 *   - Kerberos: a fixed bearer token is placed in the token table.
 *   - Auth service: ACLs allow everything, except ReadApp on apps named
 *     by POST /bench/acl (used to drive 403 transitions).
 *   - MQTT change notifications are not started.
 *
 * Instrumentation, exposed on /bench/*:
 *   - CPU time (process.cpuUsage) since the last reset.
 *   - Number of SEARCH full() snapshot fetches (CDBNotify.search_full).
 *   - notify/v2 messages and bytes written to WebSockets.
 *   - Event-loop delay (perf_hooks.monitorEventLoopDelay).
 *   - Peak RSS and heap, sampled every 50 ms.
 *   - Bytes waiting in the notify WebSockets' send buffers.
 *
 * Environment: PGHOST, PGPORT, PGUSER, PGDATABASE as for libpq;
 * PORT (default 8710); BENCH_TOKEN (default "benchtoken").
 */

import { monitorEventLoopDelay } from "perf_hooks";

import { Debug }        from "@amrc-factoryplus/service-client";
import { WebAPI }       from "@amrc-factoryplus/service-api";

import { Auth }         from "../../lib/auth.js";
import { Perm, SpecialObj } from "../../lib/constants.js";
import Model            from "../../lib/model.js";
import { CDBNotify }    from "../../lib/notify.js";
import { routes }       from "../../lib/routes.js";

const { env } = process;
const PORT = env.PORT ?? 8710;
const TOKEN = env.BENCH_TOKEN ?? "benchtoken";
const PRINCIPAL = "bench@BENCH";

const debug = new Debug({ verbose: env.VERBOSE ?? "" });

/* ACL stub. Apps in this set deny ReadApp; everything else is allowed. */
const denied = new Set();
const fplus = {
    debug,
    Auth: {
        root_principal: undefined,
        fetch_acl: async () => (perm, target) =>
            !(perm == Perm.ReadApp && denied.has(target)),
        resolve_principal: async () => SpecialObj.Unowned,
    },
};

/* Instrumentation */
const stats = {};
let cpu0, t0;
const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();

function reset () {
    Object.assign(stats, {
        full_calls:     0,
        msgs:           0,
        bytes:          0,
        full_msgs:      0,
        full_msg_bytes: 0,
        peak_rss:       0,
        peak_heap:      0,
        peak_buffered:  0,
    });
    cpu0 = process.cpuUsage();
    t0 = process.hrtime.bigint();
    eld.reset();
    global.gc?.();
}
reset();

/* Open notify WebSockets, to read their send buffers. */
const sockets = new Set();
const buffered = () => [...sockets].reduce((a, ws) => a + ws.bufferedAmount, 0);

setInterval(() => {
    const m = process.memoryUsage();
    stats.peak_rss = Math.max(stats.peak_rss, m.rss);
    stats.peak_heap = Math.max(stats.peak_heap, m.heapUsed);
    stats.peak_buffered = Math.max(stats.peak_buffered, buffered());
}, 50).unref();

function snapshot () {
    const cpu = process.cpuUsage(cpu0);
    return {
        ...stats,
        cpu_ms:     (cpu.user + cpu.system) / 1000,
        wall_ms:    Number(process.hrtime.bigint() - t0) / 1e6,
        eld_max_ms: eld.max / 1e6,
        eld_p99_ms: eld.percentile(99) / 1e6,
        eld_mean_ms: eld.mean / 1e6,
        rss:        process.memoryUsage().rss,
        heap:       process.memoryUsage().heapUsed,
        external:   process.memoryUsage().external,
        buffered:   buffered(),
    };
}

/* Count SEARCH snapshot fetches. */
const real_full = CDBNotify.prototype.search_full;
CDBNotify.prototype.search_full = async function (...args) {
    stats.full_calls++;
    return real_full.apply(this, args);
};

const auth = new Auth({ fplus });
const model = await new Model({ auth, debug }).init();

const bench_routes = app => {
    app.get("/bench/stats", (req, res) => res.json(snapshot()));
    app.post("/bench/reset", (req, res) => { reset(); res.status(204).end(); });
    /* Collect garbage, so heap samples show what is still held. */
    app.post("/bench/gc", (req, res) => { global.gc?.(); res.status(204).end(); });
    app.post("/bench/acl", (req, res) => {
        const { app: target, allow } = req.body;
        if (allow) denied.delete(target);
        else denied.add(target);
        res.status(204).end();
    });
    routes({ auth, model, fplus })(app);
};

const api = await new WebAPI({
    ping:       { version: "bench" },
    debug,
    http_port:  PORT,
    body_limit: "20mb",
    routes:     bench_routes,
}).init();
api.auth.tokens.set(TOKEN, { principal: PRINCIPAL, expiry: Infinity });

const notify = new CDBNotify({ auth, api, model, debug });
notify.run();

/* Count what goes out on the notify WebSockets. Our listener runs after
 * the Notify one, synchronously in the same emit, so it wraps send()
 * before the session can send anything. */
notify.notify.wss.on("connection", ws => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    const send = ws.send.bind(ws);
    ws.send = (data, ...rest) => {
        stats.msgs++;
        const len = Buffer.byteLength(data);
        stats.bytes += len;
        if (typeof data == "string" && data.includes('"children"')) {
            stats.full_msgs++;
            stats.full_msg_bytes += len;
        }
        return send(data, ...rest);
    };
});

api.run();
console.log(`BENCH READY ${PORT}`);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
