/*
 * ACS ConfigDB
 * End-to-end tests of the notify/v2 interface
 * Copyright 2026 University of Sheffield AMRC
 *
 * These run bench/server.js (the real ConfigDB with test auth) against
 * a disposable PostgreSQL database and check what notify clients
 * receive on the wire. See bench/README.md for how to run them.
 *
 * The expected streams here are the behaviour of ConfigDB before the
 * shared class lookups were introduced; the tests pass on both.
 */

import assert           from "node:assert/strict";
import { spawn }        from "node:child_process";
import { after, before, describe, test } from "node:test";
import url              from "node:url";

import { HttpClient, NotifyClient, normalise } from "../bench/client.js";

const Class = {
    Class:      "04a1c90d-2295-4cbe-b33a-74eded62cbf1",
    Device:     "18773d6d-a70d-443a-b29a-3f1583195290",
};
const App = {
    Registration:   "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    Info:           "64a8bfa9-7772-45c4-9d1a-9e6290690957",
};
const Perm = {
    ReadMembers:    "d4fd61da-50ef-11f0-ad24-335234e4c8a2",
};

const skip = !process.env.PGHOST && "set PGHOST etc. to a migrated ConfigDB database";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://localhost:${port}`;
const bench = p => fetch(`http://localhost:${port + 1}${p}`).then(r => r.json());

let server;
const clients = [];
const admin = new HttpClient(base, "admin");

async function start_server () {
    const script = url.fileURLToPath(new URL("../bench/server.js", import.meta.url));
    server = spawn(process.execPath, [script], {
        /* These tests check each change's messages after a short
         * settle, so they turn the class lookup throttle off. */
        env: { ...process.env, PORT: port, BENCH_PORT: port + 1, VERBOSE: "",
            CLASS_LOOKUP_INTERVAL: "0" },
        stdio: ["ignore", "ignore", "inherit"],
    });
    for (let i = 0; i < 100; i++) {
        try {
            const r = await admin.get("/ping");
            if (r.status == 200) return;
        }
        catch { /* not up yet */ }
        await sleep(100);
    }
    throw new Error("Server did not start");
}

async function client (token) {
    const c = await new NotifyClient({
        url: `ws://localhost:${port}/notify/v2`, token, record: true,
    }).connect();
    clients.push(c);
    return c;
}

/* Wait until no client has had a message for `quiet` ms. */
async function settle (quiet = 400) {
    for (;;) {
        await sleep(quiet / 4);
        const last = Math.max(0, ...clients.map(c => c.last_msg));
        if (performance.now() - last > quiet) return;
    }
}

async function ok (p) {
    const r = await p;
    assert.ok(r.status < 300, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
}

const mkobj = klass =>
    ok(admin.post("/v2/object", { class: klass })).then(r => r.body.uuid);
const mkclass = () => mkobj(Class.Class);
const cfg = (app, obj) => `v2/app/${app}/object/${obj}`;
const rel = (klass, r) => `v2/class/${klass}/${r}/`;

/* The client-visible messages for a sub, without per-run detail. */
const seen = sub => sub.updates.map(normalise);
const list = (status, ...uuids) =>
    ({ status, response: { status: 200, body: uuids.sort() } });
const denied = status => ({ status, response: { status: 403 } });
const stream = (sub, want) => assert.deepEqual(seen(sub), want,
    `${sub.req}: got ${JSON.stringify(seen(sub))}`);

describe("notify/v2", { skip }, () => {
    before(start_server);
    after(() => {
        clients.forEach(c => c.close());
        server?.kill();
    });

    test("single config watch", async () => {
        const i3x = await client("i3x");
        const obj = await mkobj(Class.Device);
        const other = await mkobj(Class.Device);

        const s = i3x.watch(cfg(App.Info, obj));
        const v1 = i3x.watch(`v1/app/${App.Info}/object/${obj}`);
        const o = i3x.watch(cfg(App.Info, other));
        await i3x.initialised();

        await ok(admin.put(`/${cfg(App.Info, obj)}`, { name: "one" }));
        await settle();
        /* An unchanged PUT sends nothing */
        await ok(admin.put(`/${cfg(App.Info, obj)}`, { name: "one" }));
        await settle();
        await ok(admin.put(`/${cfg(App.Info, obj)}`, { name: "two" }));
        await settle();
        await ok(admin.delete(`/${cfg(App.Info, obj)}`));
        await settle();

        const expect = [
            { status: 201, response: { status: 404 } },
            { status: 200, response: { status: 200, body: { name: "one" } } },
            { status: 200, response: { status: 200, body: { name: "two" } } },
            { status: 200, response: { status: 404 } },
        ];
        stream(s, expect);
        stream(v1, expect);
        assert.ok(s.updates[0].response.headers?.etag == undefined);
        stream(o, [{ status: 201, response: { status: 404 } }]);
    });

    test("class member and subclass watches", async () => {
        const i3x = await client("i3x");
        const adm = await client("admin");
        const K = await mkclass();

        const a = i3x.watch(rel(K, "member"));
        const b = adm.watch(rel(K, "member"));
        const d = adm.watch(rel(K, "direct/member"));
        const sc = adm.watch(rel(K, "subclass"));
        const dsc = adm.watch(rel(K, "direct/subclass"));
        await i3x.initialised();
        await adm.initialised();

        const o1 = await mkobj(K);
        await settle();

        const K2 = await mkclass();
        await ok(admin.put(`/v2/class/${K}/direct/subclass/${K2}`));
        await settle();

        const o2 = await mkobj(K2);
        await settle();

        const o3 = await mkobj(Class.Device);
        await settle();
        await ok(admin.put(`/v2/class/${K}/direct/member/${o3}`));
        await settle();
        await ok(admin.delete(`/v2/class/${K}/direct/member/${o3}`));
        await settle();

        /* Changes elsewhere send nothing */
        await mkobj(Class.Device);
        await settle();

        const late = adm.watch(rel(K, "member"));
        await adm.initialised();
        await settle();

        const members = [
            list(201),
            list(200, o1),
            list(200, o1, o2),
            list(200, o1, o2, o3),
            list(200, o1, o2),
        ];
        stream(a, members);
        stream(b, members);
        stream(d, [
            list(201),
            list(200, o1),
            list(200, o1, o3),
            list(200, o1),
        ]);
        /* The subclass relation includes the class itself. */
        stream(sc, [list(201, K), list(200, K, K2)]);
        stream(dsc, [list(201), list(200, K2)]);
        stream(late, [list(201, o1, o2)]);
    });

    test("watch of a class that does not exist", async () => {
        const adm = await client("admin");
        const s = adm.watch(rel("0b0b0b0b-0000-4000-8000-000000000000", "member"));
        await adm.initialised();
        await mkobj(Class.Device);
        await settle();
        stream(s, [{ status: 201, response: { status: 404 } }]);
    });

    test("a member of a class and its subclass is listed once", async () => {
        const K = await mkclass();
        const K2 = await mkclass();
        await ok(admin.put(`/v2/class/${K}/direct/subclass/${K2}`));
        const o = await mkobj(K);
        await ok(admin.put(`/v2/class/${K2}/direct/member/${o}`));

        const r = await ok(admin.get(`/${rel(K, "member")}`));
        assert.deepEqual(r.body, [o]);
    });

    test("search", async () => {
        const auth = await client("auth");
        const obj = await mkobj(Class.Device);
        const s = auth.search(`v2/app/${App.Info}/object/`);
        await auth.initialised();

        await ok(admin.put(`/${cfg(App.Info, obj)}`, { name: "s1" }));
        await settle();
        await ok(admin.delete(`/${cfg(App.Info, obj)}`));
        await settle();

        const [full, ...rest] = seen(s);
        assert.equal(full.status, 201);
        assert.equal(full.response.status, 204);
        assert.ok(Object.keys(full.children).length > 0);
        assert.ok(!(obj in full.children));
        assert.deepEqual(rest.map(({ response, ...u }) => ({
            ...u, response: normalise({ response }).response,
        })), [
            { status: 200, child: obj,
                response: { status: 200, body: { name: "s1" } } },
            { status: 200, child: obj, response: { status: 404 } },
        ]);
    });

    test("ACL changes", async () => {
        const nobody = await client("nobody");
        const K = await mkclass();
        const o1 = await mkobj(K);

        const m = nobody.watch(rel(K, "member"));
        const c = nobody.watch(cfg(App.Info, o1));
        await nobody.initialised();

        /* No access. The 403 is sent again on the first change, as
         * the outer status changes from 201 to 200, then not again. */
        const o2 = await mkobj(K);
        await settle();
        const o2b = await mkobj(K);
        await settle();

        await bench(`/acl?token=nobody&acl=${encodeURIComponent(JSON.stringify(
            [{ permission: Perm.ReadMembers, target: K }]))}`);
        const o3 = await mkobj(K);
        await settle();

        await bench("/acl?token=nobody&acl=[]");
        await mkobj(K);
        await settle();

        stream(m, [
            denied(201),
            denied(200),
            list(200, o1, o2, o2b, o3),
            denied(200),
        ]);
        stream(c, [denied(201)]);
    });

    test("object delete", async () => {
        const adm = await client("admin");
        const K = await mkclass();
        const keep = await mkobj(K);
        const obj = await mkobj(K);
        await ok(admin.put(`/${cfg(App.Info, obj)}`, { name: "doomed" }));

        const m = adm.watch(rel(K, "member"));
        const info = adm.watch(cfg(App.Info, obj));
        const reg = adm.watch(cfg(App.Registration, obj));
        await adm.initialised();

        await ok(admin.delete(`/v2/object/${obj}`));
        await settle();

        stream(m, [list(201, keep, obj), list(200, keep)]);
        stream(info, [
            { status: 201, response: { status: 200, body: { name: "doomed" } } },
            { status: 200, response: { status: 404 } },
        ]);
        const regs = seen(reg);
        assert.equal(regs.length, 2);
        assert.equal(regs[0].response.body.uuid, obj);
        assert.deepEqual(regs[1], { status: 200, response: { status: 404 } });
    });

    test("the last state of a burst is delivered", async () => {
        const i3x = await client("i3x");
        const adm = await client("admin");
        const K = await mkclass();
        const devs = await Promise.all(
            Array.from({ length: 20 }, () => mkobj(Class.Device)));

        const subs = [
            i3x.watch(rel(K, "member")),
            adm.watch(rel(K, "member")),
            adm.watch(rel(K, "direct/member")),
        ];
        await i3x.initialised();
        await adm.initialised();

        /* Creates, adds and removes, all at once. */
        const made = await Promise.all([
            ...Array.from({ length: 30 }, () => mkobj(K)),
            ...devs.map(d => ok(admin.put(`/v2/class/${K}/direct/member/${d}`))
                .then(() => null)),
        ]);
        await Promise.all(devs.slice(0, 10).map(d =>
            ok(admin.delete(`/v2/class/${K}/direct/member/${d}`))));
        await settle(1000);

        const want = [...made.filter(u => u), ...devs.slice(10)].sort();
        const current = (await ok(admin.get(`/v2/class/${K}/member`))).body.sort();
        assert.deepEqual(current, want);

        for (const s of subs) {
            const us = seen(s);
            assert.deepEqual(us.at(-1).response.body, want, "final state");
            assert.equal(us[0].status, 201);
            assert.ok(us.slice(1).every(u => u.status == 200));
            /* No update is sent twice in a row. */
            for (let i = 1; i < us.length; i++)
                assert.notDeepEqual(us[i].response, us[i - 1].response);
        }
    });
});
