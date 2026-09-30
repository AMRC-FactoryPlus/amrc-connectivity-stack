/*
 * ACS ConfigDB
 * Bench driver: device-onboarding write load against bench/notify-search/server.js
 * with admin-UI-like SEARCH sessions and i3X-like WATCH sessions open.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Usage: node bench/notify-search/drive.js [--devices N] [--conc C] [--rate R]
 *          [--reopen-every K] [--watch-existing W] [--no-follow]
 *          [--settle-timeout S] [--out FILE]
 *
 *   --devices N        devices to onboard (default 300)
 *   --conc C           concurrent writers in burst mode (default 4)
 *   --rate R           steady mode: start R devices per second (0 = burst)
 *   --reopen-every K   close the admin session and open a new one after
 *                      every K devices, like a page reload (0 = never)
 *   --watch-existing W i3X-like WATCHes on Info + DeviceInformation for
 *                      W existing devices (default 2400)
 *   --no-follow        do not WATCH each newly created device
 *
 * One device = POST /v2/object (class Device), PUT Info, PUT
 * DeviceInformation. DeviceInformation bodies are real ones copied from
 * the loaded dump, with node/createdAt changed.
 */

import { parseArgs } from "util";
import { randomUUID } from "crypto";

import WebSocket from "ws";

const { values: opt } = parseArgs({ options: {
    base:               { type: "string", default: "http://localhost:8710" },
    token:              { type: "string", default: "benchtoken" },
    devices:            { type: "string", default: "300" },
    conc:               { type: "string", default: "4" },
    rate:               { type: "string", default: "0" },
    "reopen-every":     { type: "string", default: "0" },
    "watch-existing":   { type: "string", default: "2400" },
    "no-follow":        { type: "boolean", default: false },
    "settle-timeout":   { type: "string", default: "900" },
    out:                { type: "string" },
}});

const N = Number(opt.devices);
const CONC = Number(opt.conc);
const RATE = Number(opt.rate);
const REOPEN = Number(opt["reopen-every"]);
const WATCH_EXISTING = Number(opt["watch-existing"]);
const FOLLOW = !opt["no-follow"];

const App = {
    Info:                       "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    Registration:               "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    DeviceInformation:          "a98ffed5-c613-4e70-bfd3-efeee250ade5",
    SparkplugAddress:           "8e32801b-f35a-4cbf-a5c3-2af64d3debd7",
    EdgeClusterConfiguration:   "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
    EdgeAgentDeployment:        "f2b9417a-ef7f-421f-b387-bb8183a48cdb",
    HelmChartTemplate:          "729fe070-5e67-4bc7-94b5-afd75cb42b03",
    DriverDefinition:           "454e5bec-de4a-11ef-bfea-4bc400f636a5",
    EdgeClusterSetupStatus:     "f6c67e6f-e48e-4f69-b4bb-bfbddcc2a517",
    EdgeClusterStatus:          "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
    ConnectionConfiguration:    "fa8b429c-de3e-11ef-87fd-6382f0eac944",
    Schema:                     "b16e85fb-53c2-49f9-8d83-cdf6763304ba",
    SchemaInformation:          "32093857-9d29-470e-a897-d2b56d5aa978",
};
const DeviceClass = "18773d6d-a70d-443a-b29a-3f1583195290";

/* One admin UI session, from the SEARCH and class WATCH counts in the
 * dev cluster ConfigDB log (288 SEARCH and ~190 class WATCH subs over
 * 10 admin sessions). */
const AdminSearches = [
    ...Array(8).fill(App.Info),
    ...Array(7).fill(App.Registration),
    App.SparkplugAddress, App.SparkplugAddress,
    App.EdgeClusterConfiguration, App.EdgeClusterConfiguration,
    App.EdgeAgentDeployment, App.EdgeAgentDeployment,
    App.HelmChartTemplate, App.HelmChartTemplate,
    App.DriverDefinition, App.EdgeClusterSetupStatus,
    App.EdgeClusterStatus, App.DeviceInformation,
    App.ConnectionConfiguration, App.Schema, App.SchemaInformation,
];
const AdminClassWatches = [
    "f24d354d-abc1-4e32-98e1-0667b3e40b61",
    "f9be0334-0ff7-43d3-9d8a-188d3e4d472b",
    "00da3c0b-f62b-4761-a689-39ad0c33f864",
    DeviceClass,
    "e6f6a6e6-f6b2-422a-bc86-2dcb417a362a",
    "3874e06c-de4a-11ef-a68c-0f1c2d4d555c",
    "f1fabdd1-de90-4399-b3da-ccf6c2b2c08b",
    "8ae784bb-c4b5-4995-9bf6-799b3c7f21ad",
];

const now = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Connection resets seen by the writers. After a long event-loop stall
 * the server's keep-alive timer can close a socket the client has just
 * reused; a real client sees the same error. We retry and count them. */
let conn_resets = 0;

async function http (method, path, body) {
    for (let tries = 0; ; tries++) {
        try {
            return await http1(method, path, body);
        }
        catch (e) {
            if (!e.cause || tries >= 3) throw e;
            conn_resets++;
        }
    }
}

async function http1 (method, path, body) {
    const res = await fetch(`${opt.base}${path}`, {
        method,
        headers: {
            "Authorization":    `Bearer ${opt.token}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status >= 300)
        throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : undefined;
}

/* A notify/v2 client session. Keeps per-subscription state the same
 * way rx-client does: a message with `children` replaces the map, a
 * message with `child` sets or deletes one entry. */
class Session {
    constructor (name) {
        this.name = name;
        this.subs = new Map();
        this.msgs = 0;
        this.bytes = 0;
        this.fulls = 0;
    }

    async open () {
        const url = opt.base.replace(/^http/, "ws") + "/notify/v2";
        this.ws = new WebSocket(url, { maxPayload: 1 << 30 });
        await new Promise((res, rej) => {
            this.ws.once("open", res);
            this.ws.once("error", rej);
        });
        this.ws.send(`Bearer ${opt.token}`);
        const st = await new Promise(res =>
            this.ws.once("message", m => res(m.toString())));
        if (st != "200") throw new Error(`WS auth: ${st}`);
        this.ws.on("message", m => this.message(m));
        return this;
    }

    message (m) {
        this.msgs++;
        this.bytes += m.length;
        const u = JSON.parse(m);
        const sub = this.subs.get(u.uuid);
        if (!sub) return;
        sub.count++;
        sub.last = now();
        if (u.children) {
            this.fulls++;
            sub.fulls++;
            sub.map = new Map(Object.entries(u.children));
        }
        else if (u.child) {
            if (u.response?.status < 300) sub.map.set(u.child, u.response);
            else sub.map.delete(u.child);
        }
        else if (u.response) sub.value = u.response;
        if (!sub.ready) { sub.ready = true; sub.readyAt = now(); sub.resolve(); }
        for (const w of sub.waiters) w(u);
    }

    subscribe (req) {
        const uuid = randomUUID();
        let resolve;
        const ready = new Promise(r => resolve = r);
        const sub = { req, uuid, count: 0, fulls: 0, map: new Map(),
            ready: false, resolve, waiters: new Set(), openedAt: now() };
        this.subs.set(uuid, sub);
        this.ws.send(JSON.stringify({ ...req, uuid }));
        return { sub, ready };
    }

    search (app) {
        return this.subscribe({ method: "SEARCH", parent: `v2/app/${app}/object/` });
    }

    watch (url) {
        return this.subscribe({ method: "WATCH", request: { url } });
    }

    close () { this.ws.close(); }
}

async function open_admin (name) {
    const s = await new Session(name).open();
    const readies = [
        ...AdminSearches.map(a => s.search(a).ready),
        ...AdminClassWatches.map(c => s.watch(`v2/class/${c}/member/`).ready),
    ];
    s.all_ready = Promise.all(readies).then(() => now());
    s.opened = now();
    return s;
}

/* Wait until every open admin session's DeviceInformation SEARCH map
 * holds the last device's final body. */
function delivered (sessions, obj, body) {
    const check = s => {
        for (const sub of s.subs.values()) {
            if (sub.req.parent != `v2/app/${App.DeviceInformation}/object/`)
                continue;
            const r = sub.map.get(obj);
            return r && JSON.stringify(r.body) == JSON.stringify(body);
        }
        return false;
    };
    return Promise.all(sessions.map(s => new Promise(res => {
        const iv = setInterval(() => {
            if (check(s)) { clearInterval(iv); res(now()); }
        }, 5);
    })));
}

async function main () {
    /* Templates: real DeviceInformation bodies from the dump. */
    const di_list = await http("GET", `/v2/app/${App.DeviceInformation}/object/`);
    const tmpl_objs = di_list.slice(-Math.min(N, 200));
    const templates = await Promise.all(tmpl_objs.map(o =>
        http("GET", `/v2/app/${App.DeviceInformation}/object/${o}`)));

    /* i3X-like WATCHes. */
    const i3x = await new Session("i3x").open();
    const watch_objs = di_list.slice(0, WATCH_EXISTING);
    const i3x_ready = [];
    for (const o of watch_objs) {
        i3x_ready.push(i3x.watch(`v2/app/${App.Info}/object/${o}`).ready);
        i3x_ready.push(i3x.watch(`v2/app/${App.DeviceInformation}/object/${o}`).ready);
    }
    await Promise.all(i3x_ready);

    let admin = await open_admin("admin-0");
    await admin.all_ready;
    const admins = [admin];

    await http("POST", "/bench/reset");
    const t_start = now();

    let next = 0, done = 0, requests = 0;
    const lat = [];
    const reopen_times = [];
    let last = null;

    const onboard = async i => {
        const tmpl = templates[i % templates.length];
        const t0 = now();
        const obj = await http("POST", "/v2/object", { class: DeviceClass });
        const uuid = obj.uuid;
        requests++;
        await http("PUT", `/v2/app/${App.Info}/object/${uuid}`,
            { name: `Bench device ${i}` });
        requests++;
        const body = { ...tmpl, node: randomUUID(), createdAt: new Date().toISOString() };
        await http("PUT", `/v2/app/${App.DeviceInformation}/object/${uuid}`, body);
        requests++;
        lat.push(now() - t0);
        last = { uuid, body };
        if (FOLLOW) {
            i3x.watch(`v2/app/${App.Info}/object/${uuid}`);
            i3x.watch(`v2/app/${App.DeviceInformation}/object/${uuid}`);
        }
        done++;
        if (REOPEN && done % REOPEN == 0 && done < N) {
            /* Page reload: the old tab's socket closes, a new one opens. */
            admin.close();
            reopen_times.push(now() - t_start);
            admin = await open_admin(`admin-${admins.length}`);
            admins.push(admin);
        }
    };

    if (RATE > 0) {
        const inflight = [];
        for (let i = 0; i < N; i++) {
            const due = t_start + i * 1000 / RATE;
            const wait = due - now();
            if (wait > 0) await sleep(wait);
            inflight.push(onboard(i));
        }
        await Promise.all(inflight);
    }
    else {
        const worker = async () => {
            while (next < N) await onboard(next++);
        };
        await Promise.all(Array.from({ length: CONC }, worker));
    }
    const t_writes = now();

    /* End-of-burst delivery: the final admin session must see the
     * last device's DeviceInformation. */
    const current = admins.at(-1);
    const [t_deliver] = await Promise.race([
        delivered([current], last.uuid, last.body),
        sleep(Number(opt["settle-timeout"]) * 1000).then(() => [NaN]),
    ]);

    /* Settle: wait until server CPU is idle and no more messages go out. */
    let prev = await http("GET", "/bench/stats");
    let t_settled = now();
    const settle_deadline = now() + Number(opt["settle-timeout"]) * 1000;
    for (;;) {
        await sleep(1000);
        const cur = await http("GET", "/bench/stats");
        const busy = (cur.cpu_ms - prev.cpu_ms) > 50 || cur.msgs != prev.msgs;
        prev = cur;
        if (!busy) break;
        t_settled = now();
        if (now() > settle_deadline) { prev.settle_timeout = true; break; }
    }
    const server = prev;

    /* Correctness under load: the final admin session's SEARCH map for
     * DeviceInformation must match the database. */
    const db_list = await http("GET", `/v2/app/${App.DeviceInformation}/object/`);
    let di_sub;
    for (const sub of current.subs.values())
        if (sub.req.parent == `v2/app/${App.DeviceInformation}/object/`) di_sub = sub;
    const map_ok = di_sub.map.size == db_list.length
        && db_list.every(o => di_sub.map.has(o));

    const sorted = lat.slice().sort((a, b) => a - b);
    const result = {
        args: { N, CONC, RATE, REOPEN, WATCH_EXISTING, FOLLOW },
        requests,
        write_ms:           t_writes - t_start,
        writes_per_s:       requests / ((t_writes - t_start) / 1000),
        device_p50_ms:      sorted[Math.floor(sorted.length / 2)],
        device_max_ms:      sorted.at(-1),
        deliver_lag_ms:     t_deliver - t_writes,
        settle_ms:          t_settled - t_writes,
        admin_sessions:     admins.length,
        admin_ready_ms:     await Promise.all(admins.map(a =>
                                a.all_ready.then(t => t - a.opened))),
        client_msgs:        admins.reduce((a, s) => a + s.msgs, 0) + i3x.msgs,
        client_bytes:       admins.reduce((a, s) => a + s.bytes, 0) + i3x.bytes,
        client_full_msgs:   admins.reduce((a, s) => a + s.fulls, 0),
        final_map_matches_db: map_ok,
        conn_resets,
        server,
        cpu_ms_per_request: server.cpu_ms / requests,
    };
    console.log(JSON.stringify(result, null, 2));
    if (opt.out) {
        const fs = await import("fs");
        fs.writeFileSync(opt.out, JSON.stringify(result, null, 2));
    }
    for (const a of admins) a.close();
    i3x.close();
}

await main();
process.exit(0);
