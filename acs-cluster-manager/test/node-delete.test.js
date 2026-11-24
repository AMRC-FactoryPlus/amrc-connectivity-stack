/*
 * ACS Cluster Manager
 * Tests for deleting an edge node
 * Copyright 2026 University of Sheffield AMRC
 *
 * The ConfigDB, Auth and the cluster repo are replaced by fakes. The
 * fake krbkeys either removes the agent's account once its deployment
 * goes, as an online cluster does, or never does, as an offline one.
 */

import assert           from "node:assert/strict";
import { describe, test } from "node:test";

import { UUIDs, ServiceError } from "@amrc-factoryplus/service-client";

import { EdgeDeploy }               from "../lib/edge-deploy.js";
import { NodeDelete, secret_name }  from "../lib/node-delete.js";
import { Edge }                     from "../lib/uuids.js";

const { App, Class } = UUIDs;
const debug = { bound: () => () => {} };

const CLUSTER = "cluster-1";
const NODE = "node-1";
const ROLE = "role-edge-agent";
const CHART = "chart-agent";

const not_found = () => new ServiceError("x", "not found", 404);

class FakeConfigDB {
    constructor () {
        this.configs = new Map();
        this.objects = new Set();
        this.members = new Map();
        this.calls = [];
    }
    key (app, obj) { return `${app}/${obj}`; }
    put (app, obj, json) {
        this.objects.add(obj);
        this.configs.set(this.key(app, obj), json);
    }
    async get_config (app, obj) { return this.configs.get(this.key(app, obj)); }
    async delete_config (app, obj) {
        this.calls.push(["delete_config", app, obj]);
        if (!this.configs.delete(this.key(app, obj))) throw not_found();
    }
    async search ({ app, query }) {
        const [[k, v]] = Object.entries(query);
        return [...this.configs]
            .filter(([key, json]) => key.startsWith(`${app}/`) && json[k] == v)
            .map(([key]) => key.split("/")[1]);
    }
    async delete_object (obj) {
        this.calls.push(["delete_object", obj]);
        if (!this.objects.delete(obj)) throw not_found();
        for (const key of [...this.configs.keys()])
            if (key.endsWith(`/${obj}`)) this.configs.delete(key);
    }
    async class_remove_member (klass, obj) {
        if (!this.objects.has(obj)) throw not_found();
        this.members.get(klass)?.delete(obj);
    }
}

class FakeAuth {
    constructor () {
        this.identities = new Map();
        this.grants = new Map();
    }
    async get_identity (uuid, kind) {
        const id = this.identities.get(`${uuid}/${kind}`);
        if (!id) throw not_found();
        return id;
    }
    async delete_identity (uuid, kind) {
        return this.identities.delete(`${uuid}/${kind}`);
    }
    async find_grants (pattern) {
        return [...this.grants]
            .filter(([, g]) => Object.entries(pattern).every(([k, v]) => g[k] == v))
            .map(([uuid]) => uuid);
    }
    async delete_grant (uuid) { this.grants.delete(uuid); }
}

class FakeCheckout {
    constructor (files) { this.files = files; this.pushed = null; }
    async read_file (...p) { return this.files.get(p.join("/")); }
    async unlink_file (...p) { this.files.delete(p.join("/")); }
    async push (msg, ...args) { this.pushed = [msg, ...args]; }
    async dispose () {}
}

/* A node with two connections, one with a device, and a device made
 * on the node before any connection. Krbkeys removes the account when
 * the deployment goes, unless `offline`. */
function world ({ offline = false } = {}) {
    const cdb = new FakeConfigDB();
    const auth = new FakeAuth();

    cdb.put(App.Registration, NODE, { class: Class.EdgeAgent });
    cdb.put(App.Info, NODE, { name: "Signals" });
    cdb.put(App.EdgeAgentDeployment, NODE, { cluster: CLUSTER, chart: CHART, name: "Signals" });
    cdb.put(App.EdgeAgentConfig, NODE, { deviceConnections: [] });
    cdb.put(App.SparkplugAddress, NODE, { group_id: "Testing", node_id: "Signals" });
    cdb.put(App.HelmChartTemplate, CHART, { values: { authGroup: { edgeAgent: ROLE } } });
    cdb.put(Edge.App.Cluster, CLUSTER, { namespace: "fplus-edge", name: "Testing" });
    cdb.members.set(ROLE, new Set([NODE]));

    for (const [c, name] of [["conn-1", "PLC"], ["conn-2", "Meter"]]) {
        cdb.put(App.ConnectionConfiguration, c, { edgeAgent: NODE });
        cdb.put(App.Info, c, { name });
    }
    cdb.put(App.DeviceInformation, "dev-1", { node: NODE, connection: "conn-1" });
    cdb.put(App.DeviceInformation, "dev-2", { node: NODE, connection: null });
    cdb.put(App.ConnectionConfiguration, "conn-other", { edgeAgent: "node-other" });

    auth.identities.set(`${NODE}/kerberos`, "nd1/Testing/Signals@REALM");
    auth.grants.set("g-rebirth", { principal: "admin", target: NODE });
    auth.grants.set("g-own", { principal: NODE, target: "x" });
    auth.grants.set("g-other", { principal: "admin", target: "node-other" });

    const files = new Map([[`edo/secrets/fplus-edge/${secret_name(NODE)}.yaml`, "sealed"]]);
    const checkout = new FakeCheckout(files);

    /* krbkeys: once the deployment has gone, remove the account. */
    const real_delete = cdb.delete_config.bind(cdb);
    cdb.delete_config = async (app, obj) => {
        await real_delete(app, obj);
        if (!offline && app == App.EdgeAgentDeployment) {
            auth.identities.delete(`${obj}/kerberos`);
            cdb.members.get(ROLE).delete(obj);
            cdb.configs.delete(cdb.key(App.SparkplugAddress, obj));
        }
    };

    const fplus = { debug, ConfigDB: cdb, Auth: auth };
    const nd = new NodeDelete({ fplus, wait: 30, poll: 5, clone: async () => checkout });
    return { cdb, auth, checkout, nd };
}

describe("planning a node delete", () => {
    test("lists the node's connections and every device on it", async () => {
        const { nd } = world();
        const plan = await nd.plan(CLUSTER, NODE);
        assert.equal(plan.name, "Signals");
        assert.deepEqual(plan.connections.map(c => c.name).sort(), ["Meter", "PLC"]);
        assert.deepEqual(plan.devices.map(d => d.uuid).sort(), ["dev-1", "dev-2"]);
    });

    test("refuses a node on another cluster, and something that is not a node", async () => {
        const { nd } = world();
        assert.equal(await nd.plan("cluster-other", NODE), false);
        assert.equal(await nd.plan(CLUSTER, "conn-1"), null);
    });
});

describe("deleting a node", () => {
    test("removes everything once the cluster has removed the agent", async () => {
        const { cdb, auth, checkout, nd } = world();
        await nd.run(await nd.plan(CLUSTER, NODE));

        for (const obj of [NODE, "conn-1", "conn-2", "dev-1", "dev-2"])
            assert.ok(!cdb.objects.has(obj), `${obj} is gone`);
        assert.ok(cdb.objects.has("conn-other"));
        assert.ok(![...cdb.configs.keys()].some(k => k.endsWith(`/${NODE}`)));
        assert.deepEqual([...auth.grants.keys()], ["g-other"]);
        assert.equal(checkout.files.size, 0);
        assert.match(checkout.pushed[0], /deleted node/);

        /* The deployment goes first, and the node object last. */
        const first = cdb.calls.findIndex(c => c[0] == "delete_config" && c[1] == App.EdgeAgentDeployment);
        const last = cdb.calls.findIndex(c => c[0] == "delete_object" && c[1] == NODE);
        assert.equal(first, 0);
        assert.equal(last, cdb.calls.length - 1);
    });

    test("removes the agent's account itself when the cluster is offline", async () => {
        const { cdb, auth, nd } = world({ offline: true });
        await nd.run(await nd.plan(CLUSTER, NODE));

        assert.equal(auth.identities.size, 0);
        assert.equal(cdb.members.get(ROLE).size, 0);
        assert.ok(!cdb.objects.has(NODE));
    });

    test("can be run again after stopping part way", async () => {
        const { cdb, nd } = world();
        const plan = await nd.plan(CLUSTER, NODE);
        await cdb.delete_config(App.EdgeAgentDeployment, NODE);
        await cdb.delete_object("dev-1");

        const again = await nd.plan(CLUSTER, NODE);
        assert.ok(again, "a node whose deployment has gone can still be deleted");
        await nd.run(again);
        assert.ok(!cdb.objects.has(NODE));
        assert.deepEqual(plan.devices.length, 2);
    });

    test("leaves the repo alone when the node has no secrets", async () => {
        const { checkout, nd } = world();
        checkout.files.clear();
        await nd.run(await nd.plan(CLUSTER, NODE));
        assert.equal(checkout.pushed, null);
    });
});

/* Run a node route with a client holding the given permissions. */
async function route (method, perms, plan) {
    const fplus = {
        debug,
        Auth: {
            check_acl: async (principal, perm, target, wild) => {
                assert.equal(target, CLUSTER);
                assert.equal(wild, true);
                return perms.includes(perm);
            },
        },
    };
    const started = [];
    const node_delete = {
        plan: async () => plan,
        start: (p, who) => started.push([p, who]),
    };
    const ed = new EdgeDeploy({ fplus, node_delete });

    let status, body;
    const res = {
        status (s) { status = s; return this; },
        end () {},
        json (b) { body = b; },
    };
    await ed[method]({ auth: "admin@REALM", params: { cluster: CLUSTER, node: NODE } }, res);
    return { status, body, started };
}

describe("node routes", () => {
    const plan = { node: NODE, name: "Signals", cluster: CLUSTER,
        deployment: { chart: CHART }, connections: [], devices: [] };

    test("only Manage clusters may delete a node", async () => {
        const no = await route("delete_node", [], plan);
        assert.equal(no.status, 403);
        assert.equal(no.started.length, 0);

        const yes = await route("delete_node", [Edge.Perm.Clusters], plan);
        assert.equal(yes.status, 202);
        assert.deepEqual(yes.started[0][1], "admin@REALM");
    });

    test("the plan says whether the caller may delete, and hides the deployment", async () => {
        const no = await route("node_delete_plan", [], plan);
        assert.deepEqual(no.body, { allowed: false });

        const yes = await route("node_delete_plan", [Edge.Perm.Clusters], plan);
        assert.equal(yes.body.allowed, true);
        assert.equal(yes.body.name, "Signals");
        assert.equal(yes.body.deployment, undefined);
    });

    test("a node on another cluster, or not a node, is refused", async () => {
        assert.equal((await route("delete_node", [Edge.Perm.Clusters], false)).status, 409);
        assert.equal((await route("delete_node", [Edge.Perm.Clusters], null)).status, 404);
    });
});
