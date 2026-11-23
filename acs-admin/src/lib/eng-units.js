/*
 * ACS Admin
 * Engineering units: what is in use, and the changes the Units page makes
 * Copyright 2026 University of Sheffield AMRC
 *
 * Metrics keep their Eng_Unit strings. The unit vocabulary in ConfigDB
 * says which unit each string means: a unit's symbol or one of its
 * aliases. Everything here but the writers at the end is pure, so it
 * can be tested without a browser. Searching the UNECE table is in
 * eng-units-unece.js, which loads the table; keep this file free of it
 * so pages that only resolve units stay small.
 */

import {
  UUIDs, eng_unit_labels, eng_unit_resolver, eng_unit_uuid, origin_map_units,
} from '@amrc-factoryplus/service-client'

/** Every Eng_Unit string the devices use, as a Map to how many
 * metrics use it and on which devices.
 * @arg devices Device store entries, with `deviceInformation`. */
export function unit_usage (devices) {
  const usage = new Map()
  for (const d of devices ?? []) {
    for (const [str, n] of origin_map_units(d.deviceInformation?.originMap)) {
      const u = usage.get(str) ?? { metrics: 0, devices: new Set() }
      u.metrics += n
      u.devices.add(d.uuid)
      usage.set(str, u)
    }
  }
  return usage
}

/** The units table: each unit with the number of metrics and devices
 * whose Eng_Unit is one of its labels. */
export function unit_rows (units, usage) {
  return units.map(u => {
    const devices = new Set()
    let metrics = 0
    for (const label of eng_unit_labels(u)) {
      const use = usage.get(label)
      if (!use) continue
      metrics += use.metrics
      use.devices.forEach(d => devices.add(d))
    }
    return { ...u, aliases: u.aliases ?? [], metrics, devices: devices.size }
  })
}

/** The strings in use that no unit means, most used first. */
export function unknown_units (units, usage) {
  const resolve = eng_unit_resolver(units)
  return [...usage]
    .filter(([str]) => !resolve(str))
    .map(([string, u]) => ({ string, metrics: u.metrics, devices: u.devices.size }))
    .sort((a, b) => b.metrics - a.metrics || a.string.localeCompare(b.string))
}

/** A unit's config from form fields: trimmed, without empty or
 * repeated aliases, and without the symbol among the aliases. */
export function unit_config (code, symbol, aliases) {
  const s = (symbol ?? '').trim()
  const as = [...new Set((aliases ?? []).map(a => a.trim()))]
    .filter(a => a !== '' && a !== s)
  return { code, symbol: s, ...(as.length ? { aliases: as } : {}) }
}

/** The labels of a unit config that already mean another unit, which
 * ConfigDB would refuse, as `{label, unit}`. */
export function label_clashes (units, config) {
  const mine = eng_unit_labels(config)
  return units
    .filter(u => u.code !== config.code)
    .flatMap(u => eng_unit_labels(u)
      .filter(l => mine.includes(l))
      .map(label => ({ label, unit: u })))
}

/** The config of `into` once `from` is merged into it: `from`'s symbol
 * and aliases become aliases of `into`, so metrics written either way
 * still resolve. */
export function merged_unit (from, into) {
  return unit_config(into.code, into.symbol,
    [...(into.aliases ?? []), from.symbol, ...(from.aliases ?? [])])
}

/** The config of `unit` with one more alias. */
export function with_alias (unit, alias) {
  return unit_config(unit.code, unit.symbol, [...(unit.aliases ?? []), alias])
}

/** Write a unit: its object, whose UUID comes from its code, its name
 * and its config. Returns its UUID.
 * @arg cdb The ConfigDB client.
 * @arg config The unit's config, from unit_config.
 * @arg name The unit's name, for Info.
 * @arg create Create the object first. */
export async function save_unit (cdb, config, name, create) {
  const uuid = eng_unit_uuid(config.code)
  if (create) await cdb.create_object(UUIDs.Class.EngineeringUnit, uuid)
  await cdb.put_config(UUIDs.App.Info, uuid, { name })
  await cdb.put_config(UUIDs.App.EngineeringUnit, uuid, config)
  return uuid
}

/** Merge unit `from` into unit `into`, then delete `from`. ConfigDB
 * refuses a label two units share, so `from`'s config goes first; if
 * `into` cannot then be written, `from`'s config is put back. */
export async function merge_units (cdb, from, into) {
  const old = unit_config(from.code, from.symbol, from.aliases)
  await cdb.delete_config(UUIDs.App.EngineeringUnit, from.uuid)
  try {
    await cdb.put_config(UUIDs.App.EngineeringUnit, into.uuid, merged_unit(from, into))
  }
  catch (err) {
    await cdb.put_config(UUIDs.App.EngineeringUnit, from.uuid, old)
    throw err
  }
  await cdb.delete_object(from.uuid)
}
