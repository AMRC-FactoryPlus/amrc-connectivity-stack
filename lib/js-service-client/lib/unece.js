/*
 * Factory+ NodeJS Utilities
 * Look up UNECE units by code, and match unit strings to them
 * Copyright 2026 University of Sheffield AMRC
 *
 * This imports the whole UNECE table, so it is not exported from
 * index.js. Import it by its path. It is for adding units to the
 * engineering unit vocabulary; to read a metric's unit, resolve it
 * through the vocabulary with eng_unit_resolver (eng-units.js).
 */

import { UNECE_UNITS } from "./unece-units.js";

/* Display names the OPC UA table gives to more than one code, and the
 * code each means here. Where the table's description disagrees with
 * its display name (MAR is a megavar, shown as kvar), the code whose
 * description matches wins. */
const PREFERRED = {
    "rad":          "C81",  /* radian, not the rad of absorbed dose */
    "mil":          "77",   /* milli-inch (a thou), not the angle */
    "st":           "STI",  /* stone, not the stere */
    "cord":         "WCD",
    "r/min":        "M46",
    "gr":           "GRN",  /* grain, not a gross */
    "kgf·m/cm²":    "E44",
    "N·m/m²":       "M34",
    "MW":           "MAW",  /* megawatt, not module width */
    "MJ/m³":        "JM",
    "BtuIT/h":      "2I",
    "V":            "VLT",  /* volt, not volt AC or volt DC */
    "pH":           "Q30",  /* acidity, not the picohenry */
    "kvar":         "KVR",
};

/* Common ways of writing units that are neither an OPC UA display name
 * nor its ASCII form (see ascii_form), by the code they mean. */
const SPELLINGS = {
    "%":        "P1",
    "%RH":      "P1",
    "degC":     "CEL",
    "degF":     "FAH",
    "kVAR":     "KVR",
    "kVAr":     "KVR",
    "kVARh":    "K3",
    "kVArh":    "K3",
    "rpm":      "M46",
    "RPM":      "M46",
    "ohm":      "OHM",
    "Ohm":      "OHM",
};

/** A display name as it is often typed: no middle dots, and digits
 * and `u` in place of superscripts and micro (`kW·h` is `kWh`, `m³/h`
 * is `m3/h`, `µm` is `um`). */
export function ascii_form (symbol) {
    return symbol
        .replace(/·/g, "")
        .replace(/²/g, "2")
        .replace(/³/g, "3")
        .replace(/[µμ]/g, "u");
}

function unit_of (row) {
    return { code: row[0], symbol: row[1], name: row[2] };
}

const BY_CODE = new Map(UNECE_UNITS.map(r => [r[0], unit_of(r)]));

/* Index the rows by a key; where a key has several codes, keep only
 * the preferred one, or none. */
function index_by (key) {
    const all = new Map();
    for (const row of UNECE_UNITS) {
        const k = key(row[1]);
        all.set(k, [...(all.get(k) ?? []), row[0]]);
    }
    const preferred = new Map(Object.entries(PREFERRED)
        .map(([symbol, code]) => [key(symbol), code]));
    const out = new Map();
    for (const [k, codes] of all) {
        const code = codes.length == 1 ? codes[0] : preferred.get(k);
        if (code && codes.includes(code)) out.set(k, BY_CODE.get(code));
    }
    return out;
}

const BY_SYMBOL = index_by(s => s);
const BY_ASCII = index_by(ascii_form);

/** The UNECE unit with a code, as `{code, symbol, name}`, or
 * undefined. `symbol` is the OPC UA display name.
 * @arg code A UNECE Recommendation 20 common code, e.g. `KWH`.
 */
export function unece_unit (code) {
    return BY_CODE.get(code);
}

/** The UNECE unit a unit string most likely means, as
 * `{code, symbol, name}`, or undefined. It tries, in order: a common
 * spelling (`%`, `degC`, `kVAR`), an OPC UA display name (`kW·h`),
 * and the ASCII form of a display name (`kWh`). Case matters, as it
 * does for units (`mW`, `MW`). A string that could mean several units
 * matches none, unless one is preferred (`V` is the volt).
 * @arg str A unit string, e.g. a metric's Eng_Unit.
 */
export function unece_match (str) {
    if (typeof str != "string") return;
    const s = str.trim();
    if (s in SPELLINGS) return BY_CODE.get(SPELLINGS[s]);
    return BY_SYMBOL.get(s) ?? BY_ASCII.get(s);
}
