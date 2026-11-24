/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Edge Scout bulk mapping through the CSV import path.
 *
 * The Map dialog's choices become CSV rows (model.bulk_rows) and go
 * through applyCsvToModel, the same function the CSV import uses, so a
 * bulk map creates metrics and pattern objects exactly as an import does.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/store/useISA95Store.js', () => ({
  ISA95_HIERARCHY_KEY: 'ISA95_Hierarchy',
}))

import { applyCsvToModel } from '@/composables/useOriginMapCsv.js'
import { auto_match, build_index, bulk_rows, collections, metric_slots, object_name } from '@/lib/scout/model.js'
import { value_at } from '@/lib/scout/ensure-metric.js'

const METRIC = enum_ => ({
  allOf: [
    { properties: {
      Schema_UUID: { const: 'metric-schema' },
      Sparkplug_Type: { enum: ['Int32'] },
    } },
    { properties: { Sparkplug_Type: { enum: enum_ } } },
  ],
})

const SCHEMA = {
  properties: {
    Schema_UUID: { const: 'device-schema' },
    Spindle: {
      properties: {
        Schema_UUID: { const: 'spindle-schema' },
        Speed: METRIC(['DoubleBE', 'FloatBE']),
        Load: METRIC(['FloatBE']),
      },
    },
    Mode: METRIC(['String']),
    Motors: {
      patternProperties: {
        '^[A-Za-z0-9_]+$': {
          properties: {
            Schema_UUID: { const: 'motor-schema' },
            Current: METRIC(['FloatBE']),
          },
        },
      },
    },
  },
}

const items = [
  { id: 'S', parent: null, name: 'Spindle', kind: 'folder' },
  { id: 'S/speed', parent: 'S', name: 'Speed', kind: 'value', address: 'ns=2;s=Speed', path: null, type: 'Double',
    description: 'Spindle speed' },
  { id: 'S/load', parent: 'S', name: 'load', kind: 'value', address: 'ns=2;s=Load', path: null, type: 'Float' },
  { id: 'mode', parent: null, name: 'MODE', kind: 'value', address: 'ns=2;s=Mode', path: '$.mode', type: 'String' },
  { id: 'm1', parent: null, name: 'Motor 1', kind: 'value', address: 'ns=2;s=M1', path: null, type: 'Float' },
  { id: 'm2', parent: null, name: 'Motor 2', kind: 'value', address: 'ns=2;s=M2', path: null, type: 'Float' },
]
const index = build_index(items)
const pick = ids => ids.map(id => index.by_id.get(id))

describe('bulk mapping onto schema metrics', () => {
  it('creates matched metrics with markers, without touching an existing one\'s docs', () => {
    const model = { Mode: { Address: 'old', Sparkplug_Type: 'String', Documentation: 'Mine' } }
    const rows = auto_match(pick(['S/speed', 'S/load', 'mode']), metric_slots(SCHEMA), index)
    expect(rows.map(r => r.status)).toEqual(['matched', 'matched', 'matched'])

    const choices = rows.map(r => ({
      item: r.item, path: r.slot.path, allowed_types: r.slot.allowed_types,
      metric: value_at(model, r.slot.path) ?? null,
    }))
    const result = applyCsvToModel(bulk_rows(choices), model, SCHEMA)
    expect(result).toMatchObject({ applied: 3, skipped: 0 })

    expect(model.Spindle.Schema_UUID).toBe('spindle-schema')
    expect(model.Spindle.Instance_UUID).toBeTruthy()
    expect(model.Spindle.Speed).toMatchObject({
      Address: 'ns=2;s=Speed', Sparkplug_Type: 'DoubleBE', Documentation: 'Spindle speed',
    })
    expect(model.Spindle.Speed).not.toHaveProperty('Path')
    expect(model.Spindle.Load.Sparkplug_Type).toBe('FloatBE')
    expect(model.Mode).toEqual({
      Address: 'ns=2;s=Mode', Path: '$.mode', Sparkplug_Type: 'String', Documentation: 'Mine',
    })
  })
})

describe('bulk mapping by creating pattern objects', () => {
  it('makes one object per address, named after it', () => {
    const [col] = collections(SCHEMA)
    const metric = col.metrics[0]
    const model = {}
    const choices = pick(['m1', 'm2']).map(item => ({
      item,
      path: [...col.path, object_name(item, col.pattern), ...metric.path],
      allowed_types: metric.allowed_types,
      metric: null,
    }))
    const result = applyCsvToModel(bulk_rows(choices), model, SCHEMA)
    expect(result.applied).toBe(2)
    expect(Object.keys(model.Motors)).toEqual(['Motor_1', 'Motor_2'])
    expect(model.Motors.Motor_1.Schema_UUID).toBe('motor-schema')
    expect(model.Motors.Motor_1.Instance_UUID).toBeTruthy()
    expect(model.Motors.Motor_1.Instance_UUID).not.toBe(model.Motors.Motor_2.Instance_UUID)
    expect(model.Motors.Motor_2.Current).toMatchObject({ Address: 'ns=2;s=M2', Sparkplug_Type: 'FloatBE' })
  })
})

describe('bulk mapping names that would split a path', () => {
  /* The editor hands applyCsvToModel a setter that splits on ".", as
   * OriginMapEditor's set() does. */
  const dot_set = (path, value, obj, delim) => {
    const keys = path.split(delim)
    let cur = obj
    for (const k of keys.slice(0, -1)) {
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
      cur = cur[k]
    }
    cur[keys.at(-1)] = value
  }

  it('makes one object per address when the names hold "." or "/"', () => {
    const schema = {
      properties: {
        Motors: {
          patternProperties: {
            '.*': { properties: { Schema_UUID: { const: 'motor-schema' }, Current: METRIC(['FloatBE']) } },
          },
        },
      },
    }
    const idx = build_index([
      { id: 'a', parent: null, name: 'Motor.1', kind: 'value', address: 'ns=2;s=M.1', path: null, type: 'Float' },
      { id: 'b', parent: null, name: 'Line/Motor 2', kind: 'value', address: 'ns=2;s=M/2', path: null, type: 'Float' },
    ])
    const [col] = collections(schema)
    const model = {}
    const choices = ['a', 'b'].map(id => idx.by_id.get(id)).map(item => ({
      item,
      path: [...col.path, object_name(item, col.pattern), ...col.metrics[0].path],
      allowed_types: col.metrics[0].allowed_types,
      metric: null,
    }))
    const result = applyCsvToModel(bulk_rows(choices), model, schema, dot_set)
    expect(result).toMatchObject({ applied: 2, skipped: 0 })
    expect(Object.keys(model.Motors)).toEqual(['Motor_1', 'Line_Motor_2'])
    expect(model.Motors.Motor_1.Current.Address).toBe('ns=2;s=M.1')
    expect(model.Motors.Line_Motor_2.Current.Address).toBe('ns=2;s=M/2')
  })
})

describe('bulk mapping the editor\'s stamped and static metrics', () => {
  const schema = {
    properties: {
      Speed: METRIC(['Int32BE', 'FloatBE', 'DoubleBE']),
      Mode: METRIC(['String']),
    },
  }
  const [speed_slot, mode_slot] = metric_slots(schema)
  const choice = (slot, item, model) => ({
    item, path: slot.path, allowed_types: slot.allowed_types, default_type: slot.default_type,
    metric: value_at(model, slot.path) ?? null,
  })

  it('replaces the type selectMetric stamped on a metric with no address', () => {
    /* The operator clicked Speed once, so the editor created it with the
     * enum's first entry. */
    const model = { Speed: { Schema_UUID: 'metric-schema', Sparkplug_Type: 'Int32BE' } }
    applyCsvToModel(bulk_rows([choice(speed_slot, index.by_id.get('S/speed'), model)]), model, schema)
    expect(model.Speed).toMatchObject({ Address: 'ns=2;s=Speed', Sparkplug_Type: 'DoubleBE' })
  })

  it('turns a static metric into an address metric', () => {
    const model = { Mode: { Value: 'Auto', Sparkplug_Type: 'String' } }
    applyCsvToModel(bulk_rows([choice(mode_slot, index.by_id.get('mode'), model)]), model, schema)
    expect(model.Mode).not.toHaveProperty('Value')
    expect(model.Mode.Address).toBe('ns=2;s=Mode')
  })
})
