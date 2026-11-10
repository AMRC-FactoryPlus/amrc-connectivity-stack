/*
 * ACS Data Access Service
 * Test support: fill a fake site with datasets of every kind
 * Copyright 2026 University of Sheffield
 */

/* Not a test file itself: vitest only collects *.test.js.
 *
 * build_site fills a FakeSite from a seed. The same options always
 * give the same site, down to every UUID. expected_visible works out
 * which datasets a principal should see, from the site's state and the
 * permission rule, without going through DataFlow; tests take their
 * counts from it and never hard-code one. */

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "../../lib/constants.js";
import {
    DEVICE_PERMS, READ_STRUCTURE, default_dataset_device, default_dataset_uuid,
} from "../../lib/default-datasets.js";

import { ROOT } from "./fake-site.js";
import { reference_datasets, reference_group } from "./reference-datasets.js";

const { App, Perm, Class, Kind, Group, Metadata, Special } = Constants;

/** The principals every built site has. */
export const PRINCIPALS = {
    /* The root principal: holds everything without an ACL. */
    root:   ROOT,
    /* Grants on the Null UUID for the four dataset permissions. */
    wild:   "wild@EXAMPLE.ORG",
    /* Direct grants on some datasets, and UseDevice on some devices. */
    some:   "some@EXAMPLE.ORG",
    /* Known to Auth, with an empty ACL. */
    none:   "none@EXAMPLE.ORG",
};

/** A principal no built site gives an ACL, so Auth does not know it. */
export const UNKNOWN_PRINCIPAL = "unknown@EXAMPLE.ORG";

/** The six structure applications, in the order the site lists them. */
export const STRUCTURE_APPS = [
    App.SparkplugSrc, App.SparkplugSubset, App.UNSDevice,
    App.UNSDeviceMetrics, App.UnionComponents, App.SessionLimits,
];

/** A metadata application Data Access has no constant for. */
export const EXTRA_METADATA_APP = "e87a0000-0aaa-4000-8000-000000000001";

/** The five metadata applications. */
export const METADATA_APPS = [
    App.MESIdentifiers, Metadata.Tags, Metadata.EquipmentLabels,
    Metadata.RunMetadata, EXTRA_METADATA_APP,
];

/** The functional groups a dataset can be a member of. */
export const FUNCTIONAL_GROUPS = [
    Kind.Equipment, Kind.Run, Kind.Operation, Kind.Product, Class.Published,
];

/** A seeded pseudo-random number generator (mulberry32).
 * @returns A function giving the next number in [0, 1). */
export function prng (seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const hex = (n, width) => n.toString(16).padStart(width, "0");

/* The second group of a built UUID says what the object is. */
const KIND_CODES = {
    device:     "0de0",
    node:       "0a0d",
    sparkplug:  "05a0",
    subset:     "05b0",
    metrics:    "0e70",
    own_uns:    "0f00",
    session:    "05e0",
    union:      "0c00",
    filler:     "0b0e",
    spare:      "0ffe",
};

/** The UUID of the `n`th object of a kind in the site built from `seed`. */
export function site_uuid (seed, kind, n) {
    const code = KIND_CODES[kind];
    if (!code) throw new RangeError(`Unknown kind ${kind}`);
    return `${hex(seed >>> 0, 8)}-${code}-4000-8000-${hex(n, 12)}`;
}

const DAY = 24 * 60 * 60 * 1000;
const EPOCH = Date.UTC(2026, 0, 1);

/** Fill a site.
 *
 * @arg site A FakeSite. It should be empty.
 * @arg opts.datasets How many datasets to make, of every kind.
 * @arg opts.defaults How many of them are default device datasets.
 * The default is half, or one per placed device if that is fewer.
 * @arg opts.devices How many devices. Every device has a name.
 * @arg opts.placed How many of the devices have an ISA-95 placement.
 * @arg opts.infos How many General information entries the site holds
 * in all. Entries for objects that are not datasets make up the
 * number. Fewer than the site needs is ignored.
 * @arg opts.seed The seed. UUIDs and every random choice come from it.
 * @returns What was made: see the end of this function.
 */
export function build_site (site, opts = {}) {
    const seed = opts.seed ?? 1;
    const total = opts.datasets ?? 60;
    const n_devices = opts.devices ?? Math.max(4, Math.ceil(total / 2));
    const n_placed = Math.min(opts.placed ?? n_devices - 2, n_devices);
    const n_defaults = Math.min(n_placed, total,
        opts.defaults ?? Math.floor(total / 2));

    const rand = prng(seed);
    const int = n => Math.floor(rand() * n);
    const pick = list => list[int(list.length)];
    const uuid = (kind, n) => site_uuid(seed, kind, n);
    const iso = days => new Date(EPOCH + Math.round(days * DAY)).toISOString();

    /* ---- Classes of applications and groups ---- */

    for (const app of STRUCTURE_APPS)
        site.add_member(App.DatasetDefinition, app);
    for (const app of METADATA_APPS)
        site.add_member(App.DatasetMetadata, app);
    for (const group of FUNCTIONAL_GROUPS)
        site.add_member(Group.FunctionalDatasetGroup, group);

    /* ---- Devices ---- */

    const node = uuid("node", 1);
    const devices = [];
    const device_name = new Map();
    for (let i = 0; i < n_devices; i++) {
        const device = uuid("device", i + 1);
        devices.push(device);
        device_name.set(device, `Device ${i + 1}`);
        site.add_member(UUIDs.Class.Device, device);
        site.put(UUIDs.App.Info, device, { name: device_name.get(device) });
        if (i < n_placed)
            site.put(Constants.External.ISA95Placement, device, { node });
    }
    const placed = devices.slice(0, n_placed);
    const unplaced = devices.slice(n_placed);

    /* ---- Datasets ---- */

    const datasets = [];
    const kinds = {
        defaults: [], sparkplug: [], subset: [], metrics: [], own_uns: [],
        sessions: [], unions: [],
    };
    /* Datasets with a structure entry that are not Dataset members. */
    const outside = new Set();

    const add = (kind, id, structure, config) => {
        datasets.push(id);
        kinds[kind].push(id);
        site.put(structure, id, config);
        return id;
    };

    /* Default device datasets, as the maker writes them. */
    const defaults = [];
    for (const device of placed.slice(0, n_defaults)) {
        const dataset = default_dataset_uuid(device);
        defaults.push({ device, dataset });
        add("defaults", dataset, App.UNSDevice, { source: device });
        site.put(UUIDs.App.Info, dataset, { name: device_name.get(device) });
    }
    /* Placed devices with no default dataset yet. */
    const spare_devices = placed.slice(n_defaults);

    const rest = total - n_defaults;
    const n_unions = Math.max(rest >= 14 ? 5 : 0, Math.floor(rest * 0.15));
    const n_sessions = Math.floor(rest * 0.25);
    const n_metrics = Math.floor(rest * 0.1);
    const n_subset = Math.floor(rest * 0.1);
    const n_own = rest >= 8 && placed.length ? 1 : 0;
    const n_sparkplug = rest - n_unions - n_sessions - n_metrics - n_subset - n_own;

    const metric = (device, n) => ({ instance: device, metric: `Metric_${n}` });

    for (let i = 0; i < n_sparkplug; i++)
        add("sparkplug", uuid("sparkplug", i + 1), App.SparkplugSrc,
            { source: pick(devices) });
    for (let i = 0; i < n_subset; i++) {
        const device = pick(devices);
        add("subset", uuid("subset", i + 1), App.SparkplugSubset,
            { source: device, metrics: [metric(device, i + 1)] });
    }
    for (let i = 0; i < n_metrics; i++) {
        const device = pick(placed.length ? placed : devices);
        add("metrics", uuid("metrics", i + 1), App.UNSDeviceMetrics,
            { source: device, metrics: [metric(device, 1), metric(device, i + 2)] });
    }
    /* A UNS device dataset somebody made before defaults existed. */
    for (let i = 0; i < n_own; i++)
        add("own_uns", uuid("own_uns", i + 1), App.UNSDevice,
            { source: pick(placed) });

    const leaves = [
        ...kinds.sparkplug, ...kinds.subset, ...kinds.metrics,
        ...kinds.own_uns, ...kinds.defaults,
    ];

    /* Sessions come in two halves, so some read a union and some
     * unions read a session, with no cycle. Most have a whole window;
     * a few have one end or none. */
    const session = (i, source) => {
        const start = int(200);
        const config = { source };
        if (i % 7 != 5) config.from = iso(start + rand());
        if (i % 7 != 6) config.to = iso(start + 1 + int(30) + rand());
        return add("sessions", uuid("session", i + 1), App.SessionLimits, config);
    };
    const early_sessions = leaves.length ? Math.ceil(n_sessions / 2) : 0;
    for (let i = 0; i < early_sessions; i++)
        session(i, pick(leaves));

    /* The first four unions are a chain, each inside the next. Then
     * one empty union, then unions of anything made so far. */
    const chain = [];
    let empty_union = null;
    for (let i = 0; i < n_unions; i++) {
        const id = uuid("union", i + 1);
        let config;
        if (i < 4 && n_unions >= 5 && leaves.length) {
            config = i == 0 ? [pick(leaves), pick(leaves)]
                : i == 2 && kinds.sessions.length ? [chain[i - 1], kinds.sessions[0]]
                : [chain[i - 1], pick(leaves)];
            chain.push(id);
        }
        else if (i == 4) {
            config = [];
            empty_union = id;
        }
        else {
            const pool = [...leaves, ...kinds.sessions, ...kinds.unions];
            config = [];
            const want = 2 + int(3);
            for (let k = 0; k < want && pool.length; k++) {
                const c = pick(pool);
                if (!config.includes(c)) config.push(c);
            }
        }
        add("unions", id, App.UnionComponents, config);
    }

    const late_pool = [...kinds.unions, ...kinds.sessions];
    for (let i = early_sessions; i < n_sessions && late_pool.length; i++)
        session(i, pick(late_pool));

    /* ---- Dataset membership, names, parts, kinds, metadata ---- */

    const others = datasets.slice(n_defaults);

    /* A dataset that is not a Dataset member, and a part that is not
     * one yet. Both still have a structure entry, so both are in the
     * dataset map. */
    const not_member = kinds.sparkplug.length >= 4 ? kinds.sparkplug.at(-1) : null;
    const part_parent = kinds.sparkplug.length >= 4 ? kinds.sparkplug[0] : null;
    const part_pending = part_parent && kinds.subset.length >= 2 ? kinds.subset.at(-1) : null;
    if (not_member) outside.add(not_member);
    if (part_pending) outside.add(part_pending);

    for (const id of datasets)
        if (!outside.has(id)) site.add_member(Class.Dataset, id);

    /* Every seventh has no General information entry, and one has an
     * entry with no name. */
    const unnamed = [];
    let nameless = null;
    others.forEach((id, i) => {
        if (i % 7 == 3) {
            unnamed.push(id);
        }
        else if (i == 5) {
            nameless = id;
            site.put(UUIDs.App.Info, id, { deleted: false });
        }
        else {
            site.put(UUIDs.App.Info, id, { name: `Dataset ${i + 1}` });
        }
    });

    /* Parts: a dataset's subclasses that are Dataset members. */
    const part_pool = [...kinds.subset, ...kinds.metrics];
    const parents = [];
    if (part_parent) {
        site.set_subclasses(part_parent,
            [kinds.subset[0], part_pending].filter(x => x));
        parents.push(part_parent);
    }
    kinds.sparkplug.forEach((id, i) => {
        if (i == 0 || i % 5 != 2 || !part_pool.length) return;
        const parts = new Set([pick(part_pool), pick(part_pool)]);
        /* A subclass that is no dataset at all. */
        if (i % 10 == 2) parts.add(uuid("spare", i));
        site.set_subclasses(id, parts);
        parents.push(id);
    });

    /* Kinds. Default datasets have none. */
    kinds.sessions.forEach((id, i) => {
        if (i % 2 == 0) site.add_member(Kind.Run, id);
    });
    kinds.sparkplug.forEach((id, i) => {
        if (i % 3 == 1) site.add_member(Kind.Equipment, id);
    });
    if (kinds.unions.length) site.add_member(Class.Published, kinds.unions[0]);

    /* Metadata. Some datasets have entries in two applications. */
    others.forEach((id, i) => {
        if (i % 3 == 0)
            site.put(Metadata.Tags, id, { tags: [`tag-${i % 4}`, "shared"] });
    });
    kinds.sessions.forEach((id, i) => {
        if (i % 2 == 0)
            site.put(Metadata.RunMetadata, id, { run: i + 1, operator: `Operator ${i % 3}` });
        if (i % 4 == 0)
            site.put(EXTRA_METADATA_APP, id, { note: `Session ${i + 1}` });
    });
    kinds.sparkplug.forEach((id, i) => {
        if (i % 4 == 0)
            site.put(Metadata.EquipmentLabels, id, { labels: { [pick(devices)]: `Label ${i}` } });
    });

    /* General information for objects that are not datasets. */
    const fillers = [];
    const have = site.app(UUIDs.App.Info).size;
    for (let i = 0; have + i < (opts.infos ?? 0); i++) {
        const id = uuid("filler", i + 1);
        fillers.push(id);
        site.put(UUIDs.App.Info, id, { name: `Object ${i + 1}` });
    }
    /* Metadata for an object that is not a dataset. */
    if (fillers.length)
        site.put(Metadata.Tags, fillers[0], { tags: ["not-a-dataset"] });

    /* ---- Principals ---- */

    site.set_acl(PRINCIPALS.wild, [
        Perm.ReadDataset, Perm.EditDataset, Perm.IncludeInUnion, Perm.UseForSession,
    ].map(permission => ({ permission, target: UUIDs.Special.Null })));

    const some = [];
    const give = (permission, target) => {
        if (!some.some(e => e.permission == permission && e.target == target))
            some.push({ permission, target });
    };
    for (const id of others) {
        if (rand() < 0.4) give(Perm.ReadDataset, id);
        if (rand() < 0.25) give(Perm.EditDataset, id);
        if (rand() < 0.3) give(Perm.IncludeInUnion, id);
        if (rand() < 0.3) give(Perm.UseForSession, id);
    }
    /* UseDevice on every second device, which reaches the default
     * dataset of each one that has one. */
    devices.forEach((device, i) => {
        if (i % 2 == 0) give(Perm.UseDevice, device);
    });
    /* The datasets tests look at closely are always readable. */
    for (const id of [part_parent, part_pending, not_member, ...chain]) {
        if (!id) continue;
        give(Perm.ReadDataset, id);
    }
    if (part_parent) give(Perm.EditDataset, part_parent);
    site.set_acl(PRINCIPALS.some, some);
    site.set_acl(PRINCIPALS.none, []);

    return {
        seed,
        principals: PRINCIPALS,
        node,
        devices, placed, unplaced, spare_devices,
        /* Every dataset with a structure entry, in the order made. */
        datasets,
        /* The default datasets, as { device, dataset }. */
        defaults,
        /* The datasets of each kind. */
        kinds,
        /* Datasets with something particular about them; any can be
         * null on a site too small to hold it. */
        named: {
            chain, empty_union, not_member, part_parent, part_pending, nameless,
        },
        unnamed,
        /* Datasets with a subclass list. */
        parents,
        /* Objects with General information that are not datasets. */
        fillers,
        /* Mint a UUID no object on the site has. */
        spare: n => uuid("spare", 0x1000 + n),
        /* What each principal should see, as built. */
        expected: Object.fromEntries(Object.values(PRINCIPALS)
            .map(p => [p, expected_visible(site, p)])),
    };
}

/** The dataset map the site's structure entries give, worked out by
 * the whole-map reference algorithm. */
export function site_datasets (site) {
    const entries = [...site.members(App.DatasetDefinition)]
        .map(app => [app, site.app(app)]);
    return reference_datasets(reference_group(entries));
}

/** The datasets a principal should see, from the site's state.
 *
 * The rule: root or a grant on the Null UUID allows everything. A
 * grant on the dataset allows it. UseDevice on a device allows its
 * default dataset, for reading, unions, sessions and the structure,
 * while that dataset is valid. Reading the structure needs EditDataset
 * in place of a grant of its own.
 *
 * @returns `{ metadata, structure, union_sources, session_sources }`,
 * each a sorted array of dataset UUIDs, or null for a principal Auth
 * does not know. The structure list includes invalid datasets; the
 * others do not.
 */
export function expected_visible (site, principal) {
    const root = principal == site.auth.root_principal;
    const acl = site.acl(principal);
    if (!root && !acl) return null;

    const has = (permission, target) => root || acl.some(e =>
        e.permission == permission
        && (e.target == target || e.target == UUIDs.Special.Null));

    const allowed = (permission, uuid, entry) => {
        const structure = permission == READ_STRUCTURE;
        if (has(structure ? Perm.EditDataset : permission, uuid)) return true;
        if (!structure && !DEVICE_PERMS.has(permission)) return false;
        const device = default_dataset_device(uuid, entry);
        return device != null && has(Perm.UseDevice, device);
    };

    const datasets = [...site_datasets(site)];
    const list = (permission, valid_only) => datasets
        .filter(([uuid, entry]) =>
            (!valid_only || entry.structure != Special.InvalidDataset)
            && allowed(permission, uuid, entry))
        .map(([uuid]) => uuid)
        .sort();

    return {
        metadata:           list(Perm.ReadDataset, true),
        structure:          list(READ_STRUCTURE, false),
        union_sources:      list(Perm.IncludeInUnion, true),
        session_sources:    list(Perm.UseForSession, true),
    };
}
