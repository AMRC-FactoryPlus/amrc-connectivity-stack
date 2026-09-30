/*
 * ACS log verbosity benchmark
 * Measures the cost of the debug logging done for ConfigDB writes.
 * Copyright 2026 University of Sheffield
 *
 * This runs the real logging code from lib/ (Debug, the Auth ACL
 * check, the pg-client transaction wrapper and the rx-client notify
 * handler). Only the network is stubbed: the database client, the Auth
 * service lookup and the notify WebSocket return canned data at once.
 *
 * Usage:
 *   VERBOSE=<tags> LIB=<path to lib/> node bench.mjs <scenario> | wc -lc
 *
 * <scenario> is one of:
 *   configdb         what the ConfigDB process logs for one PUT on its own
 *   configdb-import  one write during the 30 Sept 2026 bulk import on the
 *                    dev cluster: the PUT plus the class lookups and ACL
 *                    checks that each write caused (ratios taken from the
 *                    ConfigDB log of that import, see IMPORT below)
 *   i3x              what the i3X process logs when that PUT reaches it
 *                    as a notify update
 * The debug log goes to stdout, which must be a pipe, as it is in a
 * container. The results go to stderr as one JSON line.
 */

import * as path    from "path";
import * as url     from "url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const LIB = process.env.LIB ?? path.resolve(here, "../../lib");
const lib = p => import(url.pathToFileURL(path.join(LIB, p)).href);

const { Debug }     = await lib("js-service-client/lib/debug.js");
const { Auth }      = await lib("js-service-client/lib/service/auth.js");
const { DB }        = await lib("js-pg-client/lib/index.js");
const { NotifyV2 }  = await lib("js-rx-client/lib/notify-v2.js");

const scenario = process.argv[2];
/* The import scenario logs about 30 times as much per op. */
const scale = scenario == "configdb-import" ? 10 : 1;
const WARMUP = Number(process.env.WARMUP ?? 2000 / scale);
const OPS = Number(process.env.OPS ?? 20000 / scale);

const uuid = n => `${n.toString(16).padStart(8, "0")}-54e5-4ffa-a218-03e802ed6cad`;

/* A device config of about 4 KB, shaped like the edge agent device
 * configs seen on the dev cluster (an originMap of metric definitions). */
function device_config () {
    const metric = (i, type) => ({
        Method: "GET",
        Sparkplug_Type: type,
        Record_To_Historian: true,
        Documentation: `Metric ${i} read from the device over HTTP`,
        Eng_Unit: "m",
        Value: type == "String" ? `value-${i}` : i * 1.5,
    });
    const originMap = {
        Schema_UUID: "e5073693-62a9-4704-a69f-3405f029e656",
        Instance_UUID: "9cf64b37-19eb-5131-ae7c-72fa13ef1b89",
    };
    for (let i = 0; i < 17; i++)
        originMap[`Metric_${i}`] = metric(i, i % 3 ? "Double" : "String");
    return {
        node: uuid(1),
        schema: "e5073693-62a9-4704-a69f-3405f029e656",
        createdAt: "2026-09-30T09:53:29.670Z",
        connection: "d0b02634-54e5-4ffa-a218-03e802ed6cad",
        deviceId: "Bristol_CCTV_Camera_464",
        originMap,
    };
}

const config = device_config();
const config_json = JSON.stringify(config);

/* An ACL of the size seen for service accounts on the dev cluster. */
const acl = Array.from({ length: 5 }, (_, i) => ({
    permission: "4a339562-cd57-408d-9d1a-6529a383ea4b",
    target: uuid(100 + i),
}));

const debug = new Debug({ verbose: process.env.VERBOSE });
const log_http = debug.bound("http");

/* The real Auth interface, with the call to the Auth service stubbed. */
const auth = new Auth({ debug, opts: {} });
auth.fetch_auth_acl = async () => acl;

/* The real DB class, with the Postgres client stubbed. */
const db = new DB({ debug });
const fake_client = {
    query: async () => ({ rows: [{ id: 14705, etag: uuid(7) }], rowCount: 1 }),
    release: () => {},
};
db.connect = async () => fake_client;

/* The statements Model.config_put runs (acs-configdb/lib/model.js). */
async function config_put (app, obj) {
    return db.txn({}, async query => {
        await query(`
            select o.id
            from object o
            where o.uuid = $1
        `, [app]);
        await query(`
            select o.id
            from object o
            where o.uuid = $1
        `, [obj]);
        await query(`
                select id, etag
                from config
                where app = $1 and object = $2
            `, [249, 842]);
        await query(`
                update config as c
                set json = $2, etag = default
                where id = $1 and json != $2
                returning 1 ok
            `, [14705, config_json]);
        return 204;
    });
}

/* The class membership lookup, Model.class_lookup. */
async function class_lookup (klass) {
    return db.txn({}, async query => {
        await query(`
            select o.id
            from object o
            where o.uuid = $1
        `, [klass]);
        await query(`
            select distinct o.uuid
            from all_membership k join object o on o.id = k.id
            where k.class = $1
        `, [113]);
    });
}

/* Per write during the dev cluster import (99 s of ConfigDB log, 1220
 * writes): 26 transactions, 24.4 class lookups, 22.7 ACL checks by the
 * root principal and 1.1 full ACL dumps per write. */
const IMPORT = { lookups: 24, root_checks: 23 };
const root = new Auth({ debug, opts: { root_principal: "admin@EXAMPLE.COM" } });

async function configdb_import_op (n) {
    await configdb_op(n);
    for (let i = 0; i < IMPORT.lookups; i++)
        await class_lookup(uuid(300 + i));
    for (let i = 0; i < IMPORT.root_checks; i++)
        await root.check_acl("admin@EXAMPLE.COM", acl[0].permission, acl[1].target, true);
}

/* One ConfigDB PUT, as the ConfigDB process logs it. */
async function configdb_op (n) {
    const app = uuid(200), obj = uuid(n);
    const princ = "sv1importer@EXAMPLE.COM";
    log_http(">>> PUT /v2/app/%s/object/%s", app, obj);
    log_http("Handling Bearer auth");
    log_http("Auth succeeded for [%s]", princ);
    const ok = await auth.check_acl(princ, acl[0].permission, acl[1].target, true);
    if (!ok) throw new Error("ACL check failed");
    await config_put(app, obj);
    log_http("<<< 204 undefined");
}

/* The same PUT arriving at i3X as a notify update. The real
 * NotifyV2.handle_notify_ws runs against a fake WebSocket. */
const notify = new NotifyV2({ log: debug.bound("configdb"), debug,
    websocket: () => { throw new Error("unused"); } });
const ws = new EventTarget();
ws.readyState = 1;
ws.constructor.OPEN = 1;
ws.send = () => {};
ws.close = () => {};
let received = 0;
notify.handle_notify_ws(ws).subscribe(([send, msgs]) => {
    msgs.subscribe(() => received++);
    send({ method: "WATCH", request: { url: `v2/app/${uuid(200)}/object/${uuid(1)}` }, uuid: uuid(2) });
});

async function i3x_op (n) {
    const update = { status: 200, response: { status: 200, body: config }, uuid: uuid(n) };
    const ev = new Event("message");
    ev.data = JSON.stringify(update);
    ws.dispatchEvent(ev);
}

const op = {
    "configdb":         configdb_op,
    "configdb-import":  configdb_import_op,
    "i3x":              i3x_op,
}[scenario];
if (!op) {
    console.error("Usage: node bench.mjs configdb|configdb-import|i3x");
    process.exit(2);
}

for (let i = 0; i < WARMUP; i++) await op(i);

const cpu0 = process.cpuUsage();
const t0 = process.hrtime.bigint();
for (let i = 0; i < OPS; i++) await op(i);
const wall_us = Number(process.hrtime.bigint() - t0) / 1000;
const cpu = process.cpuUsage(cpu0);

process.stderr.write(JSON.stringify({
    scenario,
    verbose: process.env.VERBOSE ?? "",
    stdout_is_tty: process.stdout.isTTY ?? false,
    config_bytes: config_json.length,
    warmup: WARMUP,
    ops: OPS,
    cpu_us_per_op: (cpu.user + cpu.system) / OPS,
    wall_us_per_op: wall_us / OPS,
    ops_per_s: OPS / (wall_us / 1e6),
    notify_received: received,
}) + "\n");
