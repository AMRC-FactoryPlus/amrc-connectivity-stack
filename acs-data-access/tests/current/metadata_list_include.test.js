/*
 * ACS Data Access Service
 * GET /v1/metadata?include=: names and windows for every readable dataset
 * Copyright 2026 University of Sheffield
 */

/* Without `include` the list is the UUIDs it always was. With it each
 * entry is the dataset's UUID and the fields asked for, with the
 * values GET /v1/metadata/:uuid gives. The list must hold exactly the
 * datasets that route would answer for.
 *
 * They run against fakes, so they need no cluster. */

import { afterEach, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1, METADATA_FIELDS } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";
import { make_site, ROOT } from "../support/fake-site.js";
import { run_scenario } from "../support/scenario.js";

const { App, Class, Group, Kind, Metadata, Perm } = Constants;
const { Info } = UUIDs.App;

const USER = "user@EXAMPLE.ORG";

const SOURCE = "5eed0000-0000-4000-8000-000000000001";
const SESSION = "5eed0000-0000-4000-8000-000000000002";
const HIDDEN = "5eed0000-0000-4000-8000-000000000003";
const DEVICE = "5eed0000-0000-4000-8000-0000000000d1";
const OTHER_DEVICE = "5eed0000-0000-4000-8000-0000000000d2";
const DEFAULT = default_dataset_uuid(DEVICE);
const OTHER_DEFAULT = default_dataset_uuid(OTHER_DEVICE);

const WINDOW = {
    source: SOURCE,
    from:   "2026-01-01T00:00:00.000Z",
    to:     "2026-01-02T00:00:00.000Z",
};

const debug = { bound: () => () => {} };

const open = [];

afterEach(() => {
    for (const { site, data } of open.splice(0)) {
        data.stop();
        site.close();
    }
});

/* A site of five datasets. USER may read SOURCE and SESSION through
 * grants on them, and DEFAULT through UseDevice on its device. USER
 * may read neither HIDDEN nor OTHER_DEFAULT. */
async function make () {
    const site = make_site();

    for (const app of [App.SparkplugSrc, App.SessionLimits, App.UNSDevice])
        site.add_member(App.DatasetDefinition, app);
    for (const app of Object.values(Metadata))
        site.add_member(App.DatasetMetadata, app);
    for (const kind of Object.values(Kind))
        site.add_member(Group.FunctionalDatasetGroup, kind);

    const add = (uuid, name, structure, config) => {
        site.add_member(Class.Dataset, uuid);
        site.put(structure, uuid, config);
        site.put(Info, uuid, { name });
    };
    add(SOURCE, "Source", App.SparkplugSrc, { device: DEVICE });
    add(SESSION, "Session", App.SessionLimits, WINDOW);
    add(HIDDEN, "Hidden", App.SparkplugSrc, { device: DEVICE });
    add(DEFAULT, "Device", App.UNSDevice, { source: DEVICE });
    add(OTHER_DEFAULT, "Other device", App.UNSDevice, { source: OTHER_DEVICE });

    site.put(Metadata.Tags, SESSION, { tags: ["shift-a"] });
    site.add_member(Kind.Run, SESSION);

    site.set_acl(USER, [
        { permission: Perm.ReadDataset, target: SOURCE },
        { permission: Perm.ReadDataset, target: SESSION },
        { permission: Perm.UseDevice, target: DEVICE },
    ]);

    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run();
    const api = new APIv1({ data, debug, auth: site.auth, cdb: site.cdb });

    await site.settle();
    open.push({ site, data });
    return { site, data, api };
}

/* Call a route handler as Express does. An APIError the handler throws
 * is the response WebAPI sends for it. */
async function call (api, handler, req) {
    const res = {
        code: null,
        body: undefined,
        status (code) { this.code = code; return this; },
        json (body) {
            this.body = body === undefined
                ? undefined : JSON.parse(JSON.stringify(body));
            return this;
        },
    };
    try {
        await handler.call(api, { auth: USER, params: {}, query: {}, ...req }, res);
    }
    catch (e) {
        if (typeof e?.status != "number") throw e;
        return { status: e.status };
    }
    return { status: res.code, body: res.body };
}

/* The list route as the router mounts it, so a Refusal is sent. */
const list = (api, query, auth = USER) =>
    call(api, api.refusable(api.metadata_list), { auth, query });
const single = (api, uuid, auth = USER) =>
    call(api, api.metadata_uuid, { auth, params: { uuid } });

const by_uuid = body => [...body].sort((a, b) => a.uuid < b.uuid ? -1 : 1);

describe("GET /v1/metadata without include", () => {
    test("is the list of UUIDs, as before", async () => {
        const { api } = await make();
        const { status, body } = await list(api, {});
        expect(status).toBe(200);
        expect(body.every(u => typeof u == "string")).toBe(true);
        expect([...body].sort()).toEqual([SOURCE, SESSION, DEFAULT].sort());
    });

    test("a request with no query at all is the same", async () => {
        const { api } = await make();
        const { body } = await call(api, api.metadata_list, { query: undefined });
        expect([...body].sort()).toEqual([SOURCE, SESSION, DEFAULT].sort());
    });
});

describe("GET /v1/metadata?include=", () => {
    test("name gives each dataset's UUID and name", async () => {
        const { api } = await make();
        const { status, body } = await list(api, { include: "name" });
        expect(status).toBe(200);
        expect(by_uuid(body)).toEqual(by_uuid([
            { uuid: SOURCE, name: "Source" },
            { uuid: SESSION, name: "Session" },
            { uuid: DEFAULT, name: "Device" },
        ]));
    });

    test("several fields give each of them, with the window only where there is one", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: "name,from,to,function" });
        expect(by_uuid(body)).toEqual(by_uuid([
            { uuid: SOURCE, name: "Source" },
            { uuid: SESSION, name: "Session",
                from: WINDOW.from, to: WINDOW.to, function: [Kind.Run] },
            { uuid: DEFAULT, name: "Device" },
        ]));
    });

    test("the parameter may be repeated, and spaces and empty items are ignored", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: ["name, ", " from,to"] });
        const session = body.find(e => e.uuid == SESSION);
        expect(session).toEqual({
            uuid: SESSION, name: "Session", from: WINDOW.from, to: WINDOW.to,
        });
    });

    test("an empty include gives entries of the UUID alone", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: "" });
        expect(by_uuid(body)).toEqual(by_uuid(
            [SOURCE, SESSION, DEFAULT].map(uuid => ({ uuid }))));
    });

    test("each entry is what GET /v1/metadata/:uuid answers, without parts", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: METADATA_FIELDS.join(",") });
        expect(body.length).toBe(3);
        for (const entry of body) {
            const { status, body: one } = await single(api, entry.uuid);
            expect(status).toBe(200);
            const { parts, ...rest } = one;
            expect(entry).toEqual(rest);
            /* The same key order, as the JSON text shows it. */
            expect(Object.keys(entry)).toEqual(Object.keys(rest));
        }
    });

    test("a dataset the caller may not read is not listed", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: "name" });
        const listed = body.map(e => e.uuid);
        expect(listed).not.toContain(HIDDEN);
        expect((await single(api, HIDDEN)).status).toBe(403);
    });

    test("UseDevice on a device lists its default dataset, and no other", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: "name" });
        const listed = body.map(e => e.uuid);
        expect(listed).toContain(DEFAULT);
        expect(listed).not.toContain(OTHER_DEFAULT);
        expect((await single(api, OTHER_DEFAULT)).status).toBe(403);
    });

    test("a caller with no grants gets an empty list", async () => {
        const { site, api } = await make();
        site.set_acl("nobody@EXAMPLE.ORG", []);
        const { status, body } = await list(api, { include: "name" }, "nobody@EXAMPLE.ORG");
        expect(status).toBe(200);
        expect(body).toEqual([]);
    });

    test("root gets every dataset", async () => {
        const { api } = await make();
        const { body } = await list(api, { include: "name" }, ROOT);
        expect(body.map(e => e.uuid).sort()).toEqual(
            [SOURCE, SESSION, HIDDEN, DEFAULT, OTHER_DEFAULT].sort());
    });

    test("a grant that goes takes the dataset out of the next list", async () => {
        const { site, api } = await make();
        site.revoke(USER, Perm.ReadDataset, SOURCE);
        await site.settle();
        const { body } = await list(api, { include: "name" });
        expect(body.map(e => e.uuid)).not.toContain(SOURCE);
    });
});

describe("GET /v1/metadata?include= refuses a field it does not know", () => {
    test.each([
        ["nonsense", ["nonsense"]],
        ["name,bogus,other", ["bogus", "other"]],
        ["parts", ["parts"]],
    ])("include=%s is a 422 naming %o", async (include, unknown) => {
        const { api } = await make();
        const { status, body } = await list(api, { include });
        expect(status).toBe(422);
        expect(body).toMatchObject({
            error: "invalid_include", unknown, fields: METADATA_FIELDS,
        });
        expect(typeof body.message).toBe("string");
        for (const field of unknown)
            expect(body.message).toContain(field);
    });

    test("a nested query object is a 422", async () => {
        const { api } = await make();
        const { status, body } = await list(api, { include: { name: "1" } });
        expect(status).toBe(422);
        expect(body.error).toBe("invalid_include");
    });

    test("uuid is accepted and changes nothing", async () => {
        const { api } = await make();
        const { status, body } = await list(api, { include: "uuid,name" });
        expect(status).toBe(200);
        expect(body.find(e => e.uuid == SOURCE)).toEqual({ uuid: SOURCE, name: "Source" });
    });
});

/* Across both scripted site histories, for every principal: the list
 * with every field names the same datasets as the plain list, and each
 * entry matches the single route. */
describe.each(["A", "B"])("include agrees with the other routes, scenario %s", name => {
    test("after every step", async () => {
        let api;
        let checked = 0;
        await run_scenario(name, {
            start ({ data, site }) {
                api = new APIv1({ data, debug, auth: site.auth, cdb: site.cdb });
            },
            read: () => new Map(),
            async check ({ P }) {
                for (const principal of Object.values(P)) {
                    const plain = await list(api, {}, principal);
                    const full = await list(api,
                        { include: METADATA_FIELDS.join(",") }, principal);
                    expect(full.status).toBe(200);
                    expect(full.body.map(e => e.uuid).sort())
                        .toEqual([...plain.body].sort());

                    for (const entry of full.body) {
                        const { body: one } = await single(api, entry.uuid, principal);
                        const { parts, ...rest } = one;
                        expect(entry).toEqual(rest);
                        checked++;
                    }
                }
            },
        });
        expect(checked).toBeGreaterThan(0);
    }, 120000);
});
