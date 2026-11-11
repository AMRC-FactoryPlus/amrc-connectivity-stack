/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Access control: which devices and ISA-95 levels each caller sees,
 * from device, class and ISA-95 vocabulary grants, and the API answering
 * for hidden objects as for missing ones.
 */

import express from "express";
import request from "supertest";
import * as rx from "rxjs";

import { Access, ALL_GRANTS, NO_GRANTS } from "../lib/access.js";
import { APIv1 } from "../lib/api-v1.js";
import { Isa95Vocabulary } from "../lib/isa95.js";
import type { VocabNode } from "../lib/isa95.js";
import { ObjectTree } from "../lib/object-tree.js";
import { TestObjectTree } from "./helpers/isa95.js";
import { ValueCache } from "../lib/value-cache.js";
import { I3xStore } from "../lib/store.js";
import { SubscriptionManager } from "../lib/subscriptions.js";
import { HIERARCHY_SCHEMA_UUID, NULL_UUID, Perm, RelType } from "../lib/constants.js";

const READ = Perm.ReadObject;
const SCHEMA = "schema-device";

/* Devices: A and B at AMRC / Factory 2050 (Areas North and South),
 * C at Other / Elsewhere, D with no hierarchy at all. */
const DEVICES: Record<string, string[]> = {
    "dev-a": ["AMRC", "Factory 2050", "North"],
    "dev-b": ["AMRC", "factory 2050", "South"],
    "dev-c": ["Other", "Elsewhere"],
    "dev-d": [],
};

function devInfo(uuid: string, chain: string[]) {
    const levels = ["Enterprise", "Site", "Area", "Work Center", "Work Unit"];
    const hier: any = { Schema_UUID: HIERARCHY_SCHEMA_UUID };
    chain.forEach((v, i) => { hier[levels[i]] = { Value: v }; });
    return {
        schema: SCHEMA,
        sparkplugName: uuid,
        originMap: {
            Schema_UUID: SCHEMA,
            Instance_UUID: uuid,
            Device_Information: { Schema_UUID: "info", ...(chain.length ? { ISA95_Hierarchy: hier } : {}) },
            Temp: { Sparkplug_Type: "Double", Instance_UUID: `${uuid}-temp` },
            Axis: {
                Schema_UUID: "schema-axis",
                Instance_UUID: `${uuid}-axis`,
                Pos: { Sparkplug_Type: "Double", Instance_UUID: `${uuid}-pos` },
            },
        },
    };
}

/* Vocabulary: AMRC > Factory 2050 (alias F2050) > North, South;
 * Other > Elsewhere. */
const VOCAB: VocabNode[] = [
    { uuid: "v-amrc", name: "AMRC", aliases: [], children: ["v-f2050"], root: true },
    { uuid: "v-f2050", name: "Factory 2050", aliases: ["F2050"], children: ["v-north", "v-south"], root: false },
    { uuid: "v-north", name: "North", aliases: [], children: [], root: false },
    { uuid: "v-south", name: "South", aliases: [], children: [], root: false },
    { uuid: "v-other", name: "Other", aliases: [], children: ["v-else"], root: true },
    { uuid: "v-else", name: "Elsewhere", aliases: [], children: [], root: false },
];

function makeTree() {
    const store = new I3xStore();
    const tree = new TestObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
    for (const [uuid, chain] of Object.entries(DEVICES))
        tree.addDevice(uuid, devInfo(uuid, chain), { name: uuid });
    tree.setReady();
    return { store, tree };
}

/** A fake Auth service: ACLs by principal, each a live sequence. */
function fakeAuth(acls: Record<string, Array<{ permission: string; target: string }>>) {
    const live = new Map<string, rx.BehaviorSubject<any[]>>();
    const subject = (p: string) => {
        let s = live.get(p);
        if (!s) live.set(p, s = new rx.BehaviorSubject(acls[p] ?? []));
        return s;
    };
    return {
        root_principal: "root@REALM",
        fail: 0,
        decode_principal(p: any): [string | null, string | null] {
            if (typeof p !== "string") return [null, null];
            return [/^[0-9a-f-]{36}$/.test(p) ? "uuid" : "kerberos", p];
        },
        async fetch_auth_acl(this: any, _type: string, p: string) {
            if (this.fail) {
                const err: any = new Error("failed");
                err.status = this.fail;
                throw err;
            }
            return subject(p).value;
        },
        watch_acl(p: any) { return subject(p).asObservable(); },
        set(p: string, acl: any[]) { subject(p).next(acl); },
    };
}

function setup(acls: Record<string, any[]> = {}) {
    const { store, tree } = makeTree();
    const vocabulary = new Isa95Vocabulary();
    vocabulary.set(VOCAB);
    const auth = fakeAuth(acls);
    const access = new Access({ auth, objectTree: tree, vocabulary });
    return { store, tree, vocabulary, auth, access };
}

const grant = (target: string) => ({ permission: READ, target });

/* What a principal sees: the elementIds of every visible object. */
async function seen(s: ReturnType<typeof setup>, principal: string) {
    const visible = s.access.visible(await s.access.grants(principal));
    return new Set(s.tree.getObjects(undefined, visible).map(o => o.elementId));
}

function levelId(s: ReturnType<typeof setup>, ...names: string[]) {
    let parent = "/";
    for (const n of names) {
        parent = s.tree.getObjects().find(o => o.parentId === parent && o.displayName === n)!.elementId;
    }
    return parent;
}

describe("Isa95Vocabulary", () => {
    const v = new Isa95Vocabulary();
    v.set(VOCAB);

    it("resolves a chain one level at a time, ignoring case, by name or alias", () => {
        expect(v.resolve(["AMRC"])).toBe("v-amrc");
        expect(v.resolve(["amrc", "FACTORY 2050"])).toBe("v-f2050");
        expect(v.resolve(["AMRC", "F2050", "north"])).toBe("v-north");
    });

    it("matches only under the node matched above", () => {
        expect(v.resolve(["Factory 2050"])).toBeNull();
        expect(v.resolve(["Other", "North"])).toBeNull();
    });

    it("stops at the first name that does not match", () => {
        expect(v.resolve(["AMRC", "Nowhere", "North"])).toBeNull();
        expect(v.resolve([])).toBeNull();
    });

    /* ConfigDB as it is: ISA95Level's members are the level classes,
     * and the nodes are the members of those. */
    it("follows the nodes in ConfigDB, not the level classes", async () => {
        const LEVEL = "3866b165-6b31-46e3-a801-cb367e04e726";
        const ENTERPRISE = "2980293e-4a82-49a3-b121-9a8fa109d0a8";
        const SITE = "site-class";
        const members: Record<string, string[]> = {
            [LEVEL]: [ENTERPRISE, SITE],
            [ENTERPRISE]: ["v-amrc"],
            [SITE]: ["v-f2050"],
        };
        const names: Record<string, string> = {
            [ENTERPRISE]: "ISA-95 Enterprise", [SITE]: "ISA-95 Site",
            "v-amrc": "AMRC", "v-f2050": "Factory 2050",
        };
        const vocab = new Map<string, any>([
            ["v-amrc", { children: ["v-f2050"] }],
            ["v-f2050", { aliases: ["F2050"], children: [] }],
        ]);
        const cdb = {
            watch_members: (k: string) => rx.of(members[k] ?? []),
            watch_member_members: (k: string) => rx.of(new Map(
                (members[k] ?? []).map(m => [m, members[m] ?? []]))),
            search_app: () => rx.of(vocab),
            watch_config: (_app: string, u: string) => rx.of({ name: names[u] }),
        };
        const fed = new Isa95Vocabulary();
        fed.run({ ConfigDB: cdb });
        await new Promise(r => setTimeout(r, 200));
        expect(fed.resolve(["AMRC", "F2050"])).toBe("v-f2050");
        expect(fed.resolve(["ISA-95 Enterprise"])).toBeNull();
        fed.stop();
    });
});

describe("Access", () => {
    it("shows nothing to a principal with no grants", async () => {
        const s = setup();
        expect((await seen(s, "nobody@REALM")).size).toBe(0);
    });

    it("shows a granted device, everything below it, and the levels above it", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a")] });
        const ids = await seen(s, "alice@REALM");
        const deviceA = s.tree.getObjects().map(o => o.elementId)
            .filter(id => s.tree.deviceOf(id) === "dev-a");
        expect(deviceA).toEqual(expect.arrayContaining(["dev-a", "dev-a-temp", "dev-a-axis", "dev-a-pos"]));
        expect(ids).toEqual(new Set([
            levelId(s, "AMRC"), levelId(s, "AMRC", "Factory 2050"),
            levelId(s, "AMRC", "Factory 2050", "North"),
            ...deviceA,
        ]));
    });

    it("shows every device under a granted vocabulary node, whatever the case of the names", async () => {
        const s = setup({ "bob@REALM": [grant("v-f2050")] });
        const ids = await seen(s, "bob@REALM");
        expect(ids.has("dev-a")).toBe(true);
        expect(ids.has("dev-b-pos")).toBe(true);
        expect(ids.has("dev-c")).toBe(false);
        expect(ids.has(levelId(s, "AMRC"))).toBe(true);
        expect(ids.has(levelId(s, "Other"))).toBe(false);
    });

    it("treats a class grant, expanded by the Auth service, as device grants", async () => {
        const s = setup({ "carol@REALM": [grant("dev-b"), grant("dev-c")] });
        const ids = await seen(s, "carol@REALM");
        expect(ids.has("dev-b")).toBe(true);
        expect(ids.has("dev-c-temp")).toBe(true);
        expect(ids.has("dev-a")).toBe(false);
        expect(ids.has(levelId(s, "AMRC", "Factory 2050", "North"))).toBe(false);
    });

    it("ignores node grants for a device whose hierarchy does not match", async () => {
        const s = setup({ "dan@REALM": [grant("v-north")] });
        s.tree.replaceDeviceSubtree("dev-a", devInfo("dev-a", ["AMRC", "Unlisted", "North"]), { name: "dev-a" });
        expect((await seen(s, "dan@REALM")).has("dev-a")).toBe(false);
    });

    it("follows a device moved to another level", async () => {
        const s = setup({ "erin@REALM": [grant("v-else")] });
        expect((await seen(s, "erin@REALM")).has("dev-a")).toBe(false);
        s.tree.replaceDeviceSubtree("dev-a", devInfo("dev-a", ["Other", "Elsewhere"]), { name: "dev-a" });
        expect((await seen(s, "erin@REALM")).has("dev-a")).toBe(true);
    });

    it("follows a change to the vocabulary", async () => {
        const s = setup({ "fay@REALM": [grant("v-south")] });
        expect((await seen(s, "fay@REALM")).has("dev-b")).toBe(true);
        s.vocabulary.set(VOCAB.map(n => n.uuid === "v-south" ? { ...n, name: "Southern" } : n));
        expect((await seen(s, "fay@REALM")).has("dev-b")).toBe(false);
    });

    it("sees everything with the wildcard, and does no filtering", async () => {
        const s = setup({ "admin@REALM": [grant(NULL_UUID)] });
        const g = await s.access.grants("admin@REALM");
        expect(g).toBe(ALL_GRANTS);
        expect(s.access.visible(g)).toBeUndefined();
    });

    it("gives the Kerberos root principal everything, but not a UUID of the same name", async () => {
        const s = setup();
        expect(await s.access.grants("root@REALM")).toBe(ALL_GRANTS);
        expect(await s.access.grants("00000000-0000-0000-0000-00000000000a")).not.toBe(ALL_GRANTS);
    });

    it("ignores other permissions on the same targets", async () => {
        const s = setup({ "gus@REALM": [{ permission: "other-perm", target: "dev-a" }] });
        expect((await seen(s, "gus@REALM")).size).toBe(0);
    });

    it("grants nothing for an ACL the Auth service refuses, and fails for one it cannot give", async () => {
        const s = setup({ "hal@REALM": [grant("dev-a")] });
        s.auth.fail = 404;
        expect(await s.access.grants("hal@REALM")).toBe(NO_GRANTS);
        s.auth.fail = 503;
        await expect(s.access.grants("hal@REALM")).rejects.toMatchObject({ status: 503 });
        expect(await s.access.grants(undefined)).toBe(NO_GRANTS);
    });

    it("fails, rather than waiting for ever, when the Auth service does not answer", async () => {
        /* RxClient waits for the notify interface, which never answers
         * while Auth is down. */
        const s = setup();
        s.auth.fetch_auth_acl = () => new Promise(() => {});
        const access = new Access({
            auth: s.auth, objectTree: s.tree, vocabulary: s.vocabulary, aclTimeoutMs: 20 });
        await expect(access.grants("jo@REALM")).rejects.toMatchObject({ status: 503 });
    });

    it("follows a revoked grant live, for subscriptions", () => {
        const s = setup({ "ivy@REALM": [grant("dev-a")] });
        const viewer = s.access.track("ivy@REALM");
        expect(viewer.visible("dev-a-temp")).toBe(true);
        expect(viewer.visible("dev-b-temp")).toBe(false);
        s.auth.set("ivy@REALM", []);
        expect(viewer.visible("dev-a-temp")).toBe(false);
        viewer.stop();
    });
});

describe("the API, scoped to the caller", () => {
    function app(s: ReturnType<typeof setup>, principal: string) {
        const valueCache = new ValueCache({ objectTree: s.tree, store: s.store, staleThreshold: 60_000 });
        const subscriptions = new SubscriptionManager({ valueCache, viewers: s.access, ttl: 60_000 });
        const api = new APIv1({
            objectTree: s.tree,
            access: s.access,
            valueCache,
            history: {
                getValues: async (ids: string[]) => new Map(ids.map(id => [id, null])),
                getCompositionValue: async () => null,
                getCurrentValue: async () => null,
                streamHistory: async function* () {
                    yield [{ value: 1, quality: "Good", timestamp: "2026-11-03T00:00:00Z" }];
                },
            } as any,
            subscriptions,
        });
        const a = express();
        a.use(express.json());
        a.use((req, _res, next) => { (req as any).auth = principal; next(); });
        a.use("/v1", api.routes);
        return { a, valueCache, subscriptions };
    }

    /* A UNS value for every leaf, filed under its parent. */
    function fill(s: ReturnType<typeof setup>) {
        s.store.prepare(`
            insert into last_value (element_id, anchor, device_uuid, value_json, timestamp, quality, source)
            select element_id, parent_id, device_uuid, '1', '2026-11-03T00:00:00Z', 'Good', 'uns'
            from object where is_composition = 0 and type_element_id != 'isa95-level'
        `).run();
    }

    it("lists only what the caller sees, with an ETag of its own", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a")], "bob@REALM": [grant("v-f2050")] });
        const alice = await request(app(s, "alice@REALM").a).get("/v1/objects");
        const bob = await request(app(s, "bob@REALM").a).get("/v1/objects");
        expect(alice.body.result.map((o: any) => o.elementId)).toContain("dev-a");
        expect(alice.body.result.map((o: any) => o.elementId)).not.toContain("dev-b");
        expect(bob.body.result.map((o: any) => o.elementId)).toContain("dev-b");
        expect(alice.headers.etag).not.toBe(bob.headers.etag);
    });

    it("answers for a hidden object exactly as for a missing one", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a")] });
        const { a } = app(s, "alice@REALM");
        const both = await request(a).post("/v1/objects/list").send({ elementIds: ["dev-b", "no-such"] });
        const [hidden, missing] = both.body.results;
        expect(hidden.responseDetail).toEqual(
            { title: "Not Found", status: 404, detail: "Element not found: dev-b" });
        expect(missing.responseDetail).toEqual(
            { title: "Not Found", status: 404, detail: "Element not found: no-such" });

        for (const path of ["value", "related"]) {
            const res = await request(a).post(`/v1/objects/${path}`).send({ elementIds: ["dev-b", "no-such"] });
            expect(res.body.results.map((r: any) => r.responseDetail.status)).toEqual([404, 404]);
            expect(res.body.results[0].responseDetail.detail).toBe("Element not found: dev-b");
        }

        const list = await request(a).post("/v1/objects/list").send({ elementIds: ["dev-a", "dev-b"] });
        expect(list.body.results.map((r: any) => r.success)).toEqual([true, false]);
        const hist = await request(a).post("/v1/objects/history").send({
            elementIds: ["dev-a-temp", "dev-b-temp"],
            startTime: "2026-11-01T00:00:00Z", endTime: "2026-11-02T00:00:00Z",
        });
        expect(hist.body.results.map((r: any) => r.success)).toEqual([true, false]);
    });

    it("leaves hidden children out of a level's related objects", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a")] });
        const site = levelId(s, "AMRC", "Factory 2050");
        const res = await request(app(s, "alice@REALM").a)
            .post("/v1/objects/related").send({ elementIds: [site], relationshipType: RelType.HasChildren });
        expect(res.body.results[0].result.map((e: any) => [e.sourceRelationship, e.object.displayName]))
            .toEqual([[RelType.HasChildren, "North"]]);
    });

    it("gives a level no value of its own, and hides a hidden device's values", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a")] });
        fill(s);
        const { a } = app(s, "alice@REALM");
        const top = levelId(s, "AMRC");
        const many = await request(a).post("/v1/objects/value")
            .send({ elementIds: [top, "dev-a", "dev-b", "dev-b-temp"], maxDepth: 0 });
        /* A level organises devices: reading it does not read them. */
        expect(many.body.results[0].result).toMatchObject(
            { isComposition: false, value: null, quality: "GoodNoData" });
        expect(many.body.results[0].result).not.toHaveProperty("components");
        expect(Object.keys(many.body.results[1].result.components).sort()).toEqual(["dev-a-pos", "dev-a-temp"]);
        for (const i of [2, 3]) {
            expect(many.body.results[i].success).toBe(false);
            expect(many.body.results[i].responseDetail.status).toBe(404);
        }
    });

    it("refuses to subscribe to a hidden object, and stops delivering on revocation", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a"), grant("dev-b")] });
        const { a, subscriptions } = app(s, "alice@REALM");
        const sub = (await request(a).post("/v1/subscriptions").send({ clientId: "c" })).body.result;
        const reg = await request(a).post("/v1/subscriptions/register").send({
            clientId: "c", subscriptionId: sub.subscriptionId, elementIds: ["dev-a-temp", "dev-b-temp", "dev-c-temp"],
        });
        expect(reg.body.results.map((r: any) => r.success)).toEqual([true, true, false]);

        const push = (id: string) => (subscriptions as any).onValueChange(id,
            { value: 1, quality: "Good", timestamp: "2026-11-03T00:00:00Z" });
        push("dev-a-temp");
        s.auth.set("alice@REALM", [grant("dev-b")]);
        push("dev-a-temp");
        push("dev-b-temp");
        const sync = await request(a).post("/v1/subscriptions/sync").send({ clientId: "c", subscriptionId: sub.subscriptionId });
        expect(sync.body.result.map((b: any) => b.updates.map((u: any) => u.elementId)))
            .toEqual([["dev-b-temp"]]);
        subscriptions.destroy();
    });

    it("answers 503 when the Auth service cannot be reached", async () => {
        const s = setup({ "alice@REALM": [grant("dev-a")] });
        s.auth.fail = 500;
        const res = await request(app(s, "alice@REALM").a).get("/v1/objects");
        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
    });
});
