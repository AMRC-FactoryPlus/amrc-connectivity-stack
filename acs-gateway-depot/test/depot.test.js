/*
 * ACS Gateway Depot
 * Tests for the gateway lifecycle, with the ConfigDB and the Cluster
 * Manager replaced by fakes.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert       from "node:assert/strict";
import crypto       from "node:crypto";
import { test }     from "node:test";
import timers       from "node:timers/promises";

import { gateway_conf } from "../lib/autoinstall.js";
import { App, State }   from "../lib/constants.js";
import { Depot }        from "../lib/depot.js";
import { DepotError }   from "../lib/errors.js";
import { Store }        from "../lib/store.js";

const debug = { bound: () => () => {} };

class FakeConfigDB {
    constructor () { this.configs = new Map(); this.objects = new Set(); }
    key (app, obj) { return `${app}/${obj}`; }
    async list_configs (app) {
        return [...this.configs.keys()]
            .filter(k => k.startsWith(`${app}/`)).map(k => k.split("/")[1]);
    }
    async get_config (app, obj) { return this.configs.get(this.key(app, obj)); }
    async put_config (app, obj, json) {
        this.configs.set(this.key(app, obj), structuredClone(json));
    }
    async delete_config (app, obj) { this.configs.delete(this.key(app, obj)); }
    async create_object () {
        const uuid = crypto.randomUUID();
        this.objects.add(uuid);
        return uuid;
    }
    async delete_object (uuid) { this.objects.delete(uuid); }
}

class FakeClusters {
    constructor () { this.calls = []; this.hosts = new Map(); }
    async list () {
        return [...this.hosts].map(([uuid, hosts]) =>
            ({ uuid, name: uuid, reported: hosts.length > 0, hosts }));
    }
    async create (name) {
        this.calls.push(["create", name]);
        const uuid = `cluster-${name}`;
        this.hosts.set(uuid, []);
        return { uuid, name };
    }
    async enrol (uuid) {
        this.calls.push(["enrol", uuid]);
        return { token: `token-for-${uuid}`, bootstrap: `http://cm/${uuid}/bootstrap` };
    }
    async unenrol (uuid) { this.calls.push(["unenrol", uuid]); }
}

const payload = {
    versions:       { K3S_VERSION: "v1.34.13+k3s1" },
    archive_sha:    "a".repeat(64),
    k3s_for:        arch => {
        if (arch != "amd64") throw new DepotError(409, "no binary");
        return { sha: "b".repeat(64), file: "/nonexistent" };
    },
};

const defaults = {
    registry_mirror: "", apt_mirror: "", apt_mirror_key: "", apt_mirror_key_sha256: "",
    apt_mirror_origin: "", admin_user: "fplus",
    locale: "en_GB.UTF-8", keyboard: "gb", timezone: "Europe/London",
};

async function setup (cdb = new FakeConfigDB()) {
    const fplus = { ConfigDB: cdb, debug };
    const store = await new Store({ fplus }).init();
    const clusters = new FakeClusters();
    const depot = new Depot({
        fplus, store, clusters, payload, defaults,
        public_url: "https://depot.example", has_ca: false, poll: 5,
    }).init();
    return { cdb, store, clusters, depot };
}

function machine (serial = "SERIAL1") {
    return {
        id:         crypto.randomUUID(),
        secret:     crypto.randomBytes(48).toString("base64url"),
        inventory:  {
            serial, vendor: "V", model: "M", arch: "amd64",
            memory: 8e9, cpus: 4,
            nics: [
                { name: "enp1s0", mac: "00:00:00:00:00:01", link: true, ipv4: "10.0.0.5/24" },
                { name: "enp2s0", mac: "00:00:00:00:00:02", link: false, ipv4: "" },
            ],
            disks: [{ path: "/dev/sda", size: 256e9, model: "D", transport: "sata" }],
        },
    };
}

const SETTINGS = {
    north_mac: "00:00:00:00:00:01", south_mac: "00:00:00:00:00:02",
    south_addr: "192.168.1.200/24", disk: "/dev/sda", admin_user: "fplus",
};

/* Take a machine from blank to ready: scout, approve, install, boot. */
async function ready (depot, m, extra = {}) {
    depot.scout(m, "10.0.0.5");
    const approved = await depot.approve(m.id, { ...SETTINGS, ...extra }, "alice@R");
    depot.scout(m, "10.0.0.5");
    depot.checkin(m.id, { secret: m.secret, phase: "installed" }, "10.0.0.5");
    depot.checkin(m.id, report(m, "ready"), "10.0.0.9");
    return approved;
}

function report (m, phase, more = {}) {
    return {
        secret: m.secret, phase,
        report: {
            hostname: `fpcgw-${m.inventory.serial.toLowerCase()}`,
            north: "enp1s0", south: "enp2s0", k3s: "",
            nics: [
                { name: "enp1s0", mac: "00:00:00:00:00:01", link: true, ipv4: "10.9.0.7/24" },
                { name: "enp2s0", mac: "00:00:00:00:00:02", link: true, ipv4: "192.168.1.200/24" },
            ],
        },
        ...more,
    };
}

/* Act as the gateway's agent: collect the next job. */
function collect (depot, m, more = {}) {
    return depot.checkin(m.id, report(m, "ready", more), "10.0.0.9").job;
}

async function until (fn) {
    for (let i = 0; i < 400; i++) {
        if (fn()) return;
        await timers.setTimeout(5);
    }
    assert.fail("condition was not met in time");
}

test("a machine that has not been approved is not written to the ConfigDB", async () => {
    const { cdb, depot } = await setup();
    const m = machine();

    assert.deepEqual(depot.scout(m, "10.0.0.5"), { state: State.Pending });
    assert.equal(cdb.objects.size, 0);
    assert.equal(cdb.configs.size, 0);
    assert.equal(depot.list()[0].inventory.serial, "SERIAL1");
});

test("a scout with the wrong secret is refused", async () => {
    const { depot } = await setup();
    const m = machine();
    depot.scout(m, "10.0.0.5");

    assert.throws(() => depot.scout({ ...m, secret: "x".repeat(64) }, "10.0.0.6"),
        e => e instanceof DepotError && e.status == 403);
});

test("approval is validated before anything is written", async () => {
    const { cdb, depot } = await setup();
    const m = machine();
    depot.scout(m, "10.0.0.5");

    const bad = [
        { ...SETTINGS, north_mac: "ff:ff:ff:ff:ff:ff" },
        { ...SETTINGS, south_mac: SETTINGS.north_mac },
        { ...SETTINGS, south_addr: "banana" },
        { ...SETTINGS, disk: "/dev/nope" },
        { ...SETTINGS, admin_user: "Root User" },
        { ...SETTINGS, ssh_keys: "not a key" },
    ];
    for (const body of bad) {
        await assert.rejects(depot.approve(m.id, body, "alice@R"),
            e => e instanceof DepotError && e.status == 400);
    }
    assert.equal(cdb.objects.size, 0);
});

test("approval puts the gateway on record and hands its settings to it once", async () => {
    const { cdb, depot } = await setup();
    const m = machine();
    depot.scout(m, "10.0.0.5");

    const rv = await depot.approve(m.id, SETTINGS, "alice@R");
    assert.equal(rv.admin_user, "fplus");
    assert.equal(rv.password.length, 16);
    assert.equal(rv.gateway.state, State.Approved);
    assert.equal(rv.gateway.secret_hash, undefined);
    assert.equal(rv.gateway.password_hash, undefined);

    const uuid = rv.gateway.uuid;
    assert.ok(cdb.objects.has(uuid));
    const pub = await cdb.get_config(App.Gateway, uuid);
    assert.equal(pub.scout_id, m.id);
    assert.equal(pub.approved_by, "alice@R");
    assert.equal(pub.secret_hash, undefined);
    const priv = await cdb.get_config(App.Private, uuid);
    assert.ok(priv.secret_hash && priv.password_hash);
    assert.ok(!JSON.stringify([...cdb.configs.values()]).includes(rv.password));

    const answer = depot.scout(m, "10.0.0.5");
    assert.equal(answer.state, "approved");
    const ai = answer.autoinstall.autoinstall;
    assert.equal(ai.identity.username, "fplus");
    assert.equal(ai.storage.layout.match.path, "/dev/sda");
    assert.equal(ai.locale, "en_GB.UTF-8");
    assert.ok(ai["late-commands"].some(c => c.includes(`gateway-${"a".repeat(64)}.tar.gz`)));
    assert.equal(depot.list()[0].state, State.Installing);
});

test("the installer's progress reports show as the install step and log", async () => {
    const { cdb, depot } = await setup();
    const m = machine();
    depot.scout(m, "10.0.0.5");
    await depot.approve(m.id, SETTINGS, "alice@R");
    const ai = depot.scout(m, "10.0.0.5").autoinstall.autoinstall;

    assert.equal(ai.reporting.builtin.type, "print");
    const url = new URL(ai.reporting.depot.endpoint);
    assert.equal(url.origin, "https://depot.example");
    const [, , , id, , token] = url.pathname.split("/");
    assert.equal(id, m.id);

    const ev = (event_type, name, description, more = {}) =>
        ({ event_type, name, description, origin: "curtin", timestamp: 1, ...more });
    depot.progress(id, token, ev("start", "subiquity/Install/install/curtin_install", "installing system"));
    depot.progress(id, token, ev("start", "subiquity/Meta/status_GET", "status"));
    depot.progress(id, token, ev("finish", "subiquity/Install/install/postinstall/x", "configuring cloud-init", { result: "FAIL" }));

    const gw = depot.list()[0];
    assert.equal(gw.install_step, "installing system");
    assert.match(gw.log, /start: installing system\n/);
    assert.match(gw.log, /finish: configuring cloud-init \(FAIL\)/);
    assert.doesNotMatch(gw.log, /status/);
    assert.equal(gw.progress_hash, undefined);

    assert.throws(() => depot.progress(id, "wrong", ev("start", "a/b", "c")),
        e => e.status == 403);
    assert.ok(!JSON.stringify([...cdb.configs.values()]).includes("installing system"));

    /* Once it has installed, late reports change nothing. */
    depot.checkin(m.id, { secret: m.secret, phase: "installed" }, "10.0.0.5");
    depot.progress(id, token, ev("start", "subiquity/Install/x", "late"));
    assert.equal(depot.list()[0].install_step, "installing system");
});

test("a failed install sends the end of its journal before it reports", async () => {
    const { cdb, depot } = await setup();
    const m = machine();
    depot.scout(m, "10.0.0.5");
    await depot.approve(m.id, SETTINGS, "alice@R");
    const ai = depot.scout(m, "10.0.0.5").autoinstall.autoinstall;

    /* The upload comes first, so the depot still takes it, and a failed
     * upload does not stop the failure being reported. */
    const [upload, report] = ai["error-commands"];
    assert.match(upload, /^journalctl -b .* \| curl .*--data-binary @- https:\/\/depot\.example\/v1\/box\/.*\/install-journal\/\S+ \|\| true$/);
    assert.match(report, /agent\.py report install-failed/);

    const [, id, token] = upload.match(/\/v1\/box\/([^/]+)\/install-journal\/(\S+)/);
    assert.equal(id, m.id);

    assert.throws(() => depot.install_journal(id, "wrong", "x"), e => e.status == 403);

    depot.install_journal(id, token,
        "E: Failed to fetch Packages.xz\x1b[0m\r\n"
        + "password: $6$abc$defghij\n"
        + `endpoint: /install-journal/${token}\n`);
    depot.checkin(m.id, { secret: m.secret, phase: "install-failed" }, "10.0.0.5");

    const gw = depot.list()[0];
    assert.equal(gw.state, State.Failed);
    assert.match(gw.install_journal, /^E: Failed to fetch Packages\.xz\[0m\n/);
    assert.match(gw.install_journal, /password: <hash>\n/);
    assert.ok(!gw.install_journal.includes(token));
    assert.ok(!JSON.stringify([...cdb.configs.values()]).includes("Failed to fetch"));

    /* A gateway that installed does not take a journal. */
    const n = machine("serial2");
    depot.scout(n, "10.0.0.6");
    await depot.approve(n.id, SETTINGS, "alice@R");
    const up2 = depot.scout(n, "10.0.0.6").autoinstall.autoinstall["error-commands"][0];
    const token2 = up2.match(/install-journal\/(\S+)/)[1];
    depot.checkin(n.id, { secret: n.secret, phase: "installed" }, "10.0.0.6");
    depot.install_journal(n.id, token2, "late");
    assert.equal(depot.list().find(b => b.id == n.id).install_journal, undefined);
});

test("a gateway is reloaded from the ConfigDB after a restart", async () => {
    const first = await setup();
    const m = machine();
    await ready(first.depot, m);
    await first.store.queue.get(m.id);

    const second = await setup(first.cdb);
    const box = second.depot.list()[0];
    assert.equal(box.id, m.id);
    assert.equal(box.state, State.Ready);
    assert.equal(box.report.hostname, "fpcgw-serial1");
    /* Its secret still works. */
    second.depot.checkin(m.id, report(m, "ready"), "10.0.0.9");
});

test("onboarding creates a cluster, enrols it and hands the gateway a token once", async () => {
    const { clusters, depot } = await setup();
    const m = machine();
    await ready(depot, m);

    const rv = await depot.onboard(m.id, { mode: "create", cluster_name: "Tapeline" }, "alice@R");
    assert.equal(rv.gateway.state, State.Onboarding);

    let job;
    await until(() => (job = collect(depot, m)));
    assert.equal(job.type, "onboard");
    assert.equal(job.mode, "create");
    assert.equal(job.token, "token-for-cluster-Tapeline");
    assert.equal(job.bootstrap_url, "http://cm/cluster-Tapeline/bootstrap");
    /* It is handed over once. */
    assert.equal(collect(depot, m, { busy: true }), undefined);

    clusters.hosts.set("cluster-Tapeline", ["fpcgw-serial1"]);
    depot.checkin(m.id, report(m, "onboarded", { job_done: { id: job.id, ok: true } }), "10.0.0.9");
    await until(() => depot.list()[0].onboard.reported);

    const box = depot.list()[0];
    assert.equal(box.state, State.Onboarded);
    assert.equal(box.onboard.cluster.name, "Tapeline");
    assert.deepEqual(clusters.calls.map(c => c[0]), ["create", "enrol", "unenrol"]);
});

test("a failed job fails the gateway, revokes the token, and a retry reuses the cluster", async () => {
    const { clusters, depot } = await setup();
    const m = machine();
    await ready(depot, m);
    await depot.onboard(m.id, { mode: "create", cluster_name: "Tapeline" }, "alice@R");

    let job;
    await until(() => (job = collect(depot, m)));
    depot.checkin(m.id, report(m, "ready",
        { job_done: { id: job.id, ok: false, error: "The Factory+ bootstrap failed. See the log." } }), "10.0.0.9");
    await until(() => depot.list()[0].state == State.Failed);
    assert.equal(depot.list()[0].onboard.error, "The Factory+ bootstrap failed. See the log.");
    assert.ok(clusters.calls.some(c => c[0] == "unenrol"));

    await depot.onboard(m.id, { mode: "create", cluster_name: "Tapeline" }, "alice@R");
    assert.equal(clusters.calls.filter(c => c[0] == "create").length, 1);
});

test("a gateway that drops its job is failed, not left onboarding for ever", async (t) => {
    const { depot } = await setup();
    const m = machine();
    await ready(depot, m);
    await depot.onboard(m.id, { mode: "create", cluster_name: "Tapeline" }, "alice@R");
    await until(() => collect(depot, m));

    /* 46 seconds later it calls in, idle, with nothing to report. */
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 46000 });
    collect(depot, m);
    t.mock.timers.reset();
    await until(() => depot.list()[0].state == State.Failed);
    assert.match(depot.list()[0].onboard.error, /stopped working on the job/);
});

test("joining asks the first gateway for a token and passes it on", async () => {
    const { clusters, depot } = await setup();
    const first = machine("FIRST"), second = machine("SECOND");
    await ready(depot, first);
    await depot.onboard(first.id, { mode: "create", cluster_name: "Cell" }, "alice@R");
    let job;
    await until(() => (job = collect(depot, first)));
    clusters.hosts.set("cluster-Cell", ["fpcgw-first"]);
    depot.checkin(first.id, report(first, "onboarded", { job_done: { id: job.id, ok: true } }), "10.9.0.7");
    await until(() => depot.get(first.id).onboard.reported);

    await ready(depot, second);
    await depot.onboard(second.id, { mode: "join", server: first.id }, "alice@R");

    let token_job;
    await until(() => (token_job = depot.checkin(first.id, report(first, "onboarded"), "10.9.0.7").job));
    assert.equal(token_job.type, "join-token");
    depot.checkin(first.id, report(first, "onboarded",
        { job_done: { id: token_job.id, ok: true, result: { token: "K10::join" } } }), "10.9.0.7");

    let join_job;
    await until(() => (join_job = collect(depot, second)));
    assert.equal(join_job.mode, "join");
    assert.equal(join_job.k3s_token, "K10::join");
    /* The first gateway's northbound address. */
    assert.equal(join_job.k3s_url, "https://10.9.0.7:6443");
    /* Joining needs no enrolment token: the cluster is already enrolled. */
    assert.equal(clusters.calls.filter(c => c[0] == "enrol").length, 1);
});

test("a replacement keeps the hostname, takes over the cluster and retires the old gateway", async () => {
    const { clusters, depot } = await setup();
    const old = machine("OLD"), fresh = machine("NEW");
    await ready(depot, old);
    await depot.onboard(old.id, { mode: "create", cluster_name: "Cell" }, "alice@R");
    let job;
    await until(() => (job = collect(depot, old)));
    clusters.hosts.set("cluster-Cell", ["fpcgw-old"]);
    depot.checkin(old.id, report(old, "onboarded", { job_done: { id: job.id, ok: true } }), "10.9.0.7");
    await until(() => depot.get(old.id).onboard.reported);

    depot.scout(fresh, "10.0.0.5");
    const approved = await depot.approve(fresh.id, { ...SETTINGS, replaces: old.id }, "bob@R");
    assert.equal(approved.gateway.settings.hostname, "fpcgw-old");
    const conf = depot.scout(fresh, "10.0.0.5").autoinstall.autoinstall["late-commands"]
        .map(c => /^echo (\S+) \| base64 -d/.exec(c)?.[1]).filter(Boolean)
        .map(b => Buffer.from(b, "base64").toString()).join("\n");
    assert.match(conf, /GW_HOSTNAME='fpcgw-old'/);

    depot.checkin(fresh.id, { secret: fresh.secret, phase: "installed" }, "10.0.0.5");
    depot.checkin(fresh.id, report(fresh, "ready"), "10.9.0.7");
    /* No cluster name: it takes over the old gateway's cluster. */
    await depot.onboard(fresh.id, { mode: "create" }, "bob@R");
    await until(() => (job = collect(depot, fresh)));
    assert.equal(job.token, "token-for-cluster-Cell");
    depot.checkin(fresh.id, report(fresh, "onboarded", { job_done: { id: job.id, ok: true } }), "10.9.0.7");
    await until(() => depot.get(old.id).state == State.Replaced);

    assert.equal(depot.get(old.id).replaced_by, fresh.id);
    assert.equal(depot.get(fresh.id).replaces, old.id);
    assert.equal(clusters.calls.filter(c => c[0] == "create").length, 1);
    /* A gateway can only be replaced once. */
    const third = machine("THIRD");
    depot.scout(third, "10.0.0.5");
    await assert.rejects(depot.approve(third.id, { ...SETTINGS, replaces: old.id }, "bob@R"),
        e => e instanceof DepotError && e.status == 409);
});

test("gateway.conf carries the apt mirror key as one line of base64", () => {
    const key = "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEZ\n-----END PGP PUBLIC KEY BLOCK-----\n";
    const conf = gateway_conf({ north_mac: "00:11:22:33:44:55", apt_mirror_key: key });
    const line = conf.split("\n").find(l => l.startsWith("APT_MIRROR_KEY="));
    const value = line.slice("APT_MIRROR_KEY=".length).replace(/^'|'$/g, "");
    assert.match(value, /^[A-Za-z0-9+/=]+$/);
    assert.equal(Buffer.from(value, "base64").toString(), key);

    const none = gateway_conf({ north_mac: "00:11:22:33:44:55" });
    assert.match(none, /^APT_MIRROR_KEY=(''|)$/m);
});
