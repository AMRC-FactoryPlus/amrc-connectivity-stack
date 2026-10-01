/*
 * ACS Auth service
 * Benchmark: CPU per Registration update, main against incremental
 *
 * Loads a Registration SEARCH snapshot of N objects, then feeds child
 * updates that create new objects (the shape of a bulk device
 * import). Reports the CPU time per update for:
 *  - main: NotifyV2#search plus the main `_build_owned`, which rebuild
 *    the Registration map and the owned index on every update;
 *  - incremental: NotifyV2#search_changes plus `owned_apply`.
 * Each run also keeps ACL sequences for ACLS principals subscribed,
 * as a running Auth service does, so the totals include ACL work.
 *
 * Usage: node bench/registration-update.js [N ...]
 * Env: UPDATES (default 200), ACLS (default 10)
 *
 * Copyright 2026 University of Sheffield AMRC
 */

import { DataFlow } from "../lib/dataflow.js";
import { Special } from "../lib/uuids.js";

import {
    scripted_notify, fake_cdb, make_dataflow, ReferenceDataFlow, upd,
} from "../test/fixtures.js";

const sizes = process.argv.slice(2).map(Number);
if (!sizes.length) sizes.push(1000, 10000, 25000, 75000);
const UPDATES = Number(process.env.UPDATES ?? 200);
const ACLS = Number(process.env.ACLS ?? 10);

const P = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const principals = Array.from({ length: 200 }, (_, i) => P(i));
const perm = P(9000);
const grants = principals.map(p => ({
    principal: p, permission: perm, target: Special.Mine, plural: true }));

function cpu_ms (fn) {
    const start = process.cpuUsage();
    fn();
    const d = process.cpuUsage(start);
    return (d.user + d.system) / 1000;
}

async function measure (Klass, N) {
    const { notify, updates } = scripted_notify();
    const cdb = fake_cdb(notify, {
        principals, permissions: [perm],
        principal_groups: {}, permission_groups: {},
    });
    const df = await make_dataflow(Klass, cdb, grants);

    const subs = [df.owned.subscribe()];
    for (const p of principals.slice(0, ACLS))
        subs.push(df._acl_for(p).subscribe());

    const kids = {};
    for (let i = 0; i < N; i++)
        kids[P(100000 + i)] = [200, {
            owner: i % 10 ? principals[i % 200] : Special.Unowned,
            deleted: false,
        }];
    updates.next(upd.full(kids));

    let n = 0;
    const create = () => updates.next(upd.child(P(900000 + n++), 200,
        { owner: principals[n % 200], deleted: false }));

    /* Warm up the JIT, then time. */
    for (let i = 0; i < 20; i++) create();
    const ms = cpu_ms(() => { for (let i = 0; i < UPDATES; i++) create(); });

    subs.forEach(s => s.unsubscribe());
    return ms / UPDATES;
}

console.log(`CPU per create update, ${UPDATES} updates, ${ACLS} ACL subscribers`);
console.log("N\tmain ms\tnew ms\tspeedup");
for (const N of sizes) {
    const before = await measure(ReferenceDataFlow, N);
    const after = await measure(DataFlow, N);
    console.log(`${N}\t${before.toFixed(3)}\t${after.toFixed(3)}\t${(before / after).toFixed(0)}x`);
}
