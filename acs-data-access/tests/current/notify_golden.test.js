/*
 * ACS Data Access Service
 * Golden tests: what a notify client holds after every scenario step
 * Copyright 2026 University of Sheffield
 */

/* These snapshots were taken from the notify handlers as they were
 * before the keyed views. They are the proof that later code leaves
 * every client with the same state, so never update them: if one
 * fails, the code is wrong.
 *
 * Each principal holds all eight endpoints for the whole scenario. A
 * record is the state the client holds, not the messages that led to
 * it, with every order nobody specified sorted (see reduce). Scenario
 * B leaves out the structure SEARCH: the code these were taken from
 * sends nothing on it while an invalid dataset is visible.
 *
 * They run against fakes, so they need no cluster. */

import { beforeAll, describe, expect, test } from "vitest";

import {
    ENDPOINTS, make_client, message_shape,
} from "../support/notify-client.js";
import { run_scenario, step_names } from "../support/scenario.js";

const SINGLE = new Set(["metadata_uuid", "structure_uuid"]);

/* Every shape of message the old handlers send in the two scenarios:
 * the endpoint, then the message's keys and statuses and the type of
 * each body. A later stage may send fewer shapes, never a new one. Do
 * not add to this list. */
const SHAPE_CATALOGUE = [
    "SEARCH v2/metadata/ :: status=200 child response=200/object",
    "SEARCH v2/metadata/ :: status=200 child response=201/object",
    "SEARCH v2/metadata/ :: status=200 child response=404/none",
    "SEARCH v2/metadata/ :: status=201 children{200/object} response=204/none",
    "SEARCH v2/metadata/ :: status=201 children{} response=204/none",
    "SEARCH v2/structure/ :: status=200 child response=200/object",
    "SEARCH v2/structure/ :: status=200 child response=201/object",
    "SEARCH v2/structure/ :: status=200 child response=404/none",
    "SEARCH v2/structure/ :: status=201 children{200/object} response=204/none",
    "SEARCH v2/structure/ :: status=201 children{} response=204/none",
    "WATCH v2/metadata/ :: status=200 response=200/array",
    "WATCH v2/metadata/:uuid :: status=200 response=200/none",
    "WATCH v2/metadata/:uuid :: status=200 response=200/object",
    "WATCH v2/session-sources/ :: status=200 response=200/array",
    "WATCH v2/structure/ :: status=200 response=200/array",
    "WATCH v2/structure/:uuid :: status=200 response=200/object",
    "WATCH v2/union-sources/ :: status=200 response=200/array",
];

const label_of = sub => sub.method == "SEARCH"
    ? `SEARCH ${sub.parent}`
    : `WATCH ${sub.request.url}`;
const pattern_of = (endpoint, sub) => SINGLE.has(endpoint)
    ? label_of(sub).replace(/[^/]+$/, ":uuid")
    : label_of(sub);

/* Every endpoint for every principal, as one client holds them. */
function open_all (client, { name, P, watched }) {
    const open = [];
    for (const [who, principal] of Object.entries(P)) {
        for (const [endpoint, make] of Object.entries(ENDPOINTS)) {
            if (name == "B" && endpoint == "structure_search") continue;
            const subs = SINGLE.has(endpoint)
                ? watched.map(uuid => make(uuid)) : [make()];
            for (const sub of subs) {
                open.push({
                    endpoint,
                    label:      `${who} ${label_of(sub)}`,
                    pattern:    pattern_of(endpoint, sub),
                    rec:        client.open(principal, sub),
                });
            }
        }
    }
    return open;
}

/* The state the client holds, as one line per item. */
function state_lines (open, skip = () => false) {
    const lines = new Map();
    for (const { endpoint, label, rec } of open) {
        if (skip(endpoint)) continue;
        const state = rec.state();
        if (state == null) {
            lines.set(label, "no answer");
        }
        else if ("error" in state) {
            lines.set(label, `error ${state.error}`);
        }
        else if (SINGLE.has(endpoint)) {
            lines.set(label, JSON.stringify(state));
        }
        else if (rec.method == "SEARCH") {
            if (!state.children) {
                lines.set(label, "no snapshot");
                continue;
            }
            const kids = Object.entries(state.children);
            lines.set(label, `${kids.length} children`);
            for (const [uuid, body] of kids)
                lines.set(`${label} ${uuid}`, JSON.stringify(body));
        }
        else {
            lines.set(label, `${state.status}, ${state.body.length} listed`);
            for (const uuid of state.body)
                lines.set(`${label} ${uuid}`, "listed");
        }
    }
    return lines;
}

/* Holds every endpoint open for every principal through a scenario. */
function observer (shapes = new Set()) {
    let client;
    let open;
    const result = { shapes, late: null };

    return {
        result,

        start (ctx) {
            client = make_client({ data: ctx.data, site: ctx.site });
            open = open_all(client, ctx);
        },

        read () {
            for (const { pattern, rec } of open) {
                for (const m of rec.messages)
                    shapes.add(`${pattern} :: ${message_shape(m)}`);
            }
            return state_lines(open);
        },

        /* A client that subscribes after the last step must hold what
         * the client that saw every step holds. WATCH v2/structure/:uuid
         * is left out: it sends nothing when its dataset goes away, so
         * the old client rightly keeps a body the new one never gets. */
        async finish (ctx) {
            const skip = endpoint => endpoint == "structure_uuid";
            const fresh = open_all(client, ctx);
            await ctx.site.settle();
            result.late = {
                held:   [...state_lines(open, skip)],
                fresh:  [...state_lines(fresh, skip)],
            };
        },

        async stop () {
            await client?.stop();
        },
    };
}

const shapes = new Set();

describe.each(["A", "B"])("notify client state, scenario %s", name => {
    let records;
    let result;

    beforeAll(async () => {
        const obs = observer(shapes);
        records = await run_scenario(name, obs);
        result = obs.result;
    }, 120000);

    test.each(step_names(name))("after: %s", step => {
        const record = records.find(r => r.step == step);
        expect(record.text).toMatchSnapshot();
    });

    test("a client that subscribes at the end holds the same state", () => {
        expect(result.late.fresh).toEqual(result.late.held);
    });

    /* The old handlers take about ten seconds a scenario, so only one
     * is recorded twice here. The DataFlow and HTTP goldens record
     * both twice. */
    if (name == "A") {
        test("recording it again gives the same records", async () => {
            expect(await run_scenario(name, observer())).toEqual(records);
        }, 120000);
    }
});

describe("message shapes", () => {
    /* The handlers the catalogue was taken from sent exactly these
     * shapes. The keyed views may send fewer, and never a new one. */
    test("the two scenarios send only catalogued shapes", () => {
        expect(shapes.size).toBeGreaterThan(0);
        const catalogue = new Set(SHAPE_CATALOGUE);
        expect([...shapes].filter(shape => !catalogue.has(shape))).toEqual([]);
    });
});
