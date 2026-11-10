/*
 * ACS Data Access Service
 * Wire tests: the exact notify messages, written out by hand
 * Copyright 2026 University of Sheffield
 */

/* Every shape of message the notify interface sends, every quirk a
 * client may depend on, and when each endpoint first answers. The
 * expected messages are literals, not snapshots, so a change to the
 * wire shows up as an edit to this file.
 *
 * A test that looks at the messages one change causes checks that the
 * expected message is among them. The handlers these were written
 * against also send messages that carry no new state, which later
 * stages may stop sending.
 *
 * They run against fakes, so they need no cluster. */

import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { ROOT, make_site } from "../support/fake-site.js";
import {
    ENDPOINTS, make_client, search, watch,
} from "../support/notify-client.js";

const { App, Perm, Class, Kind, Group, Metadata, Special } = Constants;
const { Info } = UUIDs.App;

const debug = { bound: () => () => {} };

const DEVICE = "d0000000-0000-4000-8000-000000000001";
/* A Sparkplug source with one part. */
const SOURCE = "a0000000-0000-4000-8000-000000000001";
/* A session over SOURCE, with a kind and tags. */
const SESSION = "a0000000-0000-4000-8000-000000000002";
/* A sub-device dataset, a subclass of SOURCE. */
const PART = "a0000000-0000-4000-8000-000000000003";
/* A Sparkplug source with no General information. */
const BARE = "a0000000-0000-4000-8000-000000000004";
/* Not on the site until a test makes it. */
const FRESH = "a0000000-0000-4000-8000-000000000005";
const NOWHERE = "a0000000-0000-4000-8000-0000000000ff";

/* Read on SOURCE and SESSION, Edit on SOURCE, nothing on PART or BARE. */
const USER = "user@EXAMPLE.ORG";
/* Known to Auth, with an empty ACL. */
const NOBODY = "nobody@EXAMPLE.ORG";
/* Auth does not know this principal. */
const STRANGER = "stranger@EXAMPLE.ORG";

const FROM = "2026-02-01T00:00:00.000Z";
const TO = "2026-02-02T12:00:00.500Z";

const SOURCE_CONFIG = { source: DEVICE };
const SESSION_CONFIG = { source: SOURCE, from: FROM, to: TO };
const PART_CONFIG = {
    source: DEVICE, metrics: [{ instance: DEVICE, metric: "Speed" }],
};

const STRUCTURE_APPS = [
    App.SparkplugSrc, App.SparkplugSubset, App.UNSDevice,
    App.UNSDeviceMetrics, App.UnionComponents, App.SessionLimits,
];
const METADATA_APPS = [Metadata.Tags, Metadata.RunMetadata];

/* The settled metadata bodies, as root receives them. */
const SOURCE_BODY = { uuid: SOURCE, name: "Source", parts: [PART] };
const SESSION_BODY = {
    uuid: SESSION, name: "Session", from: FROM, to: TO,
    function: [Kind.Run],
    metadata: { [Metadata.Tags]: { tags: ["x"] } },
    parts: [],
};
const BARE_BODY = { uuid: BARE, name: "UNKNOWN", parts: [] };

const open = [];

afterEach(async () => {
    for (const { site, data, client } of open.splice(0)) {
        await client.stop();
        data.stop?.();
        site.close();
    }
});

/* A four-dataset site, a DataFlow over it and a notify client.
 * `before` runs on the site before anything subscribes. */
function fixture (before) {
    const site = make_site();

    for (const app of STRUCTURE_APPS) site.add_member(App.DatasetDefinition, app);
    for (const app of METADATA_APPS) site.add_member(App.DatasetMetadata, app);
    for (const kind of [Kind.Run, Kind.Equipment])
        site.add_member(Group.FunctionalDatasetGroup, kind);

    site.put(App.SparkplugSrc, SOURCE, SOURCE_CONFIG);
    site.put(App.SessionLimits, SESSION, SESSION_CONFIG);
    site.put(App.SparkplugSubset, PART, PART_CONFIG);
    site.put(App.SparkplugSrc, BARE, SOURCE_CONFIG);
    for (const id of [SOURCE, SESSION, PART, BARE]) site.add_member(Class.Dataset, id);

    site.put(Info, SOURCE, { name: "Source" });
    site.put(Info, SESSION, { name: "Session" });
    site.put(Info, PART, { name: "Part" });
    site.put(Info, DEVICE, { name: "Device" });

    site.set_subclasses(SOURCE, [PART]);
    site.add_member(Kind.Run, SESSION);
    site.put(Metadata.Tags, SESSION, { tags: ["x"] });

    site.set_acl(USER, [
        { permission: Perm.ReadDataset, target: SOURCE },
        { permission: Perm.ReadDataset, target: SESSION },
        { permission: Perm.EditDataset, target: SOURCE },
        { permission: Perm.IncludeInUnion, target: SOURCE },
        { permission: Perm.UseForSession, target: SESSION },
    ]);
    site.set_acl(NOBODY, []);

    before?.(site);

    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const client = make_client({
        data, site,
        tokens: { roottoken: ROOT, usertoken: USER },
    });
    open.push({ site, data, client });
    return { site, data, client };
}

const sorted = list => [...list].sort();
const last = list => list[list.length - 1];

/* Open a subscription, wait for it to settle, and return the recording. */
async function settled (fx, principal, sub) {
    const rec = fx.client.open(principal, sub);
    await fx.site.settle();
    return rec;
}

/* The messages `change` causes on a recording. */
async function after (fx, rec, change) {
    const seen = rec.messages.length;
    await change();
    await fx.site.settle();
    return rec.messages.slice(seen);
}

/* The eight subscriptions, with the single WATCHes on `uuid`. */
const all_endpoints = uuid => Object.entries(ENDPOINTS)
    .map(([name, make]) => [name, make(uuid)]);

describe("list WATCHes", () => {
    test.each([
        ["v2/metadata/",        [SOURCE, SESSION]],
        ["v2/structure/",       [SOURCE]],
        ["v2/union-sources/",   [SOURCE]],
        ["v2/session-sources/", [SESSION]],
    ])("%s sends one update holding the whole list", async (url, uuids) => {
        const fx = fixture();
        const rec = await settled(fx, USER, watch(url));

        expect(rec.messages).toHaveLength(1);
        const [message] = rec.messages;
        expect(Object.keys(message)).toEqual(["status", "response"]);
        expect(Object.keys(message.response)).toEqual(["status", "body"]);
        expect({ ...message, response: {
            ...message.response, body: sorted(message.response.body) } })
            .toEqual({ status: 200, response: { status: 200, body: sorted(uuids) } });
    });

    test("root gets every valid dataset, and the structure list every dataset", async () => {
        const fx = fixture(site => site.put(App.UnionComponents, BARE, []));
        const metadata = await settled(fx, ROOT, watch("v2/metadata/"));
        const structure = await settled(fx, ROOT, watch("v2/structure/"));

        /* BARE has two definitions, so it is invalid. */
        expect(sorted(last(metadata.messages).response.body))
            .toEqual(sorted([SOURCE, SESSION, PART]));
        expect(sorted(last(structure.messages).response.body))
            .toEqual(sorted([SOURCE, SESSION, PART, BARE]));
    });

    test("a membership change sends the whole list again", async () => {
        const fx = fixture();
        const rec = await settled(fx, USER, watch("v2/metadata/"));

        const sent = await after(fx, rec, () =>
            fx.site.grant(USER, Perm.ReadDataset, BARE));
        expect(sent).toHaveLength(1);
        expect(sent[0].status).toBe(200);
        expect(sent[0].response.status).toBe(200);
        expect(sorted(sent[0].response.body)).toEqual(sorted([SOURCE, SESSION, BARE]));
    });

    test("a HEAD request gets the update with no body", async () => {
        const fx = fixture();
        const rec = await settled(fx, USER, watch("v2/metadata/", "HEAD"));
        expect(rec.messages).toEqual([{ status: 200, response: { status: 200 } }]);
    });

    test("a principal with no rights gets an empty list, not a 403", async () => {
        const fx = fixture();
        for (const url of ["v2/metadata/", "v2/structure/",
                "v2/union-sources/", "v2/session-sources/"]) {
            const rec = await settled(fx, NOBODY, watch(url));
            expect(rec.messages)
                .toEqual([{ status: 200, response: { status: 200, body: [] } }]);
        }
    });
});

describe("WATCH v2/metadata/:uuid", () => {
    test("the body has its keys in a fixed order", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, watch(`v2/metadata/${SESSION}`));

        expect(JSON.stringify(last(rec.messages))).toBe(JSON.stringify({
            status: 200,
            response: {
                status: 200,
                body: {
                    uuid:       SESSION,
                    name:       "Session",
                    from:       FROM,
                    to:         TO,
                    "function": [Kind.Run],
                    metadata:   { [Metadata.Tags]: { tags: ["x"] } },
                    parts:      [],
                },
            },
        }));
    });

    test("from, to, function and metadata are left out when there are none", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, watch(`v2/metadata/${BARE}`));

        expect(JSON.stringify(last(rec.messages))).toBe(JSON.stringify({
            status: 200,
            response: { status: 200, body: { uuid: BARE, name: "UNKNOWN", parts: [] } },
        }));
    });

    test("parts lists the subclasses the principal may read", async () => {
        const fx = fixture();
        const root = await settled(fx, ROOT, watch(`v2/metadata/${SOURCE}`));
        const user = await settled(fx, USER, watch(`v2/metadata/${SOURCE}`));

        expect(last(root.messages).response.body).toEqual(SOURCE_BODY);
        /* USER may not read PART. */
        expect(last(user.messages).response.body).toEqual({ ...SOURCE_BODY, parts: [] });
    });

    test("an empty name is sent as it is; only a missing name is UNKNOWN", async () => {
        const fx = fixture(site => {
            site.put(Info, SOURCE, { name: "" });
            site.put(Info, PART, { name: null });
        });
        const empty = await settled(fx, ROOT, watch(`v2/metadata/${SOURCE}`));
        const nulled = await settled(fx, ROOT, watch(`v2/metadata/${PART}`));

        expect(last(empty.messages).response.body.name).toBe("");
        expect(last(nulled.messages).response.body.name).toBe("UNKNOWN");

        /* The HTTP route treats an empty name as missing. */
        const api = new APIv1({
            data: fx.data, debug, auth: fx.site.auth, cdb: fx.site.cdb,
        });
        const res = {
            status () { return this; },
            json (body) { this.body = body; return this; },
        };
        await api.metadata_uuid({ auth: ROOT, params: { uuid: SOURCE } }, res);
        expect(res.body.name).toBe("UNKNOWN");
    });

    test.each([
        ["a UUID no dataset has",       ROOT, NOWHERE],
        ["a dataset it may not read",   USER, PART],
        ["a principal with no rights",  NOBODY, SOURCE],
    ])("%s gets a 200 with no body", async (_, principal, uuid) => {
        const fx = fixture();
        const rec = await settled(fx, principal, watch(`v2/metadata/${uuid}`));
        expect(rec.messages).toEqual([{ status: 200, response: { status: 200 } }]);
    });

    test("an invalid dataset gets a 200 with no body", async () => {
        const fx = fixture(site => site.put(App.UnionComponents, BARE, []));
        const rec = await settled(fx, ROOT, watch(`v2/metadata/${BARE}`));
        expect(rec.messages).toEqual([{ status: 200, response: { status: 200 } }]);
    });

    test("a dataset that goes away gets a 200 with no body", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, watch(`v2/metadata/${BARE}`));
        expect(last(rec.messages).response.body).toEqual(BARE_BODY);

        await after(fx, rec, () => fx.site.cdb.delete_object(BARE));
        expect(last(rec.messages)).toEqual({ status: 200, response: { status: 200 } });
    });

    test("a change to the dataset sends the new body", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, watch(`v2/metadata/${BARE}`));

        const sent = await after(fx, rec, () =>
            fx.site.put(Info, BARE, { name: "Named" }));
        expect(sent).toEqual([{
            status: 200,
            response: { status: 200, body: { ...BARE_BODY, name: "Named" } },
        }]);
    });
});

describe("WATCH v2/structure/:uuid", () => {
    test("the body is the structure and the config, in that order", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, watch(`v2/structure/${SESSION}`));

        expect(rec.messages).toHaveLength(1);
        expect(JSON.stringify(rec.messages[0])).toBe(JSON.stringify({
            status: 200,
            response: {
                status: 200,
                body: { structure: App.SessionLimits, config: SESSION_CONFIG },
            },
        }));
    });

    test.each([
        ["a UUID no dataset has",       ROOT, NOWHERE],
        ["a dataset it may not edit",   USER, SESSION],
        ["a principal with no rights",  NOBODY, SOURCE],
    ])("%s gets nothing", async (_, principal, uuid) => {
        const fx = fixture();
        const rec = await settled(fx, principal, watch(`v2/structure/${uuid}`));
        expect(rec.messages).toEqual([]);
    });

    test("an invalid dataset gets nothing", async () => {
        const fx = fixture(site => site.put(App.UnionComponents, BARE, []));
        const rec = await settled(fx, ROOT, watch(`v2/structure/${BARE}`));
        expect(rec.messages).toEqual([]);
    });

    test("a dataset that goes away or turns invalid sends nothing more", async () => {
        const fx = fixture();
        const gone = await settled(fx, ROOT, watch(`v2/structure/${BARE}`));
        const broken = await settled(fx, ROOT, watch(`v2/structure/${SESSION}`));

        expect(await after(fx, broken, () =>
            fx.site.put(App.UnionComponents, SESSION, []))).toEqual([]);
        expect(await after(fx, gone, () =>
            fx.site.cdb.delete_object(BARE))).toEqual([]);
    });

    test("a change to the config sends the new body", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, watch(`v2/structure/${SESSION}`));

        const config = { ...SESSION_CONFIG, to: "2026-02-03T00:00:00.000Z" };
        const sent = await after(fx, rec, () =>
            fx.site.put(App.SessionLimits, SESSION, config));
        expect(sent).toEqual([{
            status: 200,
            response: { status: 200, body: { structure: App.SessionLimits, config } },
        }]);
    });
});

describe("SEARCH v2/metadata/", () => {
    test("the first message is a snapshot of every visible dataset", async () => {
        const fx = fixture();
        const rec = await settled(fx, USER, search("v2/metadata/"));

        const want = {
            [SOURCE]:   { ...SOURCE_BODY, parts: [] },
            [SESSION]:  SESSION_BODY,
        };

        /* The parts of a child in the snapshot are not pinned: a
         * snapshot taken before the parts are known holds a
         * placeholder, and an update follows. Everything else is. */
        const [snapshot] = rec.messages;
        expect(Object.keys(snapshot)).toEqual(["children", "response", "status"]);
        expect(snapshot.status).toBe(201);
        expect(snapshot.response).toEqual({ status: 204 });
        expect(sorted(Object.keys(snapshot.children))).toEqual(sorted(Object.keys(want)));
        for (const [uuid, child] of Object.entries(snapshot.children)) {
            expect(Object.keys(child)).toEqual(["status", "body"]);
            expect(child.status).toBe(200);
            expect(Object.keys(child.body)).toEqual(Object.keys(want[uuid]));
            expect({ ...child.body, parts: [] }).toEqual(want[uuid]);
        }

        expect(rec.state().children).toEqual(want);
    });

    test("a principal with no rights gets an empty snapshot, not a 403", async () => {
        const fx = fixture();
        const rec = await settled(fx, NOBODY, search("v2/metadata/"));
        expect(rec.messages)
            .toEqual([{ children: {}, response: { status: 204 }, status: 201 }]);
    });

    test("a dataset that becomes visible is a child update with a 201", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, search("v2/metadata/"));

        const sent = await after(fx, rec, async () => {
            await fx.site.cdb.create_object(Class.Dataset, FRESH, false);
            await fx.site.cdb.put_config(App.SparkplugSrc, FRESH, SOURCE_CONFIG);
        });
        const first = sent.find(m => m.child == FRESH);
        expect(Object.keys(first)).toEqual(["status", "child", "response"]);
        expect(first.status).toBe(200);
        expect(Object.keys(first.response)).toEqual(["status", "body"]);
        expect(first.response.status).toBe(201);
        expect(first.response.body).toMatchObject({ uuid: FRESH, name: "UNKNOWN" });

        expect(rec.state().children[FRESH])
            .toEqual({ uuid: FRESH, name: "UNKNOWN", parts: [] });
    });

    test("a changed dataset is a child update with a 200 and the whole body", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, search("v2/metadata/"));

        const sent = await after(fx, rec, () =>
            fx.site.put(Info, SESSION, { name: "Second shift" }));
        expect(sent).toEqual([{
            status: 200,
            child:  SESSION,
            response: { status: 200, body: { ...SESSION_BODY, name: "Second shift" } },
        }]);
        expect(JSON.stringify(sent[0].response.body))
            .toBe(JSON.stringify({ ...SESSION_BODY, name: "Second shift" }));
    });

    test("a dataset that goes away, or a revoked grant, is a child update with a 404", async () => {
        const fx = fixture();
        const root = await settled(fx, ROOT, search("v2/metadata/"));
        const user = await settled(fx, USER, search("v2/metadata/"));

        const revoked = await after(fx, user, () =>
            fx.site.revoke(USER, Perm.ReadDataset, SESSION));
        expect(revoked).toContainEqual(
            { status: 200, child: SESSION, response: { status: 404 } });
        expect(Object.keys(user.state().children)).toEqual([SOURCE]);

        const gone = await after(fx, root, () => fx.site.cdb.delete_object(BARE));
        expect(gone).toContainEqual(
            { status: 200, child: BARE, response: { status: 404 } });
        expect(root.state().children).not.toHaveProperty(BARE);
    });

    test("a client filter leaves out children and sends a 412 for one that leaves it", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, search("v2/metadata/", { name: "Source" }));

        expect(Object.keys(rec.messages[0].children)).toEqual([SOURCE]);

        const sent = await after(fx, rec, () =>
            fx.site.put(Info, SOURCE, { name: "Renamed" }));
        expect(sent).toEqual(
            [{ status: 200, child: SOURCE, response: { status: 412 } }]);
    });
});

describe("SEARCH v2/structure/", () => {
    test("the first message is a snapshot of every dataset the principal may edit", async () => {
        const fx = fixture();
        const rec = await settled(fx, USER, search("v2/structure/"));

        const [snapshot] = rec.messages;
        expect(Object.keys(snapshot)).toEqual(["children", "response", "status"]);
        expect(snapshot).toEqual({
            children: {
                [SOURCE]: { status: 200, body: {
                    structure: App.SparkplugSrc, config: SOURCE_CONFIG } },
            },
            response: { status: 204 },
            status: 201,
        });
        expect(Object.keys(snapshot.children[SOURCE].body))
            .toEqual(["structure", "config"]);
    });

    test("a principal with no rights gets an empty snapshot, not a 403", async () => {
        const fx = fixture();
        const rec = await settled(fx, NOBODY, search("v2/structure/"));
        expect(rec.messages)
            .toEqual([{ children: {}, response: { status: 204 }, status: 201 }]);
    });

    test("child updates carry 201, 200 and 404", async () => {
        const fx = fixture();
        const rec = await settled(fx, ROOT, search("v2/structure/"));

        const made = await after(fx, rec, () =>
            fx.site.put(App.SparkplugSrc, FRESH, SOURCE_CONFIG));
        expect(made).toContainEqual({
            status: 200,
            child:  FRESH,
            response: { status: 201, body: {
                structure: App.SparkplugSrc, config: SOURCE_CONFIG } },
        });

        const config = { ...SESSION_CONFIG, to: "2026-02-03T00:00:00.000Z" };
        const changed = await after(fx, rec, () =>
            fx.site.put(App.SessionLimits, SESSION, config));
        expect(changed).toContainEqual({
            status: 200,
            child:  SESSION,
            response: { status: 200, body: { structure: App.SessionLimits, config } },
        });

        const gone = await after(fx, rec, () =>
            fx.site.del(App.SparkplugSrc, FRESH));
        expect(gone).toContainEqual(
            { status: 200, child: FRESH, response: { status: 404 } });
    });
});

describe("requests the service refuses", () => {
    test.each([
        ["v2/metadata/not-a-uuid"],
        ["v2/structure/not-a-uuid"],
    ])("a WATCH on %s throws from the handler", url => {
        const fx = fixture();
        expect(() => fx.client.open(ROOT, watch(url))).toThrow();
    });

    test("a path with no handler gets a 404", () => {
        const fx = fixture();
        const rec = fx.client.open(ROOT, watch("v2/nothing/"));
        expect(rec.messages).toEqual([{ status: 404 }]);
    });
});

describe("source errors", () => {
    test("an error on a structure application ends every subscription with a 500", async () => {
        const fx = fixture();
        const recs = [];
        for (const [name, sub] of all_endpoints(SOURCE))
            recs.push([name, await settled(fx, ROOT, sub)]);

        fx.site.error("app", App.SessionLimits);
        await fx.site.settle();

        for (const [name, rec] of recs) {
            expect([name, last(rec.messages)]).toEqual([name, { status: 500 }]);
            expect([name, rec.ended]).toEqual([name, true]);
            expect([name, rec.messages.filter(m => m.status >= 400)])
                .toEqual([name, [{ status: 500 }]]);
        }
    });

    test("an error on General information ends the metadata search and watch with a 500", async () => {
        const fx = fixture();
        const found = await settled(fx, ROOT, search("v2/metadata/"));
        const watched = await settled(fx, ROOT, watch(`v2/metadata/${SOURCE}`));

        fx.site.error("app", Info);
        await fx.site.settle();

        expect(last(found.messages)).toEqual({ status: 500 });
        expect(last(watched.messages)).toEqual({ status: 500 });
    });
});

describe("when each endpoint first answers", () => {
    const bodyless = { status: 200, response: { status: 200 } };

    /* R1 */
    test("with every source silent, only WATCH v2/metadata/:uuid answers, at once", async () => {
        const fx = fixture(site => site.hold("*"));
        const recs = new Map();
        for (const [name, sub] of all_endpoints(SOURCE))
            recs.set(name, fx.client.open(USER, sub));

        /* Before anything asynchronous can run. */
        expect(recs.get("metadata_uuid").messages).toEqual([bodyless]);

        await fx.site.settle();
        for (const [name, rec] of recs) {
            expect([name, rec.messages])
                .toEqual([name, name == "metadata_uuid" ? [bodyless] : []]);
        }
    });

    /* R2 */
    test("a principal Auth does not know gets the bodyless 200 and nothing else", async () => {
        const fx = fixture();
        const recs = new Map();
        for (const [name, sub] of all_endpoints(SOURCE))
            recs.set(name, fx.client.open(STRANGER, sub));

        expect(recs.get("metadata_uuid").messages).toEqual([bodyless]);

        await fx.site.settle();
        for (const [name, rec] of recs) {
            expect([name, rec.messages])
                .toEqual([name, name == "metadata_uuid" ? [bodyless] : []]);
        }
    });

    /* R3. Known change W1: stage 6 sends parts as [] here. */
    test("SEARCH v2/metadata/ answers once the dataset map and the ACL have, with partial bodies", async () => {
        const fx = fixture(site => {
            site.hold("app", Info);
            for (const app of METADATA_APPS) site.hold("app", app);
            site.hold("member", Group.FunctionalDatasetGroup);
            site.hold("subclass");
        });
        const rec = await settled(fx, USER, search("v2/metadata/"));

        expect(rec.messages[0]).toEqual({
            children: {
                [SOURCE]:   { status: 200, body: {
                    uuid: SOURCE, name: "UNKNOWN", parts: {} } },
                [SESSION]:  { status: 200, body: {
                    uuid: SESSION, name: "UNKNOWN", from: FROM, to: TO, parts: {} } },
            },
            response: { status: 204 },
            status: 201,
        });
        expect(JSON.stringify(rec.messages[0].children[SESSION].body)).toBe(
            JSON.stringify({ uuid: SESSION, name: "UNKNOWN", from: FROM, to: TO, parts: {} }));

        /* When the held sources answer, the client ends up with the
         * full bodies. */
        fx.site.release();
        await fx.site.settle();
        expect(rec.state().children).toEqual({
            [SOURCE]:   { ...SOURCE_BODY, parts: [] },
            [SESSION]:  SESSION_BODY,
        });
    });

    test("the six other endpoints wait for the dataset map and the ACL only", async () => {
        const fx = fixture(site => {
            site.hold("app", Info);
            for (const app of METADATA_APPS) site.hold("app", app);
            site.hold("member", Group.FunctionalDatasetGroup);
            site.hold("subclass");
        });
        for (const [name, sub] of all_endpoints(SOURCE)) {
            if (name == "metadata_uuid" || name == "metadata_search") continue;
            const rec = await settled(fx, USER, sub);
            expect([name, rec.messages.length]).not.toEqual([name, 0]);
        }
    });

    test("nothing but WATCH v2/metadata/:uuid answers while the ACL is silent", async () => {
        const fx = fixture(site => site.hold("acl", USER));
        const recs = new Map();
        for (const [name, sub] of all_endpoints(SOURCE))
            recs.set(name, await settled(fx, USER, sub));

        for (const [name, rec] of recs) {
            expect([name, rec.messages])
                .toEqual([name, name == "metadata_uuid" ? [bodyless] : []]);
        }

        /* Once it answers, so does every endpoint. */
        fx.site.release();
        await fx.site.settle();
        for (const [name, rec] of recs)
            expect([name, rec.state()]).not.toEqual([name, null]);
        expect(recs.get("metadata_uuid").state().body)
            .toEqual({ ...SOURCE_BODY, parts: [] });
    });
});

describe.skipIf(!globalThis.WebSocket)("over a real WebSocket", () => {
    test("a SEARCH and a WATCH arrive as the same shapes, and CLOSE gives a 410", async () => {
        const fx = fixture();
        const conn = await fx.client.connect_ws("usertoken");

        const found = conn.request(search("v2/structure/"));
        const [snapshot] = await conn.wait_for_updates(found, 1);
        expect(snapshot).toEqual({
            status: 201,
            children: {
                [SOURCE]: { status: 200, body: {
                    structure: App.SparkplugSrc, config: SOURCE_CONFIG } },
            },
            response: { status: 204 },
        });

        const listed = conn.request(watch("v2/session-sources/"));
        const [list] = await conn.wait_for_updates(listed, 1);
        expect(list).toEqual({ status: 200, response: { status: 200, body: [SESSION] } });

        const single = conn.request(watch(`v2/metadata/${SESSION}`));
        await conn.wait_until(() => conn.updates(single)
            .some(u => Array.isArray(u.response.body?.parts)));
        const body = last(conn.updates(single)).response.body;
        expect(JSON.stringify(body)).toBe(JSON.stringify(SESSION_BODY));

        conn.close_sub(found);
        await conn.wait_until(() => conn.updates(found).some(u => u.status == 410));
        expect(last(conn.updates(found))).toEqual({ status: 410 });

        /* The other subscriptions stay open. */
        fx.site.grant(USER, Perm.UseForSession, SOURCE);
        const lists = await conn.wait_for_updates(listed, 2);
        expect(sorted(lists[1].response.body)).toEqual(sorted([SOURCE, SESSION]));
    });

    test("a malformed UUID on a single WATCH closes the WebSocket", async () => {
        const fx = fixture();
        const conn = await fx.client.connect_ws("roottoken");

        conn.request(watch("v2/metadata/not-a-uuid"));
        await conn.wait_closed();
        expect(conn.closed).toBe(true);
    });

    test("a token the service does not accept gets a 401", async () => {
        const fx = fixture();
        await expect(fx.client.connect_ws("nobodytoken"))
            .rejects.toThrow("Notify auth failed: 401");
    });
});

/* The fixture itself: the literals above assume these. */
describe("the fixture", () => {
    test("has four valid datasets", async () => {
        const fx = fixture();
        const datasets = await rx.firstValueFrom(fx.data.datasets);
        expect(sorted(datasets.keySeq().toArray()))
            .toEqual(sorted([SOURCE, SESSION, PART, BARE]));
        expect(datasets.every(d => d.structure != Special.InvalidDataset)).toBe(true);
    });
});
