/*
 * ACS Data Access Service
 * Golden tests: what every read route answers after every scenario step
 * Copyright 2026 University of Sheffield
 */

/* These snapshots were taken from the service as it was before the
 * per-change index. They are the proof that later code gives the same
 * HTTP answers, so never update them: if one fails, the code is wrong.
 *
 * After each step every principal calls the four list routes, and the
 * metadata and structure routes for every dataset the site has had, a
 * UUID it never had and a malformed one. List order was never
 * specified, so lists and `parts` are sorted; the key order inside a
 * body is kept, because the records hold the JSON text.
 *
 * They run against fakes, so they need no cluster. */

import { beforeAll, describe, expect, test } from "vitest";

import { APIv1 } from "../../lib/api-v1.js";
import {
    committed_snapshots, golden_snapshots, run_scenario, step_names,
} from "../support/scenario.js";
import { site_datasets } from "../support/site-builder.js";

const debug = { bound: () => () => {} };

const NEVER_EXISTED = "0e0e0e0e-0000-4000-8000-000000000000";
const MALFORMED = "not-a-uuid";

const LISTS = {
    "GET /v1/metadata":         "metadata_list",
    "GET /v1/structure":        "structure_list",
    "GET /v1/union-sources":    "union_sources_list",
    "GET /v1/session-sources":  "session_sources_list",
};
const SINGLES = {
    "GET /v1/metadata/":        "metadata_uuid",
    "GET /v1/structure/":       "structure_uuid",
};

/* Call a route handler as Express does. An APIError or Refusal the
 * handler throws is the response WebAPI sends for it. */
async function call (api, method, req) {
    const res = {
        code: null,
        body: undefined,
        status (code) { this.code = code; return this; },
        json (body) {
            /* What the client parses from the wire. */
            this.body = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
            return this;
        },
    };
    try {
        await api[method](req, res);
    }
    catch (e) {
        if (typeof e?.status != "number") throw e;
        return { status: e.status };
    }
    return { status: res.code, body: res.body };
}

const sorted = list => [...list].sort();

function answer_line ({ status, body }) {
    if (body === undefined) return String(status);
    if (Array.isArray(body.parts)) body = { ...body, parts: sorted(body.parts) };
    return `${status} ${JSON.stringify(body)}`;
}

/* Calls every read route for every principal. */
function observer () {
    let api;
    /* Every dataset UUID the site has had: a route must keep
     * answering 403 or 404 for one that has gone. */
    const universe = new Set([NEVER_EXISTED, MALFORMED]);

    return {
        start ({ data, site, watched }) {
            api = new APIv1({
                data, debug,
                auth:       site.auth,
                cdb:        site.cdb,
                buckets:    { sparkplug: "sparkplug-bucket", uns: "uns-bucket" },
            });
            for (const uuid of watched) universe.add(uuid);
        },

        async read ({ site, P, watched }) {
            for (const uuid of site_datasets(site).keys()) universe.add(uuid);

            const lines = new Map();
            for (const [who, principal] of Object.entries(P)) {
                for (const [route, method] of Object.entries(LISTS)) {
                    const { status, body } = await call(api, method, { auth: principal });
                    lines.set(`${who} ${route}`, `${status}, ${body.length} listed`);
                    for (const uuid of sorted(body))
                        lines.set(`${who} ${route} ${uuid}`, "listed");
                }
                for (const [route, method] of Object.entries(SINGLES)) {
                    for (const uuid of universe) {
                        const answer = await call(api, method,
                            { auth: principal, params: { uuid } });
                        lines.set(`${who} ${route}${uuid}`, answer_line(answer));
                    }
                }
                /* The contents route resolves the dataset tree through
                 * the same map; a few datasets cover it. */
                for (const uuid of watched) {
                    const answer = await call(api, "metadata_contents",
                        { auth: principal, params: { uuid } });
                    lines.set(`${who} GET /v1/metadata/${uuid}/contents`, answer_line(answer));
                }
            }
            return lines;
        },
    };
}

const TITLE = "HTTP read routes, scenario %s";
/* Read now, before vitest can write to the file. */
const committed = committed_snapshots(import.meta.url);

describe("the committed snapshots", () => {
    /* A missing snapshot is written, not failed, so a renamed step
     * would be compared with nothing. This fails first. */
    test("are one for every step of both scenarios, and no other", () => {
        expect([...committed].sort()).toEqual(golden_snapshots(TITLE).sort());
    });
});

describe.each(["A", "B"])(TITLE, name => {
    let records;

    beforeAll(async () => {
        records = await run_scenario(name, observer());
    }, 120000);

    test.each(step_names(name))("after: %s", step => {
        const record = records.find(r => r.step == step);
        expect(record.text).toMatchSnapshot();
    });

    test("recording it again gives the same records", async () => {
        expect(await run_scenario(name, observer())).toEqual(records);
    }, 120000);
});
