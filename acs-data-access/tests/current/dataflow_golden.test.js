/*
 * ACS Data Access Service
 * Golden tests: every public DataFlow stream after every scenario step
 * Copyright 2026 University of Sheffield
 */

/* These snapshots were taken from DataFlow as it was before the
 * per-change index. They are the proof that later code gives the same
 * maps, so never update them: if one fails, the code is wrong.
 *
 * They run against fakes, so they need no cluster. */

import { Map as IMap, Set as ISet } from "immutable";
import { beforeAll, describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "../../lib/constants.js";
import {
    reference_default_devices, reference_functional_types, reference_group,
    reference_invalid, reference_parts, reference_valid,
} from "../support/reference-datasets.js";
import {
    golden, map_lines, run_scenario, step_names,
} from "../support/scenario.js";
import { site_datasets } from "../support/site-builder.js";

const { App, Class, Group } = Constants;

const STREAMS = [
    "datasets", "valid_datasets", "invalid_datasets", "default_devices",
    "general_infos", "metadata", "functional_types", "parts",
];

/* Holds the latest value of every public stream. */
function observer () {
    const latest = {};
    const errors = [];
    const subs = [];

    return {
        start ({ data }) {
            for (const name of STREAMS) {
                subs.push(data[name].subscribe({
                    next:   v => { latest[name] = v; },
                    error:  e => errors.push([name, e]),
                }));
            }
        },

        read () {
            const lines = new Map();
            for (const name of STREAMS)
                map_lines(lines, name, latest[name]);
            return lines;
        },

        /* The streams equal the whole-map reference algorithms run on
         * the site's state. This also checks the reference copies
         * against the code they were copied from. */
        check ({ site }) {
            expect(errors).toEqual([]);

            const want = site_datasets(site);
            expect(golden(latest.datasets)).toEqual(golden(want));
            expect(golden(latest.valid_datasets)).toEqual(golden(reference_valid(want)));
            expect(golden(latest.invalid_datasets)).toEqual(golden(reference_invalid(want)));
            expect(golden(latest.default_devices))
                .toEqual(golden(reference_default_devices(want)));

            expect(golden(latest.general_infos))
                .toEqual(golden(site.app(UUIDs.App.Info)));

            const metadata = [...site.members(App.DatasetMetadata)]
                .map(app => [app, site.app(app)]);
            expect(golden(latest.metadata)).toEqual(golden(reference_group(metadata)));

            const groups = IMap([...site.members(Group.FunctionalDatasetGroup)]
                .map(g => [g, ISet(site.members(g))]));
            expect(golden(latest.functional_types))
                .toEqual(golden(reference_functional_types(groups)));

            const members = ISet(site.members(Class.Dataset));
            const subclasses = IMap([...members]
                .map(m => [m, ISet(site.subclasses(m))]));
            expect(golden(latest.parts))
                .toEqual(golden(reference_parts(subclasses, members)));
        },

        stop () {
            for (const sub of subs) sub.unsubscribe();
        },
    };
}

describe.each(["A", "B"])("DataFlow streams, scenario %s", name => {
    let records;

    beforeAll(async () => {
        records = await run_scenario(name, observer());
    });

    test.each(step_names(name))("after: %s", step => {
        const record = records.find(r => r.step == step);
        expect(record.text).toMatchSnapshot();
    });

    test("recording it again gives the same records", async () => {
        expect(await run_scenario(name, observer())).toEqual(records);
    });
});

describe("the golden serialiser", () => {
    test("writes a native Map and an Immutable Map the same way, keys sorted", () => {
        const entries = [["b", 2], ["a", 1]];
        expect(JSON.stringify(golden(new Map(entries)))).toBe('{"a":1,"b":2}');
        expect(JSON.stringify(golden(IMap(entries)))).toBe('{"a":1,"b":2}');
    });

    test("sorts a Set, keeps an object's key order, and writes a Date as ISO", () => {
        expect(golden(new Set(["b", "a"]))).toEqual(["a", "b"]);
        expect(golden(ISet(["b", "a"]))).toEqual(["a", "b"]);
        expect(JSON.stringify(golden({ z: 1, a: new Date(0) })))
            .toBe('{"z":1,"a":"1970-01-01T00:00:00.000Z"}');
    });
});
