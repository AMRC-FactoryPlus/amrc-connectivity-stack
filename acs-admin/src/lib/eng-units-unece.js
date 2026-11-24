/*
 * ACS Admin
 * Engineering units: searching the UNECE table and suggesting units
 * Copyright 2026 University of Sheffield AMRC
 *
 * This loads the whole UNECE table (about 1,800 units), so only the
 * Units page and its dialogs import it.
 */

import {
  unece_match, unece_symbol, unece_unit,
} from '@amrc-factoryplus/service-client/lib/unece.js'
import { UNECE_UNITS } from '@amrc-factoryplus/service-client/lib/unece-units.js'

import { unit_config } from './eng-units.js'

export { unece_symbol, unece_unit }

const ROWS = UNECE_UNITS.map(([code, symbol, name]) => ({ code, symbol, name }))

/** UNECE units for search text, best first: the unit the text most
 * likely means, a code, then symbols and names that start with the
 * text, then ones that contain it. */
export function search_unece (text, limit = 50) {
  const t = (text ?? '').trim()
  if (!t) return []
  const lower = t.toLowerCase()
  const out = []
  const seen = new Set()
  const add = u => {
    if (!u || seen.has(u.code) || out.length >= limit) return
    seen.add(u.code)
    out.push(u)
  }
  add(unece_match(t))
  add(unece_unit(t.toUpperCase()))
  for (const u of ROWS)
    if (u.symbol === t) add(u)
  for (const u of ROWS)
    if (u.symbol.toLowerCase().startsWith(lower) || u.name.toLowerCase().startsWith(lower)) add(u)
  for (const u of ROWS)
    if (u.symbol.toLowerCase().includes(lower) || u.name.toLowerCase().includes(lower)) add(u)
  return out
}

/** What to do with a string in use that no unit means:
 *  - `{kind: 'alias', unit, match}`: it is a way of writing a unit in
 *    the vocabulary, so add it as an alias of that unit;
 *  - `{kind: 'create', match, config, name}`: it is a UNECE unit not in
 *    the vocabulary, so create the unit, written the way it is used;
 *  - null: it is not recognised.
 * @arg units The units in the vocabulary. */
export function suggest_for (string, units) {
  const match = unece_match(string)
  if (!match) return null
  const unit = units.find(u => u.code === match.code)
  if (unit) return { kind: 'alias', unit, match }
  return {
    kind:   'create',
    match,
    config: unit_config(match.code, string, [unece_symbol(match.code)]),
    name:   match.name,
  }
}
