#!/usr/bin/env node
/*
 * ACS ConfigDB
 * Benchmark / test server
 * Copyright 2026 University of Sheffield AMRC
 *
 * This runs the real ConfigDB (Model, routes, WebAPI and CDBNotify,
 * wired as in bin/api.js) without Kerberos or an Auth service:
 *
 * - Clients authenticate with fixed Bearer tokens (see PRINCIPALS).
 * - ACLs come from a fixed table instead of the Auth service. They
 *   still go through the real rx-client Auth code path (cached watch,
 *   firstValueFrom, ACL closure).
 * - MQTT is disabled.
 *
 * A second HTTP port (BENCH_PORT) serves control endpoints for the
 * load driver: CPU/event-loop counters and a CPU profiler.
 *
 * Postgres connection comes from the usual PG* environment variables.
 */

import fs                               from "node:fs";
import http                             from "node:http";
import inspector                        from "node:inspector";
import { monitorEventLoopDelay }        from "node:perf_hooks";

import * as rx                          from "rxjs";

import * as rxx                         from "@amrc-factoryplus/rx-util";

import { RxClient }                     from "@amrc-factoryplus/rx-client";
import { WebAPI }                       from "@amrc-factoryplus/service-api";

import { Auth }                         from "../lib/auth.js";
import { BootstrapUUIDs, Perm, Service, Version }
                                        from "../lib/constants.js";
import Model                            from "../lib/model.js";
import { CDBNotify }                    from "../lib/notify.js";
import { routes }                       from "../lib/routes.js";

const { env } = process;

const Wildcard = "00000000-0000-0000-0000-000000000000";
const REALM = "BENCH.TEST";

/* A reader with an ACL of realistic length. Service accounts on the
 * dev cluster have tens of entries after group expansion. */
function reader_acl (n) {
    const acl = [
        { permission: Perm.ReadApp,         target: Wildcard },
        { permission: Perm.ReadMembers,     target: Wildcard },
        { permission: Perm.ReadSubclasses,  target: Wildcard },
    ];
    for (let i = 0; acl.length < n; i++) {
        const hex = i.toString(16).padStart(12, "0");
        acl.unshift({
            permission: Perm.WriteApp,
            target:     `00000000-0000-4000-8000-${hex}`,
        });
    }
    return acl;
}

/* token -> [principal, acl]. An acl of null means root.
 * BENCH_ACL_SIZE sets the length of the reader ACLs. */
const acl_size = Number(env.BENCH_ACL_SIZE ?? 60);
const PRINCIPALS = {
    admin:  [`admin@${REALM}`, null],
    i3x:    [`sv1i3x@${REALM}`, reader_acl(acl_size)],
    auth:   [`sv1auth@${REALM}`, reader_acl(acl_size)],
    /* A principal with no read access at all. */
    nobody: [`nobody@${REALM}`, []],
};

const fplus = await new RxClient({
    env: {
        ...env,
        ROOT_PRINCIPAL:     `admin@${REALM}`,
        DIRECTORY_URL:      "http://directory.invalid",
    },
    bootstrap_uuids:    BootstrapUUIDs,
}).init();

/* Replace the Auth service notify source with our ACL table. This
 * pushes new ACLs when /acl changes them, as the Auth service does.
 * Everything downstream of watch_full (cacheSeq, fetch_raw_acl,
 * fetch_acl, check_acl) is the real code. */
const acls = new Map(Object.values(PRINCIPALS)
    .filter(([, acl]) => acl)
    .map(([p, acl]) => [p, new rx.BehaviorSubject(acl)]));
fplus.Auth.notify.watch_full = url => {
    const principal = decodeURIComponent(url).replace("v2/acl/kerberos/", "");
    const acl = acls.get(principal);
    return acl
        ? rxx.rx(acl, rx.map(body => ({ status: 200, body })))
        : rx.concat(rx.of({ status: 404 }), rx.NEVER);
};

const auth = new Auth({ fplus });
const model = await new Model({
    auth,
    debug:  fplus.debug,
}).init();

const api = await new WebAPI({
    ping:       {
        version:    Version,
        service:    Service.Registry,
        software: {
            vendor:         "AMRC",
            application:    "acs-configdb",
            revision:       "bench",
        },
    },
    debug:      fplus.debug,
    realm:      REALM,
    http_port:  env.PORT ?? 8080,
    body_limit: "64mb",

    routes:     routes({ auth, model, fplus, mqtt: undefined }),
}).init();

for (const [token, [principal]] of Object.entries(PRINCIPALS))
    api.auth.tokens.set(token, { principal, expiry: Infinity });

/* Count database transactions and class lookups. */
const counts = { txn: 0, class_lookup: 0 };
const db_txn = model.db.txn.bind(model.db);
model.db.txn = (...a) => { counts.txn++; return db_txn(...a); };
const class_lookup = model.class_lookup.bind(model);
model.class_lookup = (...a) => { counts.class_lookup++; return class_lookup(...a); };

const notify = new CDBNotify({
    auth, api, model,
    debug:  fplus.debug,
    lookup_interval:    env.CLASS_LOOKUP_INTERVAL,
});

notify.run();
api.run();

/* Control endpoints */

const eld = monitorEventLoopDelay({ resolution: 5 });
eld.enable();
let cpu_base = process.cpuUsage();
let wall_base = performance.now();

const session = new inspector.Session();
session.connect();
const post = (method, params) => new Promise((resolve, reject) =>
    session.post(method, params, (err, res) => err ? reject(err) : resolve(res)));

const ms = ns => Math.round(ns / 1e4) / 100;

function stats () {
    const cpu = process.cpuUsage(cpu_base);
    return {
        wall_ms:        Math.round(performance.now() - wall_base),
        cpu_user_ms:    Math.round(cpu.user / 1000),
        cpu_system_ms:  Math.round(cpu.system / 1000),
        cpu_ms:         Math.round((cpu.user + cpu.system) / 1000),
        eld_p50_ms:     ms(eld.percentile(50)),
        eld_p99_ms:     ms(eld.percentile(99)),
        eld_max_ms:     ms(eld.max),
        eld_mean_ms:    ms(eld.mean),
        rss_mb:         Math.round(process.memoryUsage.rss() / 1048576),
        ...counts,
    };
}

const control = {
    "/reset": async () => {
        cpu_base = process.cpuUsage();
        wall_base = performance.now();
        eld.reset();
        counts.txn = counts.class_lookup = 0;
        return {};
    },
    "/stats": async () => stats(),
    "/prof/start": async () => {
        await post("Profiler.enable");
        await post("Profiler.setSamplingInterval", { interval: 500 });
        await post("Profiler.start");
        return {};
    },
    "/prof/stop": async (q) => {
        const { profile } = await post("Profiler.stop");
        fs.writeFileSync(q.get("file"), JSON.stringify(profile));
        return {};
    },
    /* Replace a principal's ACL: /acl?token=nobody&acl=<JSON array> */
    "/acl": async (q) => {
        const [principal] = PRINCIPALS[q.get("token")];
        acls.get(principal).next(JSON.parse(q.get("acl")));
        return {};
    },
    "/exit": async () => {
        setImmediate(() => process.exit(0));
        return {};
    },
};

http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const handler = control[url.pathname];
    if (!handler) return res.writeHead(404).end();
    try {
        const body = await handler(url.searchParams);
        res.writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(body));
    }
    catch (e) {
        res.writeHead(500).end(String(e));
    }
}).listen(env.BENCH_PORT ?? 8081);
