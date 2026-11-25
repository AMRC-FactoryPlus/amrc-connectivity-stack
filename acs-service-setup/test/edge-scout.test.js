/*
 * ACS service setup
 * Tests for the Edge Scout dumps, grants and fixups
 * Copyright 2026 University of Sheffield
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { EdgeScoutFixup } from "../lib/edge-scout.js";
import * as ss_UUIDs from "../lib/uuids.js";

const { ACS, ConfigDB, CmdEsc, Edge, Files, MetaDB } = ss_UUIDs;

const DUMPS = new URL("../dumps/", import.meta.url);
const STATUS_SCHEMA = new URL(
    "../../lib/edge-scout-schemas/schemas/status.schema.json", import.meta.url);
const VALUES_SCHEMA = new URL(
    "../../lib/edge-scout-schemas/schemas/values.schema.json", import.meta.url);

/* The UUIDs the design fixed, by constant name. */
const New = {
    "Edge.App.ScoutStatus":     "ad73fae4-a3b9-457a-8c36-12a2019bff2c",
    "Edge.App.ScoutValues":     "399a86cf-9bc6-4681-b568-b45fc650dacb",
    "Edge.Class.ScoutResult":   "10916e96-f6fe-44cc-8c01-16a775426038",
    "Edge.Perm.Scout":          "41443382-ecad-439b-999f-cb611bc11f7c",
    "Files.Perm.Delete":        "82a2206b-b9d8-4eee-bc0e-63fb8785019e",
};

/* bin/check-yaml.js lints the dumps with these values. */
const ACS_CONFIG = {
    organisation:   "ORG",
    namespace:      "factory-plus",
    secure:         "s",
    domain:         "my.domain",
    k8sdomain:      "cluster.local",
    directory:      "https://directory.my.domain",
    realm:          "MY.DOMAIN",
};

function loader () {
    return new DumpLoader({
        dumps: [fileURLToPath(DUMPS)], acs_config: ACS_CONFIG,
        local: s => s, log: () => {},
    });
}

/* Every dump file, parsed, by file name. `Local` UUIDs resolve to
 * their own names. */
function all_dumps () {
    const l = loader();
    return new Map(fs.readdirSync(DUMPS)
        .filter(f => f.endsWith(".yaml"))
        .map(f => [f, l.parse_yaml(fs.readFileSync(new URL(f, DUMPS), "utf8"), f)]));
}

const dumps = all_dumps();
const docs = (file, service) => dumps.get(file).filter(d => d.service == service);
const cdb_docs = file => docs(file, UUIDs.Service.ConfigDB);
const auth_docs = file => docs(file, UUIDs.Service.Authentication);

function objects_of (file, klass) {
    return Object.assign({}, ...cdb_docs(file).map(d => d.objects?.[klass] ?? {}));
}
function configs_of (file, app) {
    return Object.assign({}, ...cdb_docs(file).map(d => d.configs?.[app] ?? {}));
}

function flat_values (obj) {
    return Object.values(obj).flatMap(v =>
        typeof v == "object" ? flat_values(v) : [v]);
}

describe("Edge Scout UUIDs", () => {
    test("each has the value the design fixed", () => {
        const l = loader();
        for (const [name, uuid] of Object.entries(New))
            assert.equal(l.resolveUUID(name), uuid, name);
    });

    test("none is used for anything else in service-setup or service-client", () => {
        const values = [
            ...flat_values(ss_UUIDs),
            ...flat_values(UUIDs),
        ];
        for (const [name, uuid] of Object.entries(New)) {
            /* service-client gains three of them from the library step,
             * under the same names, so count service-setup only. */
            const here = flat_values(ss_UUIDs).filter(v => v == uuid).length;
            assert.equal(here, 1, `${name} appears ${here} times in uuids.js`);
            const elsewhere = flat_values(UUIDs).filter(v => v == uuid).length;
            assert.ok(elsewhere <= 1, `${name} appears ${elsewhere} times in service-client`);
        }
        assert.ok(values.length > 100);
    });
});

describe("Edge Scout dumps", () => {
    test("the status app is a config entry app", () => {
        const app = objects_of("edge.yaml", UUIDs.Class.App)[Edge.App.ScoutStatus];
        assert.equal(app?.name, "Edge scout status");
        assert.deepEqual(app.subclassOf, [MetaDB.Class.ConfigEntry]);
    });

    test("the values app is a config entry app", () => {
        const app = objects_of("edge.yaml", UUIDs.Class.App)[Edge.App.ScoutValues];
        assert.equal(app?.name, "Edge scout values");
        assert.deepEqual(app.subclassOf, [MetaDB.Class.ConfigEntry]);
    });

    test("the result class is an R1 class of Files", () => {
        const klass = objects_of("edge.yaml", ConfigDB.Class.R1Class)[Edge.Class.ScoutResult];
        assert.equal(klass?.name, "Edge scout result");
        assert.deepEqual(klass.subclassOf, [Files.Class.File]);
        assert.deepEqual(klass.memberOf, [Files.Class.FileGroup]);
    });

    test("the Scout permission is in the CmdEsc permission group", () => {
        const perms = objects_of("edge.yaml", ACS.PermGroup.CmdEsc);
        assert.equal(perms[Edge.Perm.Scout]?.name, "Scan device addresses");
    });

    test("the Scout command is defined for cmdesc", () => {
        const defs = configs_of("edge.yaml", CmdEsc.App.CmdDef);
        assert.deepEqual(defs[Edge.Perm.Scout],
            [{ name: "Node Control/Scout", type: "String" }]);
    });

    test("Delete is a Files permission", () => {
        const perms = objects_of("files.yaml", Files.Perm.All);
        assert.equal(perms[Files.Perm.Delete]?.name, "Delete");
    });

    test("edge.yaml loads after the dumps it refers to", async () => {
        const order = (await loader().sort_files(false)).map(f => f.name);
        const at = n => order.indexOf(n);
        for (const before of ["acs-v2.yaml", "files.yaml", "auth.yaml"])
            assert.ok(at(before) >= 0 && at(before) < at("edge.yaml"),
                `${before} must load before edge.yaml`);
        assert.ok(at("edge.yaml") < at("helm.yaml"));
    });

    test("the status ConfigSchema is a copy of lib/edge-scout-schemas", () => {
        const schema = configs_of("edge.yaml", UUIDs.App.ConfigSchema)[Edge.App.ScoutStatus];
        const file = JSON.parse(fs.readFileSync(STATUS_SCHEMA, "utf8"));
        assert.deepEqual(schema, file,
            "dumps/edge.yaml is out of date: copy status.schema.json into it");
    });

    test("the values ConfigSchema is a copy of lib/edge-scout-schemas", () => {
        const schema = configs_of("edge.yaml", UUIDs.App.ConfigSchema)[Edge.App.ScoutValues];
        const file = JSON.parse(fs.readFileSync(VALUES_SCHEMA, "utf8"));
        assert.deepEqual(schema, file,
            "dumps/edge.yaml is out of date: copy values.schema.json into it");
    });

    test("only edge.yaml sets the status and values ConfigSchemas", () => {
        for (const file of dumps.keys()) {
            if (file == "edge.yaml") continue;
            const s = configs_of(file, UUIDs.App.ConfigSchema);
            assert.equal(s[Edge.App.ScoutStatus], undefined, file);
            assert.equal(s[Edge.App.ScoutValues], undefined, file);
        }
    });
});

describe("Edge Scout DriverDefs", () => {
    const defs = {
        ...configs_of("edge.yaml", Edge.App.DriverDef),
        ...configs_of("edge-sim.yaml", Edge.App.DriverDef),
        ...configs_of("edge-ftp.yaml", Edge.App.DriverDef),
    };
    const Forms = ["opcua", "mqtt", "exact"];

    test("the scanning drivers have a scout key with their address form", () => {
        const want = {
            [ACS.Driver.OPCUASplit]:    "opcua",
            [ACS.Driver.MQTTSplit]:     "mqtt",
            [ACS.Driver.Test]:          "exact",
            [ACS.Driver.TestRust]:      "exact",
            [ACS.Driver.Sim]:           "exact",
        };
        for (const [driver, form] of Object.entries(want))
            assert.equal(defs[driver]?.scout?.address_form, form, driver);
    });

    test("every scout key has the documented shape", () => {
        for (const [driver, def] of Object.entries(defs)) {
            if (!("scout" in def)) continue;
            const { scout } = def;
            assert.equal(typeof scout, "object", driver);
            assert.deepEqual(
                Object.keys(scout).filter(k =>
                    !["title", "address_form", "options", "share_samples"].includes(k)),
                [], driver);
            assert.equal(typeof scout.title, "string", driver);
            assert.ok(Forms.includes(scout.address_form ?? "exact"), driver);
            assert.equal(scout.options?.type, "object", driver);
            assert.equal(typeof scout.share_samples, "boolean", driver);
        }
    });

    test("the OPC UA options include include_server, off by default", () => {
        const opts = defs[ACS.Driver.OPCUASplit].scout.options.properties;
        assert.equal(opts.include_server.default, false);
        assert.equal(opts.root.type, "string");
    });

    test("the MQTT options follow the driver's defaults and caps", () => {
        const opts = defs[ACS.Driver.MQTTSplit].scout.options.properties;
        assert.deepEqual(opts.filters.default, ["#"]);
        assert.equal(opts.seconds.default, 10);
        assert.equal(opts.seconds.maximum, 120);
        assert.equal(opts.inspect_bytes.default, 65536);
        assert.equal(opts.json_leaves.default, true);
    });

    test("no driver hides the panel, and the rest trust the hello", () => {
        for (const [driver, def] of Object.entries(defs))
            assert.notEqual(def.scout, false, driver);
        assert.equal(defs[ACS.Driver.External].scout, undefined);
        assert.equal(defs[ACS.Driver.Modbus].scout, undefined);
    });
});

describe("Edge Scout grants", () => {
    const Agent = "Local.Role.EdgeAgent";

    test("only helm.yaml grants to the Edge Agent role", () => {
        const granting = [...dumps.keys()].filter(f =>
            auth_docs(f).some(d => d.grants && Agent in d.grants));
        assert.deepEqual(granting, ["helm.yaml"]);
    });

    test("the Edge Agent holds what the design lists", () => {
        const grants = Object.assign({}, ...auth_docs("helm.yaml")
            .map(d => d.grants?.[Agent] ?? {}));
        const Perm = ConfigDB.Perm;
        const Mine = UUIDs.Special.Mine;
        const want = [
            [Perm.ReadConfig,           Edge.App.ScoutStatus,       false],
            [Perm.WriteConfig,          Edge.App.ScoutStatus,       false],
            [Perm.ReadConfig,           Edge.App.ScoutValues,       false],
            [Perm.WriteConfig,          Edge.App.ScoutValues,       false],
            [Perm.CreateSpecificObject, Edge.Class.ScoutResult,     false],
            [Perm.DeleteObject,         Mine,                       true],
            [Files.Perm.Upload,         Mine,                       true],
            [Files.Perm.Download,       Mine,                       true],
            [Files.Perm.Delete,         Mine,                       true],
        ];
        for (const [perm, target, wild] of want)
            assert.equal(grants[perm]?.[target], wild, `${perm} on ${target}`);
        /* The existing delivery grant is still there. */
        assert.equal(grants[Files.Perm.Download][Edge.Class.DeliveryFile], true);
    });

    /* A grant on the wildcard or on the whole class would let one
     * agent fill an empty File object of any kind, or delete another
     * connection's snapshot and upload its own in its place. */
    test("the Edge Agent's file and object grants cover only what it owns", () => {
        const grants = Object.assign({}, ...auth_docs("helm.yaml")
            .map(d => d.grants?.[Agent] ?? {}));
        const Perm = ConfigDB.Perm;
        for (const perm of [Files.Perm.Upload, Files.Perm.Download,
            Files.Perm.Delete, Perm.DeleteObject]
        ) {
            const targets = Object.keys(grants[perm] ?? {});
            assert.ok(!targets.includes(ConfigDB.Special.Null), `${perm} on the wildcard`);
            assert.ok(!targets.includes(Edge.Class.ScoutResult), `${perm} on the class`);
        }
        /* ConfigDB checks CreateObject only when it picks the UUID,
         * and the agent picks it. */
        assert.equal(grants[Perm.CreateObject]?.[Edge.Class.ScoutResult], undefined);
    });

    test("administrators can scan and read results with their existing grants", () => {
        const grants = Object.assign({}, ...auth_docs("admin.yaml")
            .map(d => d.grants?.[ACS.Group.Administrator] ?? {}));
        assert.ok(ACS.PermGroup.CmdEsc in grants);
        assert.ok(Files.Perm.All in grants);
        assert.ok(ACS.PermGroup.ConfigDB in grants);
    });
});

/* An in-memory ConfigDB and Files service with the calls the fixup
 * makes. `calls` records every write and delete, in order. */
class FakeSite {
    constructor () {
        this.configs = new Map();
        this.versions = new Map();
        this.members = new Map();
        this.calls = [];
        this.stale = [];
        this.fail = new Map();
        this.files_status = 204;
    }

    app (a) {
        if (!this.configs.has(a)) this.configs.set(a, new Map());
        return this.configs.get(a);
    }
    set (a, o, c) {
        this.app(a).set(o, structuredClone(c));
        const k = `${a}/${o}`;
        this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
    }
    failing (what) {
        const st = this.fail.get(what);
        if (st) throw new ServiceError(UUIDs.Service.ConfigDB, what, st);
    }

    get fplus () {
        const site = this;
        return {
            ConfigDB: {
                async get_all_configs (a) {
                    site.failing(`all ${a}`);
                    if (!site.configs.has(a))
                        throw new ServiceError(UUIDs.Service.ConfigDB, "No app", 404);
                    return new Map(structuredClone([...site.app(a)]));
                },
                async get_config (a, o) {
                    site.failing(`get ${a}`);
                    return structuredClone(site.app(a).get(o));
                },
                async get_config_with_etag (a, o) {
                    if (!site.app(a).has(o)) return [];
                    return [structuredClone(site.app(a).get(o)),
                        String(site.versions.get(`${a}/${o}`))];
                },
                async put_config (a, o, c, opts) {
                    const i = site.stale.findIndex(([sa, so]) => sa == a && so == o);
                    if (i >= 0) {
                        site.stale.splice(i, 1);
                        site.set(a, o, site.app(a).get(o));
                    }
                    if (opts?.etag && opts.etag != String(site.versions.get(`${a}/${o}`)))
                        throw new ServiceError(UUIDs.Service.ConfigDB, "Stale", 412);
                    site.calls.push(["put", a, o]);
                    site.set(a, o, c);
                },
                async class_members (k) {
                    site.failing(`members ${k}`);
                    if (!site.members.has(k))
                        throw new ServiceError(UUIDs.Service.ConfigDB, "No class", 404);
                    return [...site.members.get(k)];
                },
                async delete_object (o) {
                    site.calls.push(["delete_object", o]);
                    for (const m of site.members.values()) m.delete(o);
                    for (const a of site.configs.values()) a.delete(o);
                },
            },
            Fetch: {
                async fetch (req) {
                    site.calls.push(["files", req.method, req.service, req.url]);
                    return { status: site.files_status };
                },
            },
            debug: { bound: () => () => {} },
        };
    }

    fixup (now) {
        return new EdgeScoutFixup({
            fplus: this.fplus, log: () => {}, now: () => now,
        });
    }
}

const NOW = Date.parse("2026-11-24T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();

const CONN_A = "cccccccc-0000-4000-8000-00000000000a";
const CONN_B = "cccccccc-0000-4000-8000-00000000000b";
const CONN_C = "cccccccc-0000-4000-8000-00000000000c";
const NODE = "eeeeeeee-0000-4000-8000-000000000001";
const F = n => `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("stripping the old scout key", () => {
    const AGENT = "aaaaaaaa-0000-4000-8000-000000000001";
    const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
    const App = UUIDs.App.EdgeAgentConfig;

    function site () {
        const s = new FakeSite();
        s.set(App, AGENT, {
            sparkplug: { nodeId: "Node1" },
            deviceConnections: [
                { name: "PLC", uuid: CONN_A, connType: "Driver",
                    scout: { isEnabled: true, scanInterval: 60 }, devices: [] },
                { name: "Broker", uuid: CONN_B, connType: "Driver", devices: [] },
            ],
        });
        s.set(App, OTHER, {
            deviceConnections: [{ name: "Clean", uuid: CONN_C, devices: [] }],
        });
        s.set(Edge.App.ScoutStatus, CONN_A, { version: 1, node: NODE, supported: true });
        return s;
    }

    test("removes scout from every connection and keeps everything else", async () => {
        const s = site();
        const { stripped } = await s.fixup(NOW).run();
        assert.deepEqual(stripped, [AGENT]);
        assert.deepEqual(s.app(App).get(AGENT), {
            sparkplug: { nodeId: "Node1" },
            deviceConnections: [
                { name: "PLC", uuid: CONN_A, connType: "Driver", devices: [] },
                { name: "Broker", uuid: CONN_B, connType: "Driver", devices: [] },
            ],
        });
    });

    test("writes nothing for a config without the key, or on a second run", async () => {
        const s = site();
        await s.fixup(NOW).run();
        assert.deepEqual(s.calls, [["put", App, AGENT]]);
        s.calls = [];
        const { stripped } = await s.fixup(NOW).run();
        assert.deepEqual(stripped, []);
        assert.deepEqual(s.calls, []);
    });

    test("rebuilds when someone else saves the config first", async () => {
        const s = site();
        s.stale.push([App, AGENT]);
        const { stripped } = await s.fixup(NOW).run();
        assert.deepEqual(stripped, [AGENT]);
        assert.equal("scout" in s.app(App).get(AGENT).deviceConnections[0], false);
    });
});

describe("sweeping orphaned snapshots", () => {
    /* Files 1 and 2 are A's current and previous. File 3 is B's
     * running scan, updated two days ago. File 4 is C's failed scan,
     * updated an hour ago. File 5 was a failed scan two days ago. File
     * 6 is unreferenced and was uploaded an hour ago, file 7 two days
     * ago. File 8 has no status entry and no upload. */
    function site () {
        const s = new FakeSite();
        const old = iso(NOW - 48 * HOUR);
        s.set(Edge.App.ScoutStatus, CONN_A, {
            version: 1, node: NODE, supported: true,
            scan: F(5), state: "failed", code: "TIMEOUT", updated: old,
            current: { file: F(1), items: 10 },
            previous: { file: F(2), items: 9 },
        });
        s.set(Edge.App.ScoutStatus, CONN_B, {
            version: 1, node: NODE, supported: true,
            scan: F(3), state: "running", updated: old,
            current: null, previous: null,
        });
        s.set(Edge.App.ScoutStatus, CONN_C, {
            version: 1, node: NODE, supported: true,
            scan: F(4), state: "failed", updated: iso(NOW - HOUR),
        });
        s.set(Files.App.Config, F(6), { date_uploaded: iso(NOW - HOUR) });
        s.set(Files.App.Config, F(7), { date_uploaded: old });
        s.members.set(Edge.Class.ScoutResult,
            new Set([1, 2, 3, 4, 5, 6, 7, 8].map(F)));
        return s;
    }

    test("deletes only what no entry needs and is more than a day old", async () => {
        const s = site();
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r.kept, [1, 2, 3, 4, 6].map(F));
        assert.deepEqual(r.deleted, [5, 7, 8].map(F));
        assert.deepEqual(r.failed, []);
    });

    test("deletes from Files first, then from the ConfigDB", async () => {
        const s = site();
        await s.fixup(NOW).run();
        const Svc = Files.Service.Files;
        assert.deepEqual(s.calls, [5, 7, 8].map(F).flatMap(f => [
            ["files", "DELETE", Svc, `/v1/file/${f}`],
            ["delete_object", f],
        ]));
    });

    test("keeps an object the Files service will not delete", async () => {
        const s = site();
        s.files_status = 403;
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r.deleted, []);
        assert.deepEqual(r.failed, [5, 7, 8].map(F));
        assert.ok(s.calls.every(c => c[0] != "delete_object"));
    });

    test("keeps an object when Files has no DELETE route yet", async () => {
        const s = site();
        s.files_status = 404;
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r.deleted, []);
    });

    test("deletes nothing when the status entries can't be read", async () => {
        const s = site();
        s.fail.set(`all ${Edge.App.ScoutStatus}`, 503);
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r.deleted, []);
        assert.deepEqual(s.calls, []);
    });

    test("keeps an object whose upload record can't be read", async () => {
        const s = site();
        s.fail.set(`get ${Files.App.Config}`, 503);
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r.deleted, []);
    });

    test("with no status app, sweeps every object more than a day old", async () => {
        const s = site();
        s.configs.delete(Edge.App.ScoutStatus);
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r.kept, [F(6)]);
    });

    test("does nothing on a site without the class", async () => {
        const s = new FakeSite();
        const r = await s.fixup(NOW).run();
        assert.deepEqual(r, { stripped: [], deleted: [], kept: [], failed: [] });
        assert.deepEqual(s.calls, []);
    });

    test("a queued scan's object is kept however old the entry is", async () => {
        const s = site();
        s.set(Edge.App.ScoutStatus, CONN_C, {
            version: 1, node: NODE, supported: true,
            scan: F(8), state: "queued", updated: iso(NOW - 72 * HOUR),
        });
        const r = await s.fixup(NOW).run();
        assert.ok(r.kept.includes(F(8)));
    });
});
