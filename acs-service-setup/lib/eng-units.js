/*
 * ACS service setup
 * Seed the engineering unit vocabulary
 * Copyright 2026 University of Sheffield AMRC
 *
 * Metrics give their unit as a free-text Eng_Unit string, and the
 * historians tag each series with it. The vocabulary says which unit a
 * string means. This step fills the vocabulary from what is in use:
 *
 *  - every Eng_Unit in an origin map, and every Eng_Unit default in a
 *    schema, that the vocabulary does not resolve yet and that is a
 *    recognised way of writing a UNECE unit (see unece_match) becomes
 *    a unit, or an alias of the unit with that code if there is one;
 *  - a new unit's symbol is the string most used for it here, so the
 *    Manager UI writes new metrics the way existing ones are written
 *    and their series keep one unit tag; the OPC UA name is an alias;
 *  - an empty vocabulary also gets a common set of units.
 *
 * Strings that are not recognised are logged, with how often they are
 * used, for an administrator to fix or add by hand. This never writes
 * an origin map or a schema. It runs on every upgrade; a second run
 * finds nothing to do.
 */

import {
    UUIDs, eng_unit_labels, eng_unit_uuid,
} from "@amrc-factoryplus/service-client";
import { unece_match, unece_unit } from "@amrc-factoryplus/service-client/lib/unece.js";

const { App, Class } = UUIDs;

/* Units an empty vocabulary starts with, by UNECE code: the ones
 * shop-floor and energy metrics use most. */
export const COMMON_UNITS = [
    /* Electrical */
    "VLT", "KVT", "AMP", "4K", "WTT", "KWT", "MAW", "WHR", "KWH", "MWH",
    "D46", "KVA", "C79", "KVR", "K3", "HTZ", "OHM",
    /* Temperature */
    "CEL", "KEL", "FAH",
    /* Time */
    "C26", "SEC", "MIN", "HUR", "DAY",
    /* Length, area, volume */
    "4H", "MMT", "CMT", "MTR", "KMT", "MTK", "MLT", "LTR", "MTQ",
    /* Flow */
    "L2", "MQH", "MQS",
    /* Mass */
    "GRM", "KGM", "TNE",
    /* Pressure */
    "PAL", "KPA", "MBR", "BAR", "PS",
    /* Motion */
    "MTS", "KMH", "MSK", "M46", "DD", "C81",
    /* Force, torque, energy */
    "NEW", "NU", "JOU", "KJO",
    /* Ratios and others */
    "P1", "59", "2N", "LUX",
];

/* Units whose OPC UA display name is not how anyone writes them. */
const SYMBOLS = {
    "P1":   "%",            /* shown as "% or pct" */
};

/* How a unit is written by default: its OPC UA display name, unless
 * that is not a usable symbol. */
function default_symbol (code) {
    return SYMBOLS[code] ?? unece_unit(code).symbol;
}

function count (counts, str) {
    if (typeof str != "string" || str.trim() == "") return;
    const s = str.trim();
    counts.set(s, (counts.get(s) ?? 0) + 1);
}

/** Add every Eng_Unit string in an origin map to `counts`, by the
 * number of metrics using it. */
export function origin_map_units (origin_map, counts = new Map()) {
    if (origin_map == null || typeof origin_map != "object") return counts;
    for (const [k, v] of Object.entries(origin_map)) {
        if (k == "Eng_Unit") count(counts, v);
        else origin_map_units(v, counts);
    }
    return counts;
}

/** Add every Eng_Unit default in a JSON schema to `counts`. */
export function schema_units (schema, counts = new Map()) {
    if (schema == null || typeof schema != "object") return counts;
    for (const [k, v] of Object.entries(schema)) {
        if (k == "Eng_Unit" && v && typeof v == "object") {
            count(counts, v.default);
            count(counts, v.const);
        }
        schema_units(v, counts);
    }
    return counts;
}

/**
 * Work out what to add to the vocabulary.
 * @arg existing The units there are, as a Map from UUID to config.
 * @arg in_use The unit strings in use, as a Map to how often.
 * @arg seed_common Add the common units too.
 * @returns `units`, the vocabulary after the changes (UUID to config);
 * `created`, the UUIDs of new units, with their names in `names`;
 * `changed`, the UUIDs of existing units that gained aliases; and
 * `unresolved`, the strings that are not recognised, with how often
 * each is used.
 */
export function plan_units (existing, in_use, seed_common) {
    const units = new Map([...existing].map(([uuid, u]) => [uuid, structuredClone(u)]));
    const labels = new Map();
    for (const [uuid, u] of units)
        for (const l of eng_unit_labels(u)) labels.set(l, uuid);
    const claim = (uuid, label) => {
        if (labels.has(label)) return false;
        labels.set(label, uuid);
        return true;
    };

    /* The strings the vocabulary does not resolve yet, by the code
     * they are recognised as, most used first. */
    const by_code = new Map();
    const unresolved = [];
    const sorted = [...in_use].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1));
    for (const [str, n] of sorted) {
        if (labels.has(str)) continue;
        const match = unece_match(str);
        if (!match) {
            unresolved.push([str, n]);
            continue;
        }
        by_code.set(match.code, [...(by_code.get(match.code) ?? []), str]);
    }

    const created = [];
    const changed = new Set();
    const names = new Map();
    const create = (code, symbol, others) => {
        const uuid = eng_unit_uuid(code);
        claim(uuid, symbol);
        const aliases = others.filter(s => claim(uuid, s));
        units.set(uuid, { code, symbol, ...(aliases.length ? { aliases } : {}) });
        names.set(uuid, unece_unit(code).name);
        created.push(uuid);
    };

    for (const [code, strs] of by_code) {
        const uuid = eng_unit_uuid(code);
        const unit = units.get(uuid);
        if (unit) {
            const added = strs.filter(s => claim(uuid, s));
            if (added.length) {
                unit.aliases = [...(unit.aliases ?? []), ...added];
                changed.add(uuid);
            }
        }
        else
            create(code, strs[0], [...strs.slice(1), default_symbol(code)]);
    }

    if (seed_common) {
        for (const code of COMMON_UNITS) {
            if (units.has(eng_unit_uuid(code))) continue;
            const symbol = default_symbol(code);
            /* Already the label of a unit made from what is in use. */
            if (labels.has(symbol)) continue;
            create(code, symbol, []);
        }
    }

    return { units, created, changed: [...changed], names, unresolved };
}

export class MigrateEngUnits {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.log ?? opts.fplus.debug.bound("eng-units");
    }

    async run () {
        const { cdb } = this;

        const existing = await cdb.get_all_configs(App.EngineeringUnit) ?? new Map();
        const in_use = new Map();
        const devices = await cdb.get_all_configs(App.DeviceInformation) ?? new Map();
        for (const info of devices.values())
            origin_map_units(info?.originMap, in_use);
        const schemas = await cdb.get_all_configs(App.Schema) ?? new Map();
        for (const schema of schemas.values())
            schema_units(schema, in_use);

        const plan = plan_units(existing, in_use, existing.size == 0);

        let failed = 0;
        for (const uuid of plan.created) {
            const unit = plan.units.get(uuid);
            try {
                await cdb.create_object(Class.EngineeringUnit, uuid);
                await cdb.put_config(App.Info, uuid, { name: plan.names.get(uuid) });
                await cdb.put_config(App.EngineeringUnit, uuid, unit);
                this.log("Created unit %s %s (%s)", unit.code, unit.symbol, uuid);
            }
            catch (e) {
                this.log("Can't create unit %s: %s", unit.code, e);
                failed++;
            }
        }
        for (const uuid of plan.changed) {
            const unit = plan.units.get(uuid);
            try {
                await cdb.put_config(App.EngineeringUnit, uuid, unit);
                this.log("Unit %s now also means %s", unit.code, unit.aliases.join(", "));
            }
            catch (e) {
                this.log("Can't add aliases to unit %s: %s", unit.code, e);
                failed++;
            }
        }

        const unresolved = plan.unresolved
            .map(([s, n]) => `${JSON.stringify(s)} (${n})`).join(", ");
        this.log("Engineering units: %d existing, %d unit strings in use, %d units created, %d given aliases, %d failed, %d strings not recognised%s",
            existing.size, in_use.size, plan.created.length, plan.changed.length,
            failed, plan.unresolved.length, unresolved ? `: ${unresolved}` : "");

        return {
            existing: existing.size, in_use: in_use.size,
            created: plan.created.length, changed: plan.changed.length,
            failed, unresolved: plan.unresolved,
        };
    }
}

export async function migrate_eng_units (ss) {
    return await new MigrateEngUnits({ fplus: ss.fplus }).run();
}
