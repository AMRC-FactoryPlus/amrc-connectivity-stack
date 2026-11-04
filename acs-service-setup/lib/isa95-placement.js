/*
 * ACS service setup
 * Give every device an ISA-95 placement
 * Copyright 2026 University of Sheffield AMRC
 *
 * A device's ISA-95 position used to live in its origin map, typed in
 * by hand, sometimes at a nested path the UNS rule does not accept.
 * It now lives in the ISA-95 Placement app. This step fills that app
 * for every device that has no placement yet:
 *
 *  - from a valid hierarchy at Device_Information/ISA95_Hierarchy;
 *  - else from any Hierarchy-v1 object anywhere in the origin map
 *    (the last one found, which is the one the UNS ingester used);
 *  - else at the Enterprise named by the chart's acs.organisation.
 *
 * Names are matched to vocabulary nodes by name or alias, ignoring
 * case, level by level; missing nodes are created, since devices
 * already publish under these names. Existing Instance_UUIDs are
 * copied so history keys survive.
 *
 * This never writes an origin map and never replaces a placement. It
 * runs on every upgrade; a second run finds nothing to do.
 */

import {
    ISA95_HIERARCHY_PATH, ISA95_LEVELS, UUIDs,
    find_isa95_hierarchies, hierarchy_values, isa95_resolve,
    isa95_segments_from_values, isa95_value_problem, isa95_vocabulary,
} from "@amrc-factoryplus/service-client";

const { App, Class } = UUIDs;

export const LEVEL_CLASS = {
    "Enterprise":   Class.ISA95Enterprise,
    "Site":         Class.ISA95Site,
    "Area":         Class.ISA95Area,
    "Work Center":  Class.ISA95WorkCenter,
    "Work Unit":    Class.ISA95WorkUnit,
};

/* Choose the hierarchy to place a device from.
 * Returns undefined if the origin map has none with an Enterprise. */
export function pick_hierarchy (origin_map) {
    const found = find_isa95_hierarchies(origin_map)
        .filter(f => String(hierarchy_values(f.hierarchy)[0] ?? "").trim() != "");
    if (!found.length) return;

    const root = found.find(f => f.path == ISA95_HIERARCHY_PATH);
    return {
        ...(root ?? found.at(-1)),
        others: found.filter(f => f != (root ?? found.at(-1))).map(f => f.path),
    };
}

export class MigratePlacements {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.organisation = opts.organisation;
        this.log = opts.log ?? opts.fplus.debug.bound("isa95");
    }

    async run () {
        await this.load_vocabulary();

        const { cdb } = this;
        const placed = new Set(await cdb.list_configs(App.ISA95Placement) ?? []);
        const devices = await cdb.class_members(Class.Device);

        const count = {
            existing: 0, root: 0, nested: 0, organisation: 0,
            no_info: 0, skipped: 0, failed: 0,
        };
        for (const device of devices) {
            if (placed.has(device)) {
                count.existing++;
                continue;
            }
            const info = await cdb.get_config(App.DeviceInformation, device);
            /* Not an edge device: nothing renders it, so leave it. */
            if (!info) {
                count.no_info++;
                continue;
            }
            try {
                const how = await this.place(device, info.originMap);
                count[how]++;
            }
            catch (e) {
                this.log("Can't place device %s: %s", device, e);
                count.failed++;
            }
        }

        this.log("ISA-95 placements: %d already placed, %d from the root hierarchy, %d from a nested hierarchy, %d at the organisation, %d skipped, %d failed, %d nodes created, %d devices with no DeviceInformation",
            count.existing, count.root, count.nested, count.organisation,
            count.skipped, count.failed, this.created, count.no_info);
        return count;
    }

    async load_vocabulary () {
        const { cdb } = this;

        const vocab = await cdb.get_all_configs(App.ISA95Vocabulary) ?? new Map();
        this.configs = vocab;
        const nodes = [];
        for (const [level, klass] of Object.entries(LEVEL_CLASS)) {
            for (const uuid of await cdb.class_members(klass)) {
                const info = await cdb.get_config(App.Info, uuid);
                const v = vocab.get(uuid) ?? {};
                nodes.push({
                    uuid, level,
                    name:       info?.name ?? uuid,
                    aliases:    v.aliases ?? [],
                    children:   v.children ?? [],
                });
            }
        }
        this.nodes = nodes;
        this.vocab = isa95_vocabulary(nodes);
        this.created = 0;
    }

    /* Place one device. Returns how it was placed. */
    async place (device, origin_map) {
        const source = pick_hierarchy(origin_map);
        if (!source) {
            const node = await this.organisation_node();
            if (!node) return "skipped";
            await this.write(device, { node });
            return "organisation";
        }

        if (source.others.length)
            this.log("Device %s has more than one ISA-95 hierarchy; using %s, ignoring %s",
                device, source.path, source.others.join(", "));

        const names = isa95_segments_from_values(hierarchy_values(source.hierarchy));
        if (!names) {
            this.log("Device %s: the hierarchy at %s cannot be used in a UNS topic; not placing it",
                device, source.path);
            return "skipped";
        }

        const node = await this.ensure_path(names);
        const placement = { node };
        const instance = source.hierarchy.Instance_UUID;
        if (typeof instance == "string" && instance != "")
            placement.instances = { [ISA95_HIERARCHY_PATH]: instance };

        await this.write(device, placement);
        return source.path == ISA95_HIERARCHY_PATH ? "root" : "nested";
    }

    async organisation_node () {
        const org = String(this.organisation ?? "").trim();
        const problem = isa95_value_problem(org);
        if (problem) {
            if (!this.warned)
                this.log("The organisation %o %s; devices with no hierarchy are left unplaced",
                    this.organisation, problem);
            this.warned = true;
            return;
        }
        return this.ensure_path([org]);
    }

    async write (device, placement) {
        this.log("Placing device %s at %s", device, placement.node);
        await this.cdb.put_config(App.ISA95Placement, device, placement);
    }

    /* The node for a list of level names, creating what is missing. */
    async ensure_path (names) {
        const matched = isa95_resolve(this.vocab, names);
        let parent = matched.at(-1);
        for (let i = matched.length; i < names.length; i++)
            parent = await this.create_node(ISA95_LEVELS[i], names[i], parent);
        return parent;
    }

    async create_node (level, name, parent) {
        const { cdb } = this;

        const uuid = await cdb.create_object(LEVEL_CLASS[level]);
        await cdb.put_config(App.Info, uuid, { name });
        await cdb.put_config(App.ISA95Vocabulary, uuid, { aliases: [], children: [] });
        this.configs.set(uuid, { aliases: [], children: [] });
        this.nodes.push({ uuid, level, name, aliases: [], children: [] });

        if (parent) {
            const conf = this.configs.get(parent) ?? {};
            const next = {
                aliases:    conf.aliases ?? [],
                children:   [...(conf.children ?? []), uuid],
            };
            await cdb.put_config(App.ISA95Vocabulary, parent, next);
            this.configs.set(parent, next);
            this.nodes.find(n => n.uuid == parent).children = next.children;
        }

        this.vocab = isa95_vocabulary(this.nodes);
        this.created++;
        this.log("Created ISA-95 %s %s (%s)", level, name, uuid);
        return uuid;
    }
}

export async function migrate_isa95_placement (ss) {
    return await new MigratePlacements({
        fplus:          ss.fplus,
        organisation:   ss.acs_config.organisation,
    }).run();
}
