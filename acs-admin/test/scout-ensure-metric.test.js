/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * ensure_metric, the creation step pulled out of the origin map editor's
 * selectMetric. The editor identifies metrics by object identity, so
 * these tests check that values land on the object the editor holds.
 */

import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'

import {
  SPARKPLUG_METRIC_UUID,
  apply_item,
  ensure_metric,
  schema_chain,
  set_at,
  value_at,
} from '../src/lib/scout/ensure-metric.js'
import { apply_proposal, validate_proposal } from '../src/lib/driver-ui/contract.js'
import { proposal_for_item } from '../src/lib/scout/model.js'

const metric = (enum_, extra = {}) => ({
  allOf: [
    { properties: {
      Schema_UUID: { const: SPARKPLUG_METRIC_UUID },
      Sparkplug_Type: { enum: ['Int32', 'DoubleBE'] },
      Documentation: { type: 'string' },
      Record_To_Historian: { default: true },
    } },
    { properties: { Sparkplug_Type: { enum: enum_ }, ...extra } },
  ],
})

const SCHEMA = {
  properties: {
    Schema_UUID: { const: 'top' },
    Axis: {
      properties: {
        Schema_UUID: { const: 'axis-schema' },
        Position: metric(['DoubleBE'], { Documentation: { default: 'Where the axis is.' } }),
        Load: metric(['FloatBE']),
      },
    },
    Mode: metric(['String']),
  },
}

let n = 0
const new_uuid = () => `uuid-${++n}`

describe('schema_chain', () => {
  it('builds the chain SchemaGroup emits, metric first', () => {
    const chain = schema_chain(SCHEMA, ['Axis', 'Position'])
    expect(chain.map(c => c.key)).toEqual(['Position', 'Axis'])
    expect(chain[0].schemaUUID).toBe(SPARKPLUG_METRIC_UUID)
    expect(chain[1].schemaUUID).toBe('axis-schema')
  })

  it('refuses a path that is not a metric', () => {
    expect(schema_chain(SCHEMA, ['Axis'])).toBeNull()
    expect(schema_chain(SCHEMA, ['Nope'])).toBeNull()
    expect(schema_chain(SCHEMA, ['Axis', 'Schema_UUID'])).toBeNull()
  })
})

describe('ensure_metric', () => {
  it('creates a metric with no origin map entry, with defaults and markers', () => {
    const model = {}
    const res = ensure_metric({ model, chain: schema_chain(SCHEMA, ['Axis', 'Position']), new_uuid })
    expect(res.created).toBe(true)
    expect(res.metric).toBe(model.Axis.Position)
    expect(res.metric).toMatchObject({
      Sparkplug_Type: 'DoubleBE',
      Documentation: 'Where the axis is.',
      Record_To_Historian: true,
      Schema_UUID: SPARKPLUG_METRIC_UUID,
    })
    expect(res.metric.Instance_UUID).toBeUndefined()
    expect(model.Axis.Schema_UUID).toBe('axis-schema')
    expect(model.Axis.Instance_UUID).toMatch(/^uuid-/)
  })

  it('keeps an existing group\'s Instance_UUID when it adds a metric to it', () => {
    const model = { Axis: { Schema_UUID: 'axis-schema', Instance_UUID: 'keep-me', Position: { Address: 'a' } } }
    ensure_metric({ model, chain: schema_chain(SCHEMA, ['Axis', 'Load']), new_uuid })
    expect(model.Axis.Instance_UUID).toBe('keep-me')
    expect(model.Axis.Load.Sparkplug_Type).toBe('FloatBE')
  })

  it('returns an existing metric as the same object', () => {
    const existing = { Address: 'old', Sparkplug_Type: 'String' }
    const model = { Mode: existing }
    const res = ensure_metric({ model, chain: schema_chain(SCHEMA, ['Mode']), new_uuid })
    expect(res.created).toBe(false)
    expect(res.metric).toBe(existing)
  })

  it('refuses a node that is not a Factory+ metric', () => {
    const bad = { properties: { Odd: { allOf: [{}] } } }
    expect(ensure_metric({ model: {}, chain: schema_chain(bad, ['Odd']), new_uuid })).toBeNull()
  })

  it('works through a reactive model, so the editor sees the same object', () => {
    const model = reactive({})
    const set = (path, value) => set_at(model, path, value)
    const res = ensure_metric({ model, chain: schema_chain(SCHEMA, ['Mode']), new_uuid, set })
    expect(res.metric).toBe(model.Mode)
  })
})

/* The editor's applyScoutItem is apply_item with its own setter. */
function apply (model, path, item, selected) {
  const res = apply_item({
    model, chain: schema_chain(SCHEMA, path), item, new_uuid,
    propose: proposal_for_item, validate: validate_proposal, apply: apply_proposal,
  })
  return { res, selected_is_same: selected ? selected.model === res.metric : null }
}

describe('applying an item in place', () => {
  const item = { id: 'i', parent: null, name: 'Pos', kind: 'value', address: 'ns=2;s=Pos', path: null,
    type: 'Double', description: 'Scanned docs' }

  it('fills the selected metric on the object the editor shows', () => {
    const model = { Axis: { Schema_UUID: 'axis-schema', Instance_UUID: 'a', Position: { Sparkplug_Type: '' } } }
    const selected = { path: ['Axis', 'Position'], model: model.Axis.Position }
    const { selected_is_same } = apply(model, ['Axis', 'Position'], item, selected)
    expect(selected_is_same).toBe(true)
    expect(selected.model.Address).toBe('ns=2;s=Pos')
    expect(selected.model.Sparkplug_Type).toBe('DoubleBE')
    expect(selected.model.Documentation).toBe('Scanned docs')
  })

  it('fills a metric that is not selected', () => {
    const model = { Mode: { Address: 'old', Path: '$.x', Documentation: 'Mine' } }
    const before = model.Mode
    apply(model, ['Mode'], { ...item, type: 'String' }, null)
    expect(model.Mode).toBe(before)
    expect(model.Mode.Address).toBe('ns=2;s=Pos')
    expect(model.Mode).not.toHaveProperty('Path')
    expect(model.Mode.Documentation).toBe('Mine')
  })

  it('replaces a static value with the address', () => {
    const model = { Mode: { Value: 'AUTO', Sparkplug_Type: 'String' } }
    apply(model, ['Mode'], { ...item, type: 'String' }, null)
    expect(model.Mode).not.toHaveProperty('Value')
    expect(model.Mode.Address).toBe('ns=2;s=Pos')
  })

  it('reports values the metric schema refuses', () => {
    const model = {}
    const res = apply_item({
      model, chain: schema_chain(SCHEMA, ['Mode']), item, new_uuid,
      propose: () => ({ Address: 'a', Sparkplug_Type: 'Nope' }),
      validate: validate_proposal, apply: apply_proposal,
    })
    expect(res.errors[0]).toMatch(/Sparkplug_Type/)
    expect(model.Mode.Address).toBe('a')
  })

  it('gives a new metric the scanned type, not the first entry of its enum', () => {
    const schema = { properties: { Speed: metric(['Int32BE', 'FloatBE', 'DoubleBE']) } }
    const model = {}
    const res = apply_item({
      model, chain: schema_chain(schema, ['Speed']), item: { ...item, type: 'Double' }, new_uuid,
      propose: proposal_for_item, validate: validate_proposal, apply: apply_proposal,
    })
    expect(res.created).toBe(true)
    expect(model.Speed.Sparkplug_Type).toBe('DoubleBE')
    expect(model.Speed.Address).toBe('ns=2;s=Pos')
  })

  it('gives the scanned type to a metric selectMetric created', () => {
    const schema = { properties: { Speed: metric(['Int32BE', 'FloatBE', 'DoubleBE']) } }
    const model = {}
    const chain = schema_chain(schema, ['Speed'])
    /* Selecting the metric creates it with the enum's first entry. */
    const selected = ensure_metric({ model, chain, new_uuid })
    expect(selected.metric.Sparkplug_Type).toBe('Int32BE')
    const res = apply_item({
      model, chain, item: { ...item, type: 'Double' }, new_uuid,
      propose: proposal_for_item, validate: validate_proposal, apply: apply_proposal,
    })
    expect(res.created).toBe(false)
    expect(res.metric).toBe(selected.metric)
    expect(model.Speed.Sparkplug_Type).toBe('DoubleBE')
  })

  it('keeps the type of a metric that already has an address', () => {
    const schema = { properties: { Speed: metric(['Int32BE', 'FloatBE', 'DoubleBE']) } }
    const model = { Speed: { Address: 'old', Sparkplug_Type: 'Int32BE' } }
    apply_item({
      model, chain: schema_chain(schema, ['Speed']), item: { ...item, type: 'Double' }, new_uuid,
      propose: proposal_for_item, validate: validate_proposal, apply: apply_proposal,
    })
    expect(model.Speed.Sparkplug_Type).toBe('Int32BE')
  })

  it('fills a metric with no origin map entry yet', () => {
    const model = {}
    const { res } = apply(model, ['Axis', 'Load'], { ...item, type: 'Float' }, null)
    expect(value_at(model, ['Axis', 'Load'])).toBe(res.metric)
    expect(res.metric.Address).toBe('ns=2;s=Pos')
    expect(res.metric.Sparkplug_Type).toBe('FloatBE')
  })
})
