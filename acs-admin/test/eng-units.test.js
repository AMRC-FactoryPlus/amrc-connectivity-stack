/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Engineering units in the admin UI: usage, the units table, strings
 * no unit means, form configs, clashes, merges and suggestions.
 */

import { describe, it, expect } from 'vitest'

import { UUIDs, eng_unit_uuid } from '@amrc-factoryplus/service-client'

import {
  label_clashes, merge_units, merged_unit, save_unit, unit_config,
  unit_rows, unit_usage, unknown_units, with_alias,
} from '../src/lib/eng-units.js'
import { search_unece, suggest_for } from '../src/lib/eng-units-unece.js'

const metric = unit => ({ Sparkplug_Type: 'Double', Eng_Unit: unit })
const device = (uuid, originMap) => ({ uuid, deviceInformation: { originMap } })

const KWH = { uuid: eng_unit_uuid('KWH'), code: 'KWH', symbol: 'kWh', aliases: ['kW·h'], name: 'kilowatt hour' }
const CEL = { uuid: eng_unit_uuid('CEL'), code: 'CEL', symbol: '°C', aliases: [], name: 'degree Celsius' }
const UNITS = [KWH, CEL]

const DEVICES = [
  device('d1', { Energy: metric('kWh'), Temp: metric('°C'), Odd: metric('$.x') }),
  device('d2', { Energy: metric('kW·h'), Phases: { '1': { V: metric('V') }, '2': { V: metric('V') } } }),
  { uuid: 'd3' },
]

describe('usage', () => {
  it('counts metrics and devices per string', () => {
    const usage = unit_usage(DEVICES)
    expect(usage.get('kWh')).toEqual({ metrics: 1, devices: new Set(['d1']) })
    expect(usage.get('V')).toEqual({ metrics: 2, devices: new Set(['d2']) })
    expect(usage.has(undefined)).toBe(false)
  })

  it('counts a unit by every label it has', () => {
    const rows = unit_rows(UNITS, unit_usage(DEVICES))
    expect(rows.find(r => r.code === 'KWH')).toMatchObject({ metrics: 2, devices: 2 })
    expect(rows.find(r => r.code === 'CEL')).toMatchObject({ metrics: 1, devices: 1 })
  })

  it('lists the strings no unit means, most used first', () => {
    expect(unknown_units(UNITS, unit_usage(DEVICES))).toEqual([
      { string: 'V', metrics: 2, devices: 1 },
      { string: '$.x', metrics: 1, devices: 1 },
    ])
  })
})

describe('unit configs', () => {
  it('trims, and drops empty and repeated aliases and the symbol', () => {
    expect(unit_config('KWH', ' kWh ', ['kW·h', '', ' kW·h', 'kWh']))
      .toEqual({ code: 'KWH', symbol: 'kWh', aliases: ['kW·h'] })
    expect(unit_config('CEL', '°C', [])).toEqual({ code: 'CEL', symbol: '°C' })
  })

  it('finds labels that already mean another unit', () => {
    const clashes = label_clashes(UNITS, { code: 'WHR', symbol: 'Wh', aliases: ['kWh'] })
    expect(clashes).toEqual([{ label: 'kWh', unit: KWH }])
    expect(label_clashes(UNITS, { code: 'KWH', symbol: 'kWh', aliases: ['kW·h'] })).toEqual([])
  })

  it('adds an alias', () => {
    expect(with_alias(CEL, 'degC')).toEqual({ code: 'CEL', symbol: '°C', aliases: ['degC'] })
  })

  it('merges one unit into another as aliases', () => {
    const kvar = { code: 'KVR', symbol: 'kVAR', aliases: ['kvar'] }
    const k5 = { code: 'K5', symbol: 'kVAr', aliases: ['kvar (reactive)'] }
    expect(merged_unit(k5, kvar))
      .toEqual({ code: 'KVR', symbol: 'kVAR', aliases: ['kvar', 'kVAr', 'kvar (reactive)'] })
  })
})

describe('writes', () => {
  function fake () {
    const calls = []
    return {
      calls,
      create_object: async (...a) => { calls.push(['create_object', ...a]) },
      put_config: async (...a) => { calls.push(['put_config', ...a]) },
      delete_config: async (...a) => { calls.push(['delete_config', ...a]) },
      delete_object: async (...a) => { calls.push(['delete_object', ...a]) },
    }
  }

  it('creates a unit on the object for its code', async () => {
    const cdb = fake()
    const uuid = await save_unit(cdb, { code: 'WHR', symbol: 'Wh' }, 'watt hour', true)
    expect(uuid).toBe(eng_unit_uuid('WHR'))
    expect(cdb.calls).toEqual([
      ['create_object', UUIDs.Class.EngineeringUnit, uuid],
      ['put_config', UUIDs.App.Info, uuid, { name: 'watt hour' }],
      ['put_config', UUIDs.App.EngineeringUnit, uuid, { code: 'WHR', symbol: 'Wh' }],
    ])
  })

  it('merges by freeing the labels first, then deletes the merged unit', async () => {
    const cdb = fake()
    const from = { uuid: 'from', code: 'K5', symbol: 'kVAr' }
    const into = { uuid: 'into', code: 'KVR', symbol: 'kVAR' }
    await merge_units(cdb, from, into)
    expect(cdb.calls.map(c => c[0])).toEqual(['delete_config', 'put_config', 'delete_object'])
    expect(cdb.calls[1]).toEqual(['put_config', UUIDs.App.EngineeringUnit, 'into',
      { code: 'KVR', symbol: 'kVAR', aliases: ['kVAr'] }])
  })

  it('puts the merged unit back when the merge cannot be written', async () => {
    const cdb = fake()
    cdb.put_config = async (app, obj, conf) => {
      cdb.calls.push(['put_config', app, obj, conf])
      if (obj === 'into') throw new Error('422')
    }
    const from = { uuid: 'from', code: 'K5', symbol: 'kVAr' }
    await expect(merge_units(cdb, from, { uuid: 'into', code: 'KVR', symbol: 'kVAR' }))
      .rejects.toThrow('422')
    expect(cdb.calls.at(-1)).toEqual(['put_config', UUIDs.App.EngineeringUnit, 'from',
      { code: 'K5', symbol: 'kVAr' }])
    expect(cdb.calls.some(c => c[0] === 'delete_object')).toBe(false)
  })
})

describe('the UNECE table', () => {
  it('finds the unit a string means first, then by code, symbol and name', () => {
    expect(search_unece('kWh')[0].code).toBe('KWH')
    expect(search_unece('cel')[0].code).toBe('CEL')
    expect(search_unece('kilowatt hour').map(u => u.code)).toContain('KWH')
    expect(search_unece('')).toEqual([])
    expect(search_unece('a', 5)).toHaveLength(5)
  })

  it('suggests an alias for a way of writing a unit there is', () => {
    expect(suggest_for('kW·h', [{ ...KWH, aliases: [] }])).toMatchObject({ kind: 'alias', unit: { code: 'KWH' } })
  })

  it('suggests creating a unit that is not there, written as it is used', () => {
    expect(suggest_for('m3', UNITS)).toEqual({
      kind: 'create',
      match: { code: 'MTQ', symbol: 'm³', name: 'cubic metre' },
      config: { code: 'MTQ', symbol: 'm3', aliases: ['m³'] },
      name: 'cubic metre',
    })
    expect(suggest_for('%', UNITS).config).toEqual({ code: 'P1', symbol: '%' })
  })

  it('suggests nothing for a string that is not a unit', () => {
    expect(suggest_for('$.transformedReading', UNITS)).toBe(null)
  })
})
