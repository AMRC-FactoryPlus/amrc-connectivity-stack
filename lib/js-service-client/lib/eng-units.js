/*
 * Factory+ NodeJS Utilities
 * Engineering units: UUIDs and labels
 * Copyright 2026 University of Sheffield AMRC
 *
 * Each engineering unit is a ConfigDB object of the EngineeringUnit
 * class. Its EngineeringUnit config holds its UNECE Recommendation 20
 * code, the symbol a metric's Eng_Unit is written with, and aliases
 * that also mean it:
 *
 *   { "code": "KWH", "symbol": "kW·h", "aliases": ["kWh"] }
 *
 * The full UNECE table is in unece-units.js, which is imported by path
 * to keep it out of browser bundles that don't need it.
 */

import { Special } from "./uuids.js";
import { uuid_v5 } from "./uuid-v5.js";

/** The UUID of the engineering unit with a UNECE code.
 * A unit's object always has this UUID, so the same unit has the same
 * UUID on every install, and there is at most one unit per code.
 * @arg code A UNECE Recommendation 20 common code, e.g. `KWH`.
 */
export function eng_unit_uuid (code) {
    return uuid_v5([Special.V5EngineeringUnit, code].join(":"),
        Special.FactoryPlus);
}

/** The strings that mean a unit: its symbol, then its aliases.
 * @arg unit An EngineeringUnit config.
 */
export function eng_unit_labels (unit) {
    return [unit.symbol, ...(unit.aliases ?? [])];
}
