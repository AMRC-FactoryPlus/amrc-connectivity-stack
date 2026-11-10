/*
 * ACS Data Access Service
 * Test support: two scripted histories of one site, and how to record them
 * Copyright 2026 University of Sheffield
 */

/* Not a test file itself: vitest only collects *.test.js.
 *
 * A scenario builds a site of about 60 datasets and changes it one
 * step at a time. The golden tests record what Data Access shows after
 * every step and compare it with a snapshot taken from the code as it
 * was before the per-change index.
 *
 * Scenario A never makes a dataset invalid. Scenario B holds every
 * step that does. The old structure SEARCH sends nothing while an
 * invalid dataset is visible, so no golden can cover it in scenario B.
 *
 * What is recorded is a diff: the first record is the whole state, as
 * one line per item, and each later record is the lines a step added,
 * changed or removed. A step that changes nothing a client can see
 * records "(no change)", which is pinned like anything else. */

import * as imm from "immutable";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DefaultDatasets, default_dataset_uuid } from "../../lib/default-datasets.js";

import { make_site } from "./fake-site.js";
import { build_site } from "./site-builder.js";

const { App, Perm, Class, Kind, Group, Metadata } = Constants;
const { Info } = UUIDs.App;

const debug = { bound: () => () => {} };

/* Applications no built site has. */
const SEVENTH_STRUCTURE_APP = "5eedab1e-0aaa-4000-8000-000000000007";
const SIXTH_METADATA_APP = "5eedab1e-0aaa-4000-8000-000000000006";
const UNKNOWN_STRUCTURE_APP = "5eedab1e-0aaa-4000-8000-0000000000ff";

/* ---- Serialising ---- */

/** A value as plain JSON data, with every order nobody specified made
 * stable. A Map, Immutable or native, becomes an object with its keys
 * sorted: JSON.stringify of a native Map gives {}, so a map is never
 * stringified itself. A Set becomes a sorted array. A plain object
 * keeps its key order, which is part of what the goldens pin. A Date
 * becomes its ISO string. */
export function golden (value) {
    if (value == null || typeof value != "object") return value;
    if (value instanceof Date)
        return isNaN(value) ? "Invalid Date" : value.toISOString();
    if (value instanceof Map || imm.isKeyed(value)) {
        const entries = [...value.entries()].map(([k, v]) => [String(k), golden(v)]);
        entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        return Object.fromEntries(entries);
    }
    if (value instanceof Set || (imm.isCollection(value) && !imm.isIndexed(value))) {
        const items = [...value].map(golden);
        const key = v => typeof v == "string" ? v : JSON.stringify(v);
        return items.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    }
    if (imm.isIndexed(value) || Array.isArray(value))
        return [...value].map(golden);
    return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, golden(v)]));
}

/** One line per entry of a map, as `label key` -> JSON of the value.
 * @arg lines The Map of lines to add to.
 * @arg label What the map is.
 * @arg map A Map (Immutable or native), or undefined if the source
 * has not answered.
 */
export function map_lines (lines, label, map) {
    if (map === undefined) {
        lines.set(label, "no answer");
        return;
    }
    const plain = golden(map);
    lines.set(label, `${Object.keys(plain).length} entries`);
    for (const [key, value] of Object.entries(plain))
        lines.set(`${label} ${key}`, JSON.stringify(value));
}

/** The lines that differ between two records.
 * @returns Text: `+ key = value` for a new line, `~ key = value` for a
 * changed one and `- key` for one that went, in key order. */
export function diff_lines (before, after) {
    const keys = new Set([...before.keys(), ...after.keys()]);
    const out = [];
    for (const key of [...keys].sort()) {
        const was = before.get(key);
        const now = after.get(key);
        if (was === now) continue;
        if (now === undefined) out.push(`- ${key}`);
        else out.push(`${was === undefined ? "+" : "~"} ${key} = ${now}`);
    }
    return out.length ? out.join("\n") : "(no change)";
}

/* ---- Finding the datasets a step works on ---- */

function acl_has (site, principal, permission, target) {
    return (site.acl(principal) ?? []).some(e =>
        e.permission == permission && e.target == target);
}

/* The datasets whose stored config points at `uuid`. */
function referrers (site, uuid) {
    const out = [];
    for (const [id, config] of site.app(App.SessionLimits))
        if (config?.source == uuid) out.push(id);
    for (const [id, config] of site.app(App.UnionComponents))
        if (Array.isArray(config) && config.includes(uuid)) out.push(id);
    return out;
}

function need (what, value) {
    if (value == null)
        throw new Error(`The scenario site has no ${what}: the site builder changed`);
    return value;
}

/* ---- The scenarios ---- */

const SITE = { datasets: 60, devices: 34, placed: 30, defaults: 26, infos: 120 };

function setup_a (site, built) {
    const { kinds, named, devices, spare_devices, parents, fillers } = built;
    const P = built.principals;
    const special = new Set([
        named.part_parent, named.not_member, named.part_pending, named.nameless,
    ]);

    /* A device `some` holds UseDevice on, and one it does not. */
    const new_device = need("spare device some may use",
        spare_devices.find(d => acl_has(site, P.some, Perm.UseDevice, d)));
    const other_device = need("spare device some may not use",
        spare_devices.find(d => !acl_has(site, P.some, Perm.UseDevice, d)));

    const session = need("session inside the union chain", kinds.sessions[0]);
    const union = need("union chain", named.chain[0]);
    const loose = need("dataset nothing refers to", kinds.sparkplug.find(id =>
        !special.has(id) && !referrers(site, id).length && !parents.includes(id)
        && acl_has(site, P.some, Perm.ReadDataset, id)));
    const renamed = need("named dataset some may read", kinds.sparkplug.find(id =>
        !special.has(id) && id != loose
        && site.app(Info).get(id)?.name
        && acl_has(site, P.some, Perm.ReadDataset, id)));
    const ungranted = need("dataset some may not edit", kinds.sessions.find(id =>
        !acl_has(site, P.some, Perm.EditDataset, id)));
    const tagged = need("dataset with no tags", kinds.sparkplug.find(id =>
        id != loose && !site.app(Metadata.Tags).has(id)
        && acl_has(site, P.some, Perm.ReadDataset, id)));
    const default_device = need("device with a default dataset some may use",
        built.defaults.find(d => acl_has(site, P.some, Perm.UseDevice, d.device)));
    const closed_device = need("device with a default dataset some may not use",
        built.defaults.find(d => !acl_has(site, P.some, Perm.UseDevice, d.device)));
    const part = need("part of a dataset", kinds.subset[0]);
    const second_parent = need("second dataset with parts",
        parents.find(id => id != named.part_parent));
    const hidden_part = need("part some may not read",
        [...site.subclasses(second_parent)].find(id =>
            !acl_has(site, P.some, Perm.ReadDataset, id)
            && site.members(Class.Dataset).has(id)));

    return {
        new_device, new_dataset: default_dataset_uuid(new_device),
        other_device, other_dataset: default_dataset_uuid(other_device),
        session, union, loose, renamed, ungranted, tagged,
        default_device, closed_device, part, second_parent, hidden_part,
        part_parent: need("dataset with a part to come", named.part_parent),
        part_pending: need("part that is not a Dataset member", named.part_pending),
        not_member: need("dataset that is not a Dataset member", named.not_member),
        filler: need("object that is not a dataset", fillers[1]),
        device: devices[0],
    };
}

const STEPS_A = [
    ["create the object of a new default dataset", ({ site, ids }) =>
        site.cdb.create_object(Class.Dataset, ids.new_dataset, false)],
    ["put its UNS device entry", ({ site, ids }) =>
        site.cdb.put_config(App.UNSDevice, ids.new_dataset, { source: ids.new_device })],
    ["name it after its device", ({ site, ids }) =>
        site.cdb.put_config(Info, ids.new_dataset,
            { name: site.app(Info).get(ids.new_device).name })],
    ["make a second default dataset with the maker", ({ site, data, ids }) =>
        new DefaultDatasets({ data, cdb: site.cdb, debug })
            .make(ids.other_device, ids.other_dataset)],
    ["rename a dataset", ({ site, ids }) =>
        site.put(Info, ids.renamed, { ...site.app(Info).get(ids.renamed), name: "Renamed" })],
    ["remove a dataset's name", ({ site, ids }) =>
        site.del(Info, ids.renamed)],
    ["edit a session window", ({ site, ids }) =>
        site.put(App.SessionLimits, ids.session, {
            ...site.app(App.SessionLimits).get(ids.session),
            from:   "2026-03-01T08:00:00.000Z",
            to:     "2026-03-01T16:30:00.250Z",
        })],
    ["add a union component", ({ site, ids }) =>
        site.put(App.UnionComponents, ids.union,
            [...site.app(App.UnionComponents).get(ids.union), ids.new_dataset])],
    ["delete a dataset nothing refers to", ({ site, ids }) =>
        site.cdb.delete_object(ids.loose)],
    ["grant EditDataset on a dataset", ({ site, P, ids }) =>
        site.grant(P.some, Perm.EditDataset, ids.ungranted)],
    ["revoke that EditDataset", ({ site, P, ids }) =>
        site.revoke(P.some, Perm.EditDataset, ids.ungranted)],
    ["revoke UseDevice on a device", ({ site, P, ids }) =>
        site.revoke(P.some, Perm.UseDevice, ids.default_device.device)],
    ["grant UseDevice on a device", ({ site, P, ids }) =>
        site.grant(P.some, Perm.UseDevice, ids.closed_device.device)],
    ["put metadata on a dataset", ({ site, ids }) =>
        site.put(Metadata.Tags, ids.tagged, { tags: ["new", "tags"] })],
    ["delete that metadata", ({ site, ids }) =>
        site.del(Metadata.Tags, ids.tagged)],
    ["change a dataset's kind", ({ site, ids }) => {
        site.remove_member(Kind.Run, ids.session);
        site.add_member(Kind.Operation, ids.session);
    }],
    ["add a Dataset member", ({ site, ids }) =>
        site.add_member(Class.Dataset, ids.not_member)],
    ["remove a Dataset member", ({ site, ids }) =>
        site.remove_member(Class.Dataset, ids.part)],
    ["change a subclass list", ({ site, ids }) =>
        site.set_subclasses(ids.second_parent,
            [...site.subclasses(ids.second_parent), ids.session])],
    ["a part becomes a Dataset member", ({ site, ids }) =>
        site.add_member(Class.Dataset, ids.part_pending)],
    ["grant ReadDataset on a part", ({ site, P, ids }) =>
        site.grant(P.some, Perm.ReadDataset, ids.hidden_part)],
    ["write unrelated General information", ({ site, ids }) =>
        site.put(Info, ids.filler, { name: "Something else" })],
    ["give a principal a wildcard grant", ({ site, P }) =>
        site.grant(P.none, Perm.ReadDataset, UUIDs.Special.Null)],
    ["take the wildcard grant away", ({ site, P }) =>
        site.revoke(P.none, Perm.ReadDataset, UUIDs.Special.Null)],
    ["add a metadata application with an entry", ({ site, ids }) => {
        site.put(SIXTH_METADATA_APP, ids.session, { sixth: true });
        site.add_member(App.DatasetMetadata, SIXTH_METADATA_APP);
    }],
    ["add an empty structure application", ({ site }) =>
        site.add_member(App.DatasetDefinition, SEVENTH_STRUCTURE_APP)],
    /* One source of each kind. The old code rebuilds everything on
     * each of these, so resyncing all of them takes it many seconds. */
    ["resync sources with equal content", ({ site, P }) => {
        site.resync(App.UNSDevice);
        site.resync(Metadata.Tags);
        site.resync(Info);
        site.resync_relation("member", Class.Dataset);
        site.resync_relation("member", Group.FunctionalDatasetGroup);
        site.repush_acl(P.some);
    }],
];

function setup_b (site, built) {
    const { kinds, named } = built;
    const P = built.principals;

    const session = need("session inside the union chain", kinds.sessions[0]);
    const default_dup = need("default dataset some may use", built.defaults.find(d =>
        acl_has(site, P.some, Perm.UseDevice, d.device)));
    /* A session over a device dataset, where nothing else reads that
     * dataset. Deleting the dataset leaves only the session invalid. */
    const orphan = need("session with a source of its own", kinds.sessions.find(id => {
        const source = site.app(App.SessionLimits).get(id).source;
        return id != session
            && kinds.sparkplug.includes(source)
            && referrers(site, source).length == 1
            && source != named.part_parent && source != named.not_member;
    }));

    return {
        session, default_dup, orphan,
        orphan_source: site.app(App.SessionLimits).get(orphan).source,
        chain: named.chain,
        empty_union: need("empty union", named.empty_union),
        dangling: built.spare(1),
        missing: built.spare(2),
        unknown: built.spare(3),
        device: built.devices[1],
    };
}

const STEPS_B = [
    ["give a session a second definition", ({ site, ids }) =>
        site.put(App.SparkplugSrc, ids.session, { source: ids.device })],
    ["edit it while it stays invalid", ({ site, ids }) =>
        site.put(App.SessionLimits, ids.session, {
            ...site.app(App.SessionLimits).get(ids.session),
            to: "2027-01-01T00:00:00.000Z",
        })],
    ["grant EditDataset on the invalid dataset", ({ site, P, ids }) =>
        site.grant(P.none, Perm.EditDataset, ids.session)],
    ["revoke that EditDataset", ({ site, P, ids }) =>
        site.revoke(P.none, Perm.EditDataset, ids.session)],
    ["remove the second definition", ({ site, ids }) =>
        site.del(App.SparkplugSrc, ids.session)],
    ["give a default dataset a second definition", ({ site, ids }) =>
        site.put(App.SparkplugSrc, ids.default_dup.dataset,
            { source: ids.default_dup.device })],
    ["rename the invalid default dataset", ({ site, ids }) =>
        site.put(Info, ids.default_dup.dataset, { name: "Renamed while invalid" })],
    ["remove its second definition", ({ site, ids }) =>
        site.del(App.SparkplugSrc, ids.default_dup.dataset)],
    ["add a session that points at a missing dataset", async ({ site, ids }) => {
        await site.cdb.create_object(Class.Dataset, ids.dangling, false);
        site.put(App.SessionLimits, ids.dangling, {
            source: ids.missing,
            from:   "2026-05-01T00:00:00.000Z",
            to:     "2026-05-02T00:00:00.000Z",
        });
        site.put(Info, ids.dangling, { name: "Dangling session" });
    }],
    ["make the missing dataset", async ({ site, ids }) => {
        await site.cdb.create_object(Class.Dataset, ids.missing, false);
        site.put(App.SparkplugSrc, ids.missing, { source: ids.device });
    }],
    ["make a union cyclic", ({ site, ids }) =>
        site.put(App.UnionComponents, ids.chain[0],
            [...site.app(App.UnionComponents).get(ids.chain[0]), ids.chain[3]])],
    ["repair the cyclic union", ({ site, ids }) =>
        site.put(App.UnionComponents, ids.chain[0],
            site.app(App.UnionComponents).get(ids.chain[0])
                .filter(c => c != ids.chain[3]))],
    ["delete a dataset a session refers to", ({ site, ids }) =>
        site.cdb.delete_object(ids.orphan_source)],
    ["delete the session left invalid", ({ site, ids }) =>
        site.cdb.delete_object(ids.orphan)],
    ["add a structure application nobody knows", ({ site }) =>
        site.add_member(App.DatasetDefinition, UNKNOWN_STRUCTURE_APP)],
    ["give a new object an entry in it", async ({ site, ids }) => {
        await site.cdb.create_object(Class.Dataset, ids.unknown, false);
        site.put(UNKNOWN_STRUCTURE_APP, ids.unknown, { anything: 1 });
    }],
    ["put it in a union", ({ site, ids }) =>
        site.put(App.UnionComponents, ids.empty_union, [ids.unknown])],
    ["remove the unknown structure application", ({ site }) =>
        site.remove_member(App.DatasetDefinition, UNKNOWN_STRUCTURE_APP)],
    ["take it out of the union", ({ site, ids }) =>
        site.put(App.UnionComponents, ids.empty_union, [])],
];

export const SCENARIOS = {
    A: {
        seed:   0xa1,
        setup:  setup_a,
        steps:  STEPS_A,
        /* The datasets each principal holds a single WATCH on. */
        watched: ids => [
            ids.new_dataset, ids.session, ids.loose, ids.part_parent, ids.second_parent,
        ],
    },
    B: {
        seed:   0xb2,
        setup:  setup_b,
        steps:  STEPS_B,
        watched: ids => [
            ids.session, ids.default_dup.dataset, ids.chain[3], ids.dangling, ids.unknown,
        ],
    },
};

/** The step names of a scenario, with "start" first: the names of the
 * records run_scenario returns. */
export function step_names (name) {
    return ["start", ...SCENARIOS[name].steps.map(([step]) => step)];
}

/** Build a scenario's site and a DataFlow over it.
 * @returns The context every step and observer gets:
 * `{ site, built, data, P, ids, watched }`. */
export function setup_scenario (name) {
    const scenario = SCENARIOS[name];
    const site = make_site();
    const built = build_site(site, { ...SITE, seed: scenario.seed });
    const ids = scenario.setup(site, built);
    const data = new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    return {
        name, site, built, data, ids,
        P: built.principals,
        watched: scenario.watched(ids),
    };
}

/** Run a scenario and record it.
 *
 * @arg name "A" or "B".
 * @arg observer.start Called with the context before the first step.
 * Open subscriptions here.
 * @arg observer.read Called after the start and after every step, once
 * the site has settled. Returns a Map of lines: the whole state.
 * @arg observer.check Optional. Called at the same points, to assert
 * something about the state.
 * @arg observer.finish Optional. Called once after the last step.
 * @arg observer.stop Called at the end, also after a failure.
 * @returns An array of `{ step, text }`: the first text is every line,
 * the rest are diffs (see diff_lines).
 */
export async function run_scenario (name, observer) {
    const ctx = setup_scenario(name);
    const { site, data } = ctx;
    const records = [];
    let before = new Map();

    const record = async step => {
        await site.settle();
        const lines = await observer.read(ctx);
        await observer.check?.(ctx, step);
        records.push({ step, text: diff_lines(before, lines) });
        before = lines;
    };

    try {
        data.run();
        await observer.start(ctx);
        await record("start");
        for (const [step, run] of SCENARIOS[name].steps) {
            await run(ctx);
            await record(step);
        }
        await observer.finish?.(ctx);
    }
    finally {
        await observer.stop?.(ctx);
        data.stop?.();
        site.close();
    }
    return records;
}
