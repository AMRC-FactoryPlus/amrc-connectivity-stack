/*
 * ACS Cluster Manager
 * Tests for deleting an edge cluster
 * Copyright 2026 University of Sheffield AMRC
 *
 * The ConfigDB, Auth, Directory, Git service, KDC and the cluster
 * operator are replaced by fakes. The fake operator does what its
 * Delete action does when a cluster's config goes.
 */

import assert           from "node:assert/strict";
import { describe, test } from "node:test";

import { UUIDs, ServiceError } from "@amrc-factoryplus/service-client";

import { ClusterDelete }    from "../lib/cluster-delete.js";
import { EdgeDeploy }       from "../lib/edge-deploy.js";
import { Edge, Git }        from "../lib/uuids.js";

const { App, Class } = UUIDs;
const debug = { bound: () => () => {} };

const CLUSTER = "cluster-1";
const NAME = "Testing";
const REALM = "REALM";
const NODE = "node-1";
const BRIDGE = "bridge-1";
const FLUX = "acc-flux";
const KRBKEYS = "acc-krbkeys";
const SYNC = "acc-sync";
const MONITOR = "acc-monitor";

const not_found = () => new ServiceError("x", "not found", 404);

class FakeConfigDB {
    constructor () {
        this.configs = new Map();
        this.objects = new Set();
        this.calls = [];
    }
    key (app, obj) { return `${app}/${obj}`; }
    put (app, obj, json) {
        this.objects.add(obj);
        this.configs.set(this.key(app, obj), json);
    }
    has (app, obj) { return this.configs.has(this.key(app, obj)); }
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
    async class_remove_member () {}
}

class FakeAuth {
    constructor () {
        this.identities = new Map();
        this.grants = new Map();
    }
    async resolve_identity (kind, name) {
        for (const [key, id] of this.identities)
            if (id == name && key.endsWith(`/${kind}`)) return key.split("/")[0];
        return null;
    }
    async get_identity (uuid, kind) {
        const id = this.identities.get(`${uuid}/${kind}`);
        if (!id) throw not_found();
        return id;
    }
    async delete_identity (uuid, kind) {
        if (!this.identities.delete(`${uuid}/${kind}`)) throw not_found();
    }
    async find_grants (pattern) {
        return [...this.grants]
            .filter(([, g]) => Object.entries(pattern).every(([k, v]) => g[k] == v))
            .map(([uuid]) => uuid);
    }
    async delete_grant (uuid) { this.grants.delete(uuid); }
}

/* A cluster that was set up, with one node, one other deployment and
 * all four accounts. `online` lists the Sparkplug nodes the Directory
 * reports as online. */
function world ({ online = [], operator = true } = {}) {
    const cdb = new FakeConfigDB();
    const auth = new FakeAuth();

    cdb.put(App.Registration, CLUSTER, { class: Edge.Class.Cluster });
    cdb.put(App.Info, CLUSTER, { name: NAME });
    cdb.put(Edge.App.Cluster, CLUSTER, { name: NAME, namespace: "fplus-edge" });
    cdb.put(Edge.App.EdgeStatus, CLUSTER, { hosts: [{ hostname: "gw1" }] });
    cdb.put(App.SparkplugAddress, CLUSTER, { group_id: `ORG-${NAME}` });
    cdb.put(Git.App.Config, CLUSTER, { path: `edge/${NAME}` });

    cdb.put(App.Registration, NODE, { class: Class.EdgeAgent });
    cdb.put(App.Info, NODE, { name: "Signals" });
    cdb.put(App.EdgeAgentDeployment, NODE, { cluster: CLUSTER, name: "Signals" });
    cdb.put(App.Registration, BRIDGE, { class: "class-bridge" });
    cdb.put(App.Info, BRIDGE, { name: "Bridge" });
    cdb.put(App.EdgeAgentDeployment, BRIDGE, { cluster: CLUSTER });
    cdb.put(App.EdgeAgentDeployment, "node-other", { cluster: "cluster-other" });

    for (const [uuid, acc] of [[FLUX, "flux"], [KRBKEYS, "krbkeys"],
            [SYNC, "sync"], [MONITOR, "monitor"]]) {
        cdb.put(App.Info, uuid, { name: `Edge ${acc}: ${NAME}` });
        auth.identities.set(`${uuid}/kerberos`, `op1${acc}/${NAME}@${REALM}`);
    }
    cdb.put(App.SparkplugAddress, MONITOR, { group_id: `ORG-${NAME}`, node_id: "Monitor" });
    auth.identities.set(`${NODE}/kerberos`, `nd1/${NAME}/Signals@${REALM}`);

    auth.grants.set("g-flux-pull", { principal: FLUX, target: CLUSTER });
    auth.grants.set("g-secrets", { principal: "admin", target: CLUSTER });
    auth.grants.set("g-bridge", { principal: "admin", target: BRIDGE });
    auth.grants.set("g-other", { principal: "admin", target: "cluster-other" });

    /* The cluster operator's status, and what its Delete action does
     * when the config goes. */
    let status = { spec: { name: NAME }, ready: true,
        flux: { uuid: FLUX, done: true }, krbkeys: { uuid: KRBKEYS, done: true } };
    const clusters = {
        cluster_status: async uuid => uuid == CLUSTER ? status : {},
    };
    const real_delete = cdb.delete_config.bind(cdb);
    cdb.delete_config = async (app, obj) => {
        await real_delete(app, obj);
        if (operator && app == Edge.App.Cluster && obj == CLUSTER) {
            setTimeout(() => {
                for (const acc of [FLUX, KRBKEYS])
                    auth.identities.delete(`${acc}/kerberos`);
                auth.grants.delete("g-flux-pull");
                cdb.configs.delete(cdb.key(Git.App.Config, CLUSTER));
                cdb.configs.delete(cdb.key(App.SparkplugAddress, CLUSTER));
                status = {};
            }, 5);
        }
    };

    const Directory = {
        get_device_info: async uuid => ({ uuid, online: online.includes(uuid) }),
    };
    const repos = new Set([CLUSTER]);
    const Git_ = {
        fetch: async ({ method, url }) => {
            assert.equal(method, "DELETE");
            repos.delete(url.split("/").at(-1));
            return [204];
        },
    };
    const kdc = { revoked: [], deleted: [] };
    const enrolment = {
        revoke: async name => { kdc.revoked.push(name); },
        delete_cluster_principals: async name => { kdc.deleted.push(name); },
    };

    const fplus = { debug, ConfigDB: cdb, Auth: auth, Directory, Git: Git_ };
    const cd = new ClusterDelete({
        fplus, clusters, enrolment, realm: REALM, wait: 200, poll: 5,
    });
    return { cdb, auth, repos, kdc, cd };
}

describe("planning a cluster delete", () => {
    test("lists the nodes and other deployments on the cluster", async () => {
        const { cd } = world();
        const plan = await cd.plan(CLUSTER);
        assert.equal(plan.name, NAME);
        assert.deepEqual(plan.nodes, [{ uuid: NODE, name: "Signals" }]);
        assert.deepEqual(plan.deployments, [{ uuid: BRIDGE, name: "Bridge" }]);
        assert.deepEqual(plan.online, []);
    });

    test("finds all four accounts", async () => {
        const { cd } = world();
        const { accounts } = await cd.plan(CLUSTER);
        assert.deepEqual(accounts,
            { flux: FLUX, krbkeys: KRBKEYS, sync: SYNC, monitor: MONITOR });
    });

    test("says which of the monitor and nodes are online", async () => {
        const { cd } = world({ online: [MONITOR] });
        assert.deepEqual((await cd.plan(CLUSTER)).online, [MONITOR]);
    });

    test("is null for something that is not a cluster", async () => {
        const { cd } = world();
        assert.equal(await cd.plan(NODE), null);
    });
});

describe("deleting a cluster", () => {
    test("removes everything the cluster is made of", async () => {
        const { cdb, auth, repos, kdc, cd } = world();
        await cd.run(await cd.plan(CLUSTER));

        for (const obj of [CLUSTER, NODE, BRIDGE, FLUX, KRBKEYS, SYNC, MONITOR])
            assert.ok(!cdb.objects.has(obj), `${obj} is gone`);
        assert.ok(cdb.has(App.EdgeAgentDeployment, "node-other"));
        assert.equal(auth.identities.size, 0);
        assert.deepEqual([...auth.grants.keys()], ["g-other"]);
        assert.equal(repos.size, 0);
        assert.deepEqual(kdc.revoked, [NAME]);
        assert.deepEqual(kdc.deleted, [NAME]);
    });

    test("deletes the nodes before the config, and the cluster last", async () => {
        const { cdb, cd } = world();
        await cd.run(await cd.plan(CLUSTER));

        const at = (...call) => cdb.calls.findIndex(c =>
            c.every((v, i) => v == call[i]));
        assert.ok(at("delete_object", NODE) < at("delete_config", Edge.App.Cluster, CLUSTER));
        assert.equal(at("delete_object", CLUSTER), cdb.calls.length - 1);
    });

    test("can be run again after stopping part way", async () => {
        const { cdb, repos, cd } = world();
        /* Stop at the repo, after the config has gone. */
        const git = cd.fplus.Git.fetch;
        cd.fplus.Git.fetch = async () => { throw new Error("Git is down"); };
        await assert.rejects(cd.run(await cd.plan(CLUSTER)), /Git is down/);
        assert.ok(cdb.objects.has(CLUSTER));
        cd.fplus.Git.fetch = git;

        const again = await cd.plan(CLUSTER);
        assert.ok(again, "a cluster whose config has gone can still be deleted");
        assert.equal(again.principal_name, null, "the name is not guessed from Info");
        await cd.run(again);
        for (const obj of [CLUSTER, FLUX, KRBKEYS, SYNC, MONITOR])
            assert.ok(!cdb.objects.has(obj), `${obj} is gone`);
        assert.equal(repos.size, 0);
    });

    test("stops if the cluster operator does not take the cluster apart", async () => {
        const { cdb, cd } = world({ operator: false });
        await assert.rejects(cd.run(await cd.plan(CLUSTER)), /has not removed/);
        assert.ok(cdb.objects.has(CLUSTER), "the cluster object is kept for a retry");
    });
});

/* Run a cluster route with a client holding the given permissions. */
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
    const cluster_delete = {
        plan: async () => plan,
        start: (p, who) => started.push([p, who]),
    };
    const ed = new EdgeDeploy({ fplus, cluster_delete });

    let status, body;
    const res = {
        status (s) { status = s; return this; },
        end () {},
        json (b) { body = b; },
    };
    await ed[method]({ auth: "admin@REALM", params: { cluster: CLUSTER } }, res);
    return { status, body, started };
}

describe("cluster routes", () => {
    const plan = { cluster: CLUSTER, name: NAME, principal_name: NAME,
        online: [], nodes: [], deployments: [], accounts: { flux: FLUX } };

    test("only Delete clusters may delete a cluster", async () => {
        const no = await route("delete_cluster", [Edge.Perm.Clusters], plan);
        assert.equal(no.status, 403);
        assert.equal(no.started.length, 0);

        const yes = await route("delete_cluster", [Edge.Perm.DeleteClusters], plan);
        assert.equal(yes.status, 202);
        assert.equal(yes.started[0][1], "admin@REALM");
    });

    test("refuses a cluster that is still online", async () => {
        const res = await route("delete_cluster", [Edge.Perm.DeleteClusters],
            { ...plan, online: [MONITOR] });
        assert.equal(res.status, 409);
        assert.deepEqual(res.body, { online: [MONITOR] });
        assert.equal(res.started.length, 0);
    });

    test("the plan says whether the caller may delete, and hides the accounts", async () => {
        const no = await route("cluster_delete_plan", [Edge.Perm.Clusters], plan);
        assert.deepEqual(no.body, { allowed: false });

        const yes = await route("cluster_delete_plan", [Edge.Perm.DeleteClusters], plan);
        assert.equal(yes.body.allowed, true);
        assert.equal(yes.body.name, NAME);
        assert.ok(!("accounts" in yes.body));
        assert.ok(!("principal_name" in yes.body));
    });

    test("404 for something that is not a cluster", async () => {
        const res = await route("delete_cluster", [Edge.Perm.DeleteClusters], null);
        assert.equal(res.status, 404);
    });
});
