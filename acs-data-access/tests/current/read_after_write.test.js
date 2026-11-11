/*
 * ACS Data Access Service
 * A read that follows a write returns what was written
 * Copyright 2026 University of Sheffield
 */

/* The read routes answer from the maps DataFlow.run() holds, and those
 * trail a ConfigDB write by the time its notification takes. Each
 * write route waits for the held map to show its write before it
 * answers (DataFlow.caught_up), so the next read returns the new
 * value.
 *
 * Every case here runs on a site whose notifications arrive late. The
 * same cases run a second time with the wait taken out, to show that
 * the read is then stale: without that, a pass would prove nothing.
 *
 * They run against fakes, so they need no cluster. */

import { afterEach, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { make_site, ROOT } from "../support/fake-site.js";

const { App, Class, Group, Kind, Metadata } = Constants;
const { Info } = UUIDs.App;

/* How late each notification is, in ms. */
const LAG = 15;

const SOURCE = "5eed0000-0000-4000-8000-000000000001";
const OTHER = "5eed0000-0000-4000-8000-000000000002";
const SESSION = "5eed0000-0000-4000-8000-000000000003";
const UNION = "5eed0000-0000-4000-8000-000000000004";
const BROKEN = "5eed0000-0000-4000-8000-000000000005";
const DEVICE = "5eed0000-0000-4000-8000-0000000000d1";
const MISSING = "5eed0000-0000-4000-8000-0000000000ff";

const WINDOW = {
    source: SOURCE,
    from:   "2026-01-01T00:00:00.000Z",
    to:     "2026-01-02T00:00:00.000Z",
};
const LATER = { ...WINDOW, to: "2026-01-03T00:00:00.000Z" };

const open = [];

afterEach(async () => {
    for (const { site, data } of open.splice(0)) {
        data.stop();
        site.close();
    }
});

/* A site of five datasets with the index running on it.
 * @arg opts.wait False to take the wait out of the write routes.
 * @arg opts.write_wait_ms The time limit of the wait.
 */
async function make (opts = {}) {
    const site = make_site({ notify_lag: LAG });

    for (const app of [App.SparkplugSrc, App.SessionLimits, App.UnionComponents])
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
    add(OTHER, "Other", App.SparkplugSrc, { device: DEVICE });
    add(SESSION, "Session", App.SessionLimits, WINDOW);
    add(UNION, "Union", App.UnionComponents, [SOURCE]);
    /* Invalid: its source is no dataset. */
    add(BROKEN, "Broken", App.SessionLimits, { ...WINDOW, source: MISSING });

    site.put(Metadata.Tags, SESSION, { tags: ["old"] });
    site.put(Metadata.RunMetadata, SESSION, { operator: "A", note: "first" });
    site.add_member(Kind.Equipment, SESSION);

    const logs = [];
    const debug = {
        bound: name => (fmt, ...args) => logs.push({ name, fmt, args }),
    };

    const data = new DataFlow({
        debug,
        cdb:            site.cdb,
        auth:           site.auth,
        write_wait_ms:  opts.write_wait_ms,
    });
    if (opts.wait === false)
        data.caught_up = async () => true;
    data.run();

    const api = new APIv1({
        data,
        debug:      { bound: () => () => {} },
        auth:       site.auth,
        cdb:        site.cdb,
        buckets:    { sparkplug: "sparkplug-bucket" },
    });

    await site.settle();
    open.push({ site, data });
    return { site, data, api, logs: () => logs.filter(l => l.name == "data") };
}

/* Call a route handler as Express does. An APIError the handler throws
 * is the response WebAPI sends for it. */
async function call (api, method, req) {
    const res = {
        code: null,
        body: undefined,
        status (code) { this.code = code; return this; },
        json (body) {
            this.body = body === undefined
                ? undefined : JSON.parse(JSON.stringify(body));
            return this;
        },
        end () { return this; },
    };
    try {
        await api[method]({ auth: ROOT, ...req }, res);
    }
    catch (e) {
        if (typeof e?.status != "number") throw e;
        return { status: e.status };
    }
    return { status: res.code, body: res.body };
}

const write = (api, method, uuid, body) =>
    call(api, method, { params: { uuid }, body });
const metadata = (api, uuid) =>
    call(api, "metadata_uuid", { params: { uuid } });
const structure = (api, uuid) =>
    call(api, "structure_uuid", { params: { uuid } });

/* Each write route, the status it answers and what the read that
 * follows must return. `read` is given the write's answer, for the
 * route that makes a new UUID. */
const ROUTES = [
    {
        route:  "PUT /v1/metadata/:uuid/name",
        write:  api => write(api, "metadata_put_name", SESSION, { name: "Renamed" }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.name,
        fresh:  "Renamed",
    },
    {
        route:  "PUT /v1/metadata/:uuid/tags",
        write:  api => write(api, "metadata_put_tags", SESSION, { tags: ["new", "tags"] }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.metadata[Metadata.Tags],
        fresh:  { tags: ["new", "tags"] },
    },
    {
        route:  "PUT /v1/metadata/:uuid/tags with no tags",
        write:  api => write(api, "metadata_put_tags", SESSION, { tags: [] }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.metadata[Metadata.Tags],
        fresh:  undefined,
    },
    {
        route:  "PUT /v1/metadata/:uuid/labels",
        write:  api => write(api, "metadata_put_labels", SESSION, { labels: { [SOURCE]: "Energy" } }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.metadata[Metadata.EquipmentLabels],
        fresh:  { labels: { [SOURCE]: "Energy" } },
    },
    {
        route:  "PUT /v1/metadata/:uuid/kind",
        write:  api => write(api, "metadata_put_kind", SESSION, { kind: Kind.Run }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.function,
        fresh:  [Kind.Run],
    },
    {
        route:  "PUT /v1/metadata/:uuid/kind with no kind",
        write:  api => write(api, "metadata_put_kind", SESSION, { kind: null }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.function,
        fresh:  undefined,
    },
    {
        route:  "PUT /v1/metadata/:uuid/run",
        write:  api => write(api, "metadata_put_run", SESSION, { operator: "B" }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.metadata[Metadata.RunMetadata],
        fresh:  { operator: "B" },
    },
    {
        route:  "PATCH /v1/metadata/:uuid/run",
        write:  api => write(api, "metadata_patch_run", SESSION, { note: null, shift: 2 }),
        status: 204,
        read:   async api => (await metadata(api, SESSION)).body.metadata[Metadata.RunMetadata],
        fresh:  { operator: "A", shift: 2 },
    },
    {
        route:  "POST /v1/structure",
        write:  api => call(api, "structure_create",
            { body: { structure: App.SessionLimits, config: LATER } }),
        status: 200,
        read:   async (api, made) => (await structure(api, made.body)).body,
        fresh:  { structure: App.SessionLimits, config: LATER },
    },
    {
        route:  "PUT /v1/structure/:uuid",
        write:  api => write(api, "structure_update", UNION,
            { structure: App.UnionComponents, config: [SOURCE, OTHER] }),
        status: 200,
        read:   async api => (await structure(api, UNION)).body.config,
        fresh:  [SOURCE, OTHER],
    },
    {
        route:  "PUT /v1/structure/:uuid of an invalid dataset",
        write:  api => write(api, "structure_update", BROKEN,
            { structure: App.SessionLimits, config: LATER }),
        status: 200,
        read:   async api => (await structure(api, BROKEN)).body,
        fresh:  { structure: App.SessionLimits, config: LATER },
    },
    {
        route:  "GET /v1/delete/:uuid",
        write:  api => call(api, "delete_dataset", { params: { uuid: UNION } }),
        status: 200,
        read:   async api => (await metadata(api, UNION)).status,
        fresh:  404,
        /* The route looks for datasets that refer to this one with a
         * one-off SEARCH of each structure application, as it did
         * before the wait. Each has closed by the time it answers. */
        searches:   6,
    },
];

/* What a site holds open, and how many times it has been asked to
 * open something. `searches` is how many SEARCHes the route itself is
 * known to make. */
const opened = (site, searches = 0) => ({
    open:       site.open_subscriptions(),
    watches:    site.open_watches(),
    searches:   site.counters.search.total() + searches,
    members:    site.counters.watch.member.total(),
    subclasses: site.counters.watch.subclass.total(),
});

describe.each(ROUTES)("$route, with every notification 15 ms late", c => {
    test("the read that follows returns the new value", async () => {
        const { site, data, api, logs } = await make();
        const before = opened(site, c.searches);

        const answer = await c.write(api);
        expect(answer.status).toBe(c.status);

        /* The write opened nothing and left nothing behind. */
        expect(opened(site)).toEqual(before);
        expect(data.waits.size).toBe(0);

        expect(await c.read(api, answer)).toEqual(c.fresh);
        expect(logs()).toEqual([]);
    });

    test("without the wait, the read that follows is stale", async () => {
        const { api } = await make({ wait: false });

        const answer = await c.write(api);
        expect(answer.status).toBe(c.status);
        expect(await c.read(api, answer)).not.toEqual(c.fresh);
    });
});

describe("a write whose notification never arrives", () => {
    test.each(ROUTES)("$route still answers, within the limit, and logs", async c => {
        const { site, data, api, logs } = await make({ write_wait_ms: 60 });
        const before = opened(site, c.searches);
        /* ConfigDB takes the write and tells nobody. */
        site._notify = () => {};

        const start = performance.now();
        const answer = await c.write(api);
        const took = performance.now() - start;

        expect(answer.status).toBe(c.status);
        /* A timer can fire a little early by this clock. */
        expect(took).toBeGreaterThan(50);
        expect(took).toBeLessThan(1000);

        expect(logs()).toHaveLength(1);
        expect(logs()[0].fmt).toMatch(/did not show after %d ms/);
        expect(logs()[0].args.at(-1)).toBe(60);

        expect(opened(site)).toEqual(before);
        expect(data.waits.size).toBe(0);
    });
});

describe("two writes to one dataset", () => {
    test("one after the other: both answer and the read returns the second", async () => {
        const { data, api, logs } = await make();

        const first = await write(api, "metadata_put_tags", SESSION, { tags: ["one"] });
        const second = await write(api, "metadata_put_tags", SESSION, { tags: ["two"] });

        expect([first.status, second.status]).toEqual([204, 204]);
        expect((await metadata(api, SESSION)).body.metadata[Metadata.Tags])
            .toEqual({ tags: ["two"] });
        expect(data.waits.size).toBe(0);
        expect(logs()).toEqual([]);
    });

    test("at the same time: both answer without reaching the limit", async () => {
        const { data, api, logs } = await make();

        const answers = await Promise.all([
            write(api, "metadata_put_tags", SESSION, { tags: ["one"] }),
            write(api, "metadata_put_tags", SESSION, { tags: ["two"] }),
        ]);

        expect(answers.map(a => a.status)).toEqual([204, 204]);
        expect((await metadata(api, SESSION)).body.metadata[Metadata.Tags])
            .toEqual({ tags: ["two"] });
        expect(data.waits.size).toBe(0);
        expect(logs()).toEqual([]);
    });

    test("to different entries: each waits for its own", async () => {
        const { data, api, logs } = await make();

        const answers = await Promise.all([
            write(api, "metadata_put_tags", SESSION, { tags: ["one"] }),
            write(api, "metadata_put_run", SESSION, { operator: "C" }),
            write(api, "metadata_put_name", SESSION, { name: "Both" }),
        ]);

        expect(answers.map(a => a.status)).toEqual([204, 204, 204]);
        const { body } = await metadata(api, SESSION);
        expect(body.name).toBe("Both");
        expect(body.metadata[Metadata.Tags]).toEqual({ tags: ["one"] });
        expect(body.metadata[Metadata.RunMetadata]).toEqual({ operator: "C" });
        expect(data.waits.size).toBe(0);
        expect(logs()).toEqual([]);
    });
});

describe("DataFlow.caught_up", () => {
    const tags_are = tags => apps =>
        JSON.stringify(apps?.get(Metadata.Tags)) == JSON.stringify({ tags });

    test("resolves at once when the map already shows the write", async () => {
        const { data } = await make();
        const shown = data.caught_up("metadata", SESSION, tags_are(["old"]), Metadata.Tags);
        expect(data.waits.size).toBe(0);
        expect(await shown).toBe(true);
    });

    test("resolves at once while nothing holds the maps", async () => {
        const { data } = await make();
        data.stop();
        const shown = data.caught_up("metadata", SESSION, tags_are(["never"]), Metadata.Tags);
        expect(data.waits.size).toBe(0);
        expect(await shown).toBe(true);
    });

    test("a write the map passed over resolves when a later one shows", async () => {
        const { site, data, logs } = await make();

        /* "one" was replaced before its notification was read. */
        const one = data.caught_up("metadata", SESSION, tags_are(["one"]), Metadata.Tags);
        const two = data.caught_up("metadata", SESSION, tags_are(["two"]), Metadata.Tags);
        expect(data.waits.size).toBe(1);

        site.put(Metadata.Tags, SESSION, { tags: ["two"] });
        expect(await Promise.all([one, two])).toEqual([true, true]);
        expect(data.waits.size).toBe(0);
        expect(logs()).toEqual([]);
    });

    test("a later write does not resolve when only an earlier one shows", async () => {
        const { site, data } = await make({ write_wait_ms: 80 });

        const one = data.caught_up("metadata", SESSION, tags_are(["one"]), Metadata.Tags);
        const two = data.caught_up("metadata", SESSION, tags_are(["two"]), Metadata.Tags);

        site.put(Metadata.Tags, SESSION, { tags: ["one"] });
        expect(await one).toBe(true);
        expect(data.waits.size).toBe(1);
        expect(await two).toBe(false);
        expect(data.waits.size).toBe(0);
    });

    test("a waiting write is looked at only when its own dataset changes", async () => {
        const { site, data } = await make();
        let looked = 0;
        const shown = data.caught_up("metadata", SESSION, apps => {
            looked++;
            return tags_are(["mine"])(apps);
        }, Metadata.Tags);
        /* Once, when the wait began. */
        expect(looked).toBe(1);

        for (let i = 0; i < 20; i++)
            site.put(Metadata.Tags, OTHER, { tags: [`other-${i}`] });
        site.put(Info, SESSION, { name: "Another source" });
        await site.settle();
        expect(looked).toBe(1);

        site.put(Metadata.Tags, SESSION, { tags: ["mine"] });
        expect(await shown).toBe(true);
        expect(looked).toBe(2);
    });

    test("stop() resolves every waiting write", async () => {
        const { data, logs } = await make();
        const shown = data.caught_up("names", SESSION, info => info?.name == "Never");
        expect(data.waits.size).toBe(1);

        data.stop();
        expect(await shown).toBe(false);
        expect(data.waits.size).toBe(0);
        expect(logs()).toEqual([]);
    });

    test("the limit is 2 s unless a positive whole number is given", () => {
        const flow = write_wait_ms => new DataFlow({
            debug: { bound: () => () => {} }, write_wait_ms,
        }).write_wait_ms;

        expect(flow(undefined)).toBe(2000);
        expect(flow("750")).toBe(750);
        expect(flow(0)).toBe(2000);
        expect(flow("soon")).toBe(2000);
    });
});
