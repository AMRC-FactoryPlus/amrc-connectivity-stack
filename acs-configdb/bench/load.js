#!/usr/bin/env node
/*
 * ACS ConfigDB
 * Notify fan-out benchmark: watcher load plus device onboarding writes
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run against bench/server.js. See bench/README.md.
 *
 * Watchers (all held open for the whole run):
 *  - "i3x": one WS. WATCH members of Device; WATCH DeviceInformation
 *    and Info for every Device member (and for new ones as they
 *    appear, as acs-i3x does); WATCH Schema and Info for every Schema.
 *  - "auth": one WS. WATCH members of Principal and Permission and of
 *    each of their subclasses (watch_powerset); SEARCH Registration.
 *  - "admin": N WSs (browser tabs). WATCH members of every class
 *    (useMemberStore); SEARCH Info and Registration (useObjectStore).
 *
 * Writes: for each device, POST /v2/object, PUT Info, PUT
 * DeviceInformation (a ~4 KB document copied from an existing device),
 * one device every --interval ms.
 */

import fs                           from "node:fs";
import { parseArgs }                from "node:util";

import { HttpClient, NotifyClient } from "./client.js";

const Class = {
    Device:     "18773d6d-a70d-443a-b29a-3f1583195290",
    Schema:     "83ee28d4-023e-4c2c-ab86-12c24e86372c",
    Class:      "04a1c90d-2295-4cbe-b33a-74eded62cbf1",
    R2Class:    "705888ce-53fa-434d-afee-274b331d4642",
    R3Class:    "52b80183-6998-4bf9-9b30-132755e7dede",
    Principal:  "11614546-b6d7-11ef-aebd-8fbb45451d7c",
    Permission: "8ae784bb-c4b5-4995-9bf6-799b3c7f21ad",
};
const App = {
    Registration:       "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    Info:               "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    DeviceInformation:  "a98ffed5-c613-4e70-bfd3-efeee250ade5",
    Schema:             "b16e85fb-53c2-49f9-8d83-cdf6763304ba",
};

const { values: opts } = parseArgs({ options: {
    host:       { type: "string", default: "localhost" },
    port:       { type: "string", default: "8080" },
    "bench-port": { type: "string", default: "8081" },
    devices:    { type: "string", default: "200" },
    interval:   { type: "string", default: "500" },
    "admin-tabs": { type: "string", default: "1" },
    /* Offset for the device UUIDs, so repeated runs against one
     * database create different objects. */
    seed:       { type: "string", default: "1" },
    profile:    { type: "string" },
    out:        { type: "string" },
    state:      { type: "string" },
    /* Server CPU per 500 ms below which we call it idle. */
    "idle-ms":  { type: "string", default: "25" },
}});

const base = `http://${opts.host}:${opts.port}`;
const ws_url = `ws://${opts.host}:${opts.port}/notify/v2`;
const bench = p => fetch(`http://${opts.host}:${opts["bench-port"]}${p}`)
    .then(r => r.json());
const log = (fmt, ...a) => console.error(`%s ${fmt}`, new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const admin = new HttpClient(base, "admin");
const list = async p => {
    const r = await admin.get(p);
    if (r.status != 200) throw new Error(`GET ${p}: ${r.status}`);
    return r.body;
};
const members = k => list(`/v2/class/${k}/member`);
const subclasses = k => list(`/v2/class/${k}/subclass`);
const cfg_url = (app, obj) => `v2/app/${app}/object/${obj}`;
const mem_url = k => `v2/class/${k}/member/`;

/* Deterministic device UUIDs, so runs against identical databases
 * produce comparable final states. */
const dev_uuid = i => {
    const hex = (Number(opts.seed) * 1e6 + i).toString(16).padStart(12, "0");
    return `0b0b0b0b-0000-4000-8000-${hex}`;
};

async function setup_i3x () {
    const cli = await new NotifyClient({ url: ws_url, token: "i3x" }).connect();
    const watched = new Set();
    const watch_dev = d => {
        if (watched.has(d)) return;
        watched.add(d);
        cli.watch(cfg_url(App.DeviceInformation, d));
        cli.watch(cfg_url(App.Info, d));
    };
    for (const d of await members(Class.Device))
        watch_dev(d);
    for (const s of await members(Class.Schema)) {
        cli.watch(cfg_url(App.Schema, s));
        cli.watch(cfg_url(App.Info, s));
    }
    /* As acs-i3x: new Device members get their own config watches. */
    cli.watch(mem_url(Class.Device), u => {
        if (u.response?.status == 200)
            u.response.body.forEach(watch_dev);
    });
    return cli;
}

async function setup_auth () {
    const cli = await new NotifyClient({ url: ws_url, token: "auth" }).connect();
    for (const k of [Class.Principal, Class.Permission]) {
        cli.watch(mem_url(k));
        cli.watch(`v2/class/${k}/subclass/`);
        for (const s of await subclasses(k))
            cli.watch(mem_url(s));
    }
    cli.search(`v2/app/${App.Registration}/object/`);
    return cli;
}

async function setup_admin () {
    const cli = await new NotifyClient({ url: ws_url, token: "admin" }).connect();
    const classes = new Set();
    for (const r of [Class.Class, Class.R2Class, Class.R3Class])
        for (const k of await members(r))
            classes.add(k);
    for (const k of classes)
        cli.watch(mem_url(k));
    cli.search(`v2/app/${App.Info}/object/`);
    cli.search(`v2/app/${App.Registration}/object/`);
    return cli;
}

async function write_device (i, devinfo) {
    const uuid = dev_uuid(i);
    const steps = [
        ["POST", () => admin.post("/v2/object", { uuid, class: Class.Device })],
        ["PUT Info", () => admin.put(`/${cfg_url(App.Info, uuid)}`,
            { name: `Bench device ${i}` })],
        ["PUT DeviceInformation", () => admin.put(
            `/${cfg_url(App.DeviceInformation, uuid)}`, devinfo)],
    ];
    const times = [];
    for (const [name, fn] of steps) {
        const r = await fn();
        if (r.status >= 300)
            throw new Error(`${name} ${uuid}: ${r.status} ${r.body}`);
        times.push(r.ms);
    }
    return times;
}

/* Wait until nothing is arriving and the server is idle. */
async function quiesce (clients) {
    let quiet = 0;
    let last = await bench("/stats");
    const t0 = performance.now();
    while (quiet < 4) {
        await sleep(500);
        const now = await bench("/stats");
        const recent = clients.some(c => performance.now() - c.last_msg < 500);
        const busy = now.cpu_ms - last.cpu_ms > Number(opts["idle-ms"]);
        quiet = recent || busy ? 0 : quiet + 1;
        last = now;
        if (performance.now() - t0 > 30*60*1000)
            throw new Error("Server did not quiesce");
    }
}

function pct (xs, p) {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
}

async function main () {
    const n = Number(opts.devices);
    const interval = Number(opts.interval);

    /* A DeviceInformation document from the dataset. */
    const devs = await members(Class.Device);
    const devinfo = (await admin.get(`/${cfg_url(App.DeviceInformation, devs[0])}`)).body;
    log("DeviceInformation template: %d bytes", JSON.stringify(devinfo).length);

    log("Opening watchers...");
    const t_setup = performance.now();
    const clients = [await setup_i3x(), await setup_auth()];
    for (let i = 0; i < Number(opts["admin-tabs"]); i++)
        clients.push(await setup_admin());
    await Promise.all(clients.map(c => c.initialised()));
    await quiesce(clients);
    const subs = clients.map(c => c.subs.size);
    log("Watchers ready in %d ms: %o subs", Math.round(performance.now() - t_setup), subs);

    const m0 = clients.map(c => [c.messages, c.bytes]);
    await bench("/reset");
    if (opts.profile) await bench("/prof/start");

    log("Writing %d devices, one every %d ms...", n, interval);
    const t0 = performance.now();
    const lat = [];
    for (let i = 0; i < n; i++) {
        const due = t0 + i * interval;
        const wait = due - performance.now();
        if (wait > 0) await sleep(wait);
        /* Devices are written sequentially, as the onboarding script
         * does. If the server falls behind, we fall behind with it. */
        lat.push(...await write_device(i, devinfo));
    }
    const t_writes = performance.now() - t0;
    const pre_quiesce = await bench("/stats");
    await quiesce(clients);
    const st = await bench("/stats");
    if (opts.profile)
        await bench(`/prof/stop?file=${encodeURIComponent(opts.profile)}`);

    const writes = n * 3;
    const msgs = clients.map((c, i) => c.messages - m0[i][0]);
    const bytes = clients.map((c, i) => c.bytes - m0[i][1]);
    const result = {
        devices: n, writes, interval_ms: interval,
        subs,
        writes_wall_ms: Math.round(t_writes),
        /* Wall time from first write until the last notify was sent. */
        drain_ms: st.wall_ms - 2000,
        cpu_ms: st.cpu_ms,
        cpu_ms_at_last_write: pre_quiesce.cpu_ms,
        cpu_ms_per_write: +(st.cpu_ms / writes).toFixed(2),
        cpu_util_pct: +(100 * st.cpu_ms / st.wall_ms).toFixed(1),
        write_ms_p50: +pct(lat, 50).toFixed(1),
        write_ms_p99: +pct(lat, 99).toFixed(1),
        write_ms_mean: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(1),
        txns: st.txn,
        class_lookups: st.class_lookup,
        eld_p99_ms: st.eld_p99_ms,
        eld_max_ms: st.eld_max_ms,
        messages: msgs.reduce((a, b) => a + b, 0),
        bytes: bytes.reduce((a, b) => a + b, 0),
        messages_by_client: msgs,
        bytes_by_client: bytes,
        rss_mb: st.rss_mb,
    };
    console.log(JSON.stringify(result));
    if (opts.out)
        fs.writeFileSync(opts.out, JSON.stringify(result, null, 2));
    if (opts.state) {
        const state = clients.map(c => c.final_state());
        fs.writeFileSync(opts.state, JSON.stringify(state));
    }
    clients.forEach(c => c.close());
}

await main();
