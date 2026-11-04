/*
 * Factory+ NodeJS Utilities
 * ISA-95 hierarchy: the UNS rule, the placement renderer and the
 * Edge Agent config merge
 * Copyright 2026 University of Sheffield AMRC
 *
 * Every device has a placement: one ISA-95 vocabulary node, stored in
 * the ISA-95 Placement app. The placement is rendered into Edge Agent
 * config tags at `Device_Information/ISA95_Hierarchy`, so the device
 * births its hierarchy there. The UNS ingester, i3X and the admin UI
 * all decide whether a device is on the UNS with the one rule here.
 *
 * Everything in this file is pure: no service calls, no I/O.
 */

import { Schema } from "./uuids.js";
import { metric_instance_uuid } from "./uuid-v5.js";

/** The ISA-95 levels, top first. These are the Hierarchy-v1 metric
 * names; the last two contain spaces. */
export const ISA95_LEVELS = Object.freeze([
    "Enterprise", "Site", "Area", "Work Center", "Work Unit",
]);

/** The one place a device's hierarchy counts. */
export const ISA95_HIERARCHY_PATH = "Device_Information/ISA95_Hierarchy";

const DEVICE_INFORMATION_PATH = "Device_Information";
const HIERARCHY_SCHEMA = Schema.ISA95_Hierarchy;

/** Why a level value cannot go in a UNS topic, or null if it can.
 * A value must be non-empty after trimming. MQTT topic names cannot
 * hold `+`, `#` or NUL; consumers split topics on `/`; historian-uns
 * finds the end of the ISA-95 segments by looking for `Edge`.
 * @arg value A level value, already trimmed.
 */
export function isa95_value_problem (value) {
    if (typeof value != "string" || value == "")
        return "is empty";
    if (/[/+#\0]/.test(value))
        return "contains /, +, # or NUL";
    if (value == "Edge")
        return "is the reserved word Edge";
    return null;
}

/** Can this level value go in a UNS topic? */
export function isa95_value_ok (value) {
    return isa95_value_problem(value) == null;
}

const trim = v => v == null ? "" : String(v).trim();

/** The UNS segments from the raw values of the five levels.
 * Values are trimmed. Reading stops at the first empty level. Returns
 * null when Enterprise is empty, or when any value read is not safe in
 * a topic: such a device is left off the UNS rather than published
 * at a shorter path than it asked for.
 * @arg values Five raw level values, Enterprise first.
 * @returns An array of 1 to 5 strings, or null.
 */
export function isa95_segments_from_values (values) {
    const segments = [];
    for (const raw of values) {
        const v = trim(raw);
        if (v == "") break;
        if (!isa95_value_ok(v)) return null;
        segments.push(v);
    }
    return segments.length ? segments : null;
}

/** The raw level values of a Hierarchy-v1 origin map object. */
export function hierarchy_values (obj) {
    return ISA95_LEVELS.map(l => obj?.[l]?.Value ?? obj?.[l]?.value);
}

function is_hierarchy_object (obj) {
    return obj != null && typeof obj == "object"
        && obj.Schema_UUID == HIERARCHY_SCHEMA;
}

/** The UNS segments of a device, from an origin map.
 * Only a Hierarchy-v1 object at exactly
 * `Device_Information/ISA95_Hierarchy` counts.
 * @arg origin_map A device's origin map (or anything shaped like one).
 * @returns An array of segments, or null if the device is not on the UNS.
 */
export function isa95_segments (origin_map) {
    const h = origin_map?.Device_Information?.ISA95_Hierarchy;
    if (!is_hierarchy_object(h)) return null;
    return isa95_segments_from_values(hierarchy_values(h));
}

/** Does this origin map put the device on the UNS? */
export function is_uns_hierarchy (origin_map) {
    return isa95_segments(origin_map) != null;
}

/** The UNS segments of a device, from the metrics of its birth.
 * The same rule as `isa95_segments`, for a list of Sparkplug metrics:
 * the metric `Device_Information/ISA95_Hierarchy/Schema_UUID` must
 * hold the Hierarchy-v1 UUID.
 * @arg metrics An iterable of `{ name, value }`.
 * @returns An array of segments, or null.
 */
export function isa95_segments_from_metrics (metrics) {
    const by_name = new Map();
    for (const m of metrics ?? []) by_name.set(m.name, m.value);

    if (by_name.get(`${ISA95_HIERARCHY_PATH}/Schema_UUID`) != HIERARCHY_SCHEMA)
        return null;
    return isa95_segments_from_values(
        ISA95_LEVELS.map(l => by_name.get(`${ISA95_HIERARCHY_PATH}/${l}`)));
}

/** Find every Hierarchy-v1 object in an origin map, wherever it is.
 * Returns them in the order a depth-first walk meets them, which is
 * the order of their metrics in the birth certificate.
 * @arg origin_map A device's origin map.
 * @returns An array of `{ path, hierarchy }`.
 */
export function find_isa95_hierarchies (origin_map) {
    const found = [];
    const walk = (obj, path) => {
        if (obj == null || typeof obj != "object" || Array.isArray(obj))
            return;
        if (path && is_hierarchy_object(obj))
            found.push({ path, hierarchy: obj });
        for (const [k, v] of Object.entries(obj)) {
            if (k == "Schema_UUID" || k == "Instance_UUID") continue;
            walk(v, path ? `${path}/${k}` : k);
        }
    };
    walk(origin_map, "");
    return found;
}

const fold = s => trim(s).toLowerCase();

/** Index a set of vocabulary nodes.
 * @arg nodes An iterable of `{ uuid, name, level, aliases, children }`,
 * where `level` is one of `ISA95_LEVELS` and `children` lists the UUIDs
 * of the nodes below.
 * @returns An object for the other vocabulary functions here.
 */
export function isa95_vocabulary (nodes) {
    const by_uuid = new Map();
    const parents = new Map();
    for (const n of nodes) {
        by_uuid.set(n.uuid, {
            uuid:       n.uuid,
            name:       n.name ?? n.uuid,
            level:      n.level,
            aliases:    Array.isArray(n.aliases) ? n.aliases : [],
            children:   Array.isArray(n.children) ? n.children : [],
        });
    }
    for (const n of by_uuid.values()) {
        for (const c of n.children) {
            if (!parents.has(c)) parents.set(c, []);
            parents.get(c).push(n.uuid);
        }
    }
    return { nodes: by_uuid, parents };
}

/** The chain from a node's Enterprise down to the node.
 * Walks up the vocabulary. Every node on the way must have exactly one
 * parent, one level up; the top must be an Enterprise.
 * @arg vocab From `isa95_vocabulary`.
 * @arg node The UUID of the node.
 * @returns `{ chain }`, an array of nodes Enterprise first, or `{ error }`.
 */
export function isa95_chain (vocab, node) {
    const chain = [];
    let uuid = node;
    for (;;) {
        const n = vocab.nodes.get(uuid);
        if (!n)
            return { error: `${uuid} is not an ISA-95 vocabulary node` };
        const ix = ISA95_LEVELS.indexOf(n.level);
        if (ix < 0)
            return { error: `${n.name} has no ISA-95 level` };
        if (chain.length && ISA95_LEVELS.indexOf(chain[0].level) != ix + 1)
            return { error: `${chain[0].name} is not directly under ${n.name}: the chain skips a level` };
        chain.unshift(n);

        const ps = vocab.parents.get(uuid) ?? [];
        if (ps.length > 1)
            return { error: `${n.name} has more than one parent` };
        if (ix == 0) {
            if (ps.length)
                return { error: `Enterprise ${n.name} has a parent` };
            return { chain };
        }
        if (!ps.length)
            return { error: `${n.name} has no ${ISA95_LEVELS[ix - 1]} above it` };
        uuid = ps[0];
    }
}

/** Every node at or under a node. */
export function isa95_subtree (vocab, node) {
    const out = new Set();
    const walk = u => {
        if (out.has(u)) return;
        out.add(u);
        for (const c of vocab.nodes.get(u)?.children ?? []) walk(c);
    };
    walk(node);
    return out;
}

/** Match hierarchy names to vocabulary nodes, one level at a time.
 * At the top a name matches an Enterprise; below that, a child of the
 * node matched above at the next level. A name matches a node's name
 * or one of its aliases, trimmed and ignoring case. Matching stops at
 * the first name that matches nothing.
 * @arg vocab From `isa95_vocabulary`.
 * @arg names Level names, Enterprise first.
 * @returns The UUIDs of the matched nodes, top first. This is shorter
 * than `names` when a name did not match.
 */
export function isa95_resolve (vocab, names) {
    const matched = [];
    let scope = [...vocab.nodes.values()]
        .filter(n => n.level == ISA95_LEVELS[0]);
    for (let i = 0; i < names.length; i++) {
        const want = fold(names[i]);
        const n = scope.find(n => n.level == ISA95_LEVELS[i]
            && (fold(n.name) == want || n.aliases.some(a => fold(a) == want)));
        if (!n) break;
        matched.push(n.uuid);
        scope = n.children
            .map(c => vocab.nodes.get(c))
            .filter(c => c);
    }
    return matched;
}

function uuid_tag (name, value, docs) {
    return {
        Name:       name,
        type:       "UUID",
        method:     "GET",
        value,
        docs,
        recordToDB: true,
    };
}

/** Render a placement as Edge Agent config tags.
 *
 * The tags are the `Device_Information/ISA95_Hierarchy` object: its
 * Schema_UUID, its Instance_UUID and one String metric per level down
 * to the placed node, not recorded to the historian. The same input
 * always gives the same tags.
 *
 * The Instance_UUID comes from `placement.instances` when present, so
 * a device keeps the instance it had before it was placed; otherwise
 * it is the v5 UUID acs-edge would mint for that device and path.
 *
 * `stamp` holds `Device_Information/Schema_UUID` and `Instance_UUID`
 * tags; `merge_isa95_tags` adds them only if the device has none.
 *
 * @arg placement A placement config, `{ node, instances? }`.
 * @arg vocab From `isa95_vocabulary`.
 * @arg device The device UUID.
 * @returns `{ node, segments, tags, stamp }`, or `{ error }`.
 */
export function render_isa95 (placement, vocab, device) {
    if (!placement?.node)
        return { error: "no placement" };
    const { chain, error } = isa95_chain(vocab, placement.node);
    if (error) return { error };

    const segments = chain.map(n => trim(n.name));
    for (const [i, s] of segments.entries()) {
        const problem = isa95_value_problem(s);
        if (problem)
            return { error: `${ISA95_LEVELS[i]} "${s}" ${problem}` };
    }

    const instances = placement.instances ?? {};
    const instance = path => instances[path] ?? metric_instance_uuid(device, path);
    const P = ISA95_HIERARCHY_PATH;

    const tags = [
        uuid_tag(`${P}/Schema_UUID`, HIERARCHY_SCHEMA,
            "A reference to the schema used for this object."),
        uuid_tag(`${P}/Instance_UUID`, instance(P),
            "A reference to the instance of this object."),
        ...segments.map((value, i) => ({
            Name:       `${P}/${ISA95_LEVELS[i]}`,
            type:       "String",
            method:     "GET",
            value,
            recordToDB: false,
        })),
    ];
    const D = DEVICE_INFORMATION_PATH;
    const stamp = [
        uuid_tag(`${D}/Schema_UUID`, Schema.Device_Information,
            "A reference to the schema used for this object."),
        uuid_tag(`${D}/Instance_UUID`, instance(D),
            "A reference to the instance of this object."),
    ];

    return { node: placement.node, segments, tags, stamp };
}

/** Is this tag part of an ISA-95 hierarchy, anywhere in the device? */
export function is_isa95_tag (tag) {
    return typeof tag?.Name == "string" && tag.Name.includes("ISA95_Hierarchy");
}

/** Merge a rendered placement into a device's tags.
 * Removes every tag whose name contains `ISA95_Hierarchy`, wherever it
 * is (including hand-set and nested ones), then adds the rendered
 * tags. Adds the `Device_Information` stamp tags only where the device
 * has no tag of that name. With no rendering, only removes.
 * @arg tags The device's current tags.
 * @arg rendered From `render_isa95`, or null.
 * @returns A new array of tags.
 */
export function merge_isa95_tags (tags, rendered) {
    const out = (tags ?? []).filter(t => !is_isa95_tag(t));
    if (!rendered?.tags) return out;

    const names = new Set(out.map(t => t.Name));
    for (const t of rendered.stamp ?? [])
        if (!names.has(t.Name)) out.push({ ...t });
    for (const t of rendered.tags)
        out.push({ ...t });
    return out;
}

/** The device entries in an Edge Agent config for a device.
 * A device entry is found by its `Instance_UUID` tag, whose value is
 * the device UUID, never by name.
 * @arg config An Edge Agent config.
 * @arg device The device UUID.
 * @returns An array of device entries (normally one), as found in the
 * config.
 */
export function find_device_entries (config, device) {
    const out = [];
    for (const conn of config?.deviceConnections ?? []) {
        for (const dev of conn?.devices ?? []) {
            const tag = (dev?.tags ?? []).find(t => t?.Name == "Instance_UUID");
            if (tag?.value == device) out.push(dev);
        }
    }
    return out;
}

/** Apply a rendered placement to one device in an Edge Agent config.
 * The config is not changed; a copy is returned when anything changes.
 * @arg config An Edge Agent config.
 * @arg device The device UUID.
 * @arg rendered From `render_isa95`, or null to remove the hierarchy.
 * @returns `{ found, changed, config }`: `found` counts the device's
 * entries, and `config` is the new config.
 */
export function patch_isa95 (config, device, rendered) {
    const copy = structuredClone(config ?? {});
    const entries = find_device_entries(copy, device);
    let changed = false;
    for (const dev of entries) {
        const tags = merge_isa95_tags(dev.tags, rendered);
        if (JSON.stringify(tags) != JSON.stringify(dev.tags ?? [])) {
            dev.tags = tags;
            changed = true;
        }
    }
    return { found: entries.length, changed, config: changed ? copy : config };
}
