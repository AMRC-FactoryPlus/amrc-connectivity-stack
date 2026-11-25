/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Edge Scout: the pure logic behind the Addresses panel.
 *
 * Item and snapshot validation run over the shared fixtures in
 * lib/edge-scout-schemas, so the panel reads exactly what the agent and
 * the driver libraries agree a snapshot is.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

import {
  NORMALISERS,
  ancestor_path,
  auto_match,
  base_type,
  build_index,
  bulk_rows,
  can_start,
  can_stop,
  code_text,
  collect_metrics,
  collections,
  comparable,
  decode_snapshot,
  diff,
  has_permission,
  identity,
  item_key,
  keep_items,
  mapped_but_missing,
  metric_key,
  metric_slots,
  metric_status,
  norm_name,
  normalise_address,
  object_name,
  object_name_problem,
  existing_objects,
  panel_layout,
  panel_state,
  parse_snapshot,
  place_type,
  proposal_for_item,
  query_items,
  scout_summary,
  search,
  share_item,
  start_request,
  cancel_request,
  type_conflict,
  usage,
  validate_end,
  validate_header,
  validate_item,
  visible_rows,
} from '../src/lib/scout/model.js'
import { Scout, WAIT_MS, WILDCARD } from '../src/lib/scout/constants.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(here, '../../lib/edge-scout-schemas/fixtures')

const fixtures = kind => fs.readdirSync(path.join(FIXTURES, kind))
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(FIXTURES, kind, f), 'utf8')) }))

const valid = fixtures('valid')
const invalid = fixtures('invalid')

const HEADER = {
  version: 1,
  scan: '3f9c1a2b-44e0-4d0c-9a7e-5b1f2c3d4e5f',
  connection: '5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a',
  driver: 'rs-edge-driver 0.1.0',
  started: '2026-11-24T10:41:00Z',
  root: null,
  folder_id: null,
  options: {},
}

const end = (items, extra = {}) => ({
  end: {
    finished: '2026-11-24T10:42:13Z',
    exhaustive: true,
    truncated: false,
    reason: null,
    excluded: [],
    rejected: 0,
    items,
    branches: [],
    ...extra,
  },
})

const folder = (id, parent = null, extra = {}) => ({ id, parent, name: id.split('/').pop(), kind: 'folder', ...extra })
const value = (id, parent, extra = {}) => ({
  id, parent, name: id.split('/').pop(), kind: 'value', address: id, path: null, ...extra,
})

const snapshot_lines = items => [HEADER, ...items, end(items.length)].map(l => JSON.stringify(l))

describe('validate_item agrees with item.schema.json', () => {
  for (const f of valid.filter(f => f.schema === 'item')) {
    it(`accepts ${f.file}`, () => expect(validate_item(f.data)).toBe(true))
  }
  for (const f of invalid.filter(f => f.schema === 'item')) {
    it(`refuses ${f.file}`, () => expect(validate_item(f.data)).toBe(false))
  }

  it('accepts every item inside the valid found and snapshot fixtures', () => {
    for (const f of valid) {
      const items = f.data?.items ?? []
      for (const item of items) expect(validate_item(item), f.file).toBe(true)
    }
  })

  it('refuses detail over 2 KiB and detail that is an array', () => {
    const base = value('a', null)
    expect(validate_item({ ...base, detail: { x: 'y'.repeat(3000) } })).toBe(false)
    expect(validate_item({ ...base, detail: [] })).toBe(false)
    expect(validate_item({ ...base, detail: null })).toBe(true)
  })
})

describe('snapshot lines agree with the snapshot schemas', () => {
  for (const f of valid.filter(f => f.schema === 'snapshot-header')) {
    it(`header ${f.file}`, () => expect(validate_header(f.data)).toBe(true))
  }
  for (const f of invalid.filter(f => f.schema === 'snapshot-header')) {
    it(`header ${f.file}`, () => expect(validate_header(f.data)).toBe(false))
  }
  for (const f of valid.filter(f => f.schema === 'snapshot-end')) {
    it(`end ${f.file}`, () => expect(validate_end(f.data)).toBe(true))
  }
  for (const f of invalid.filter(f => f.schema === 'snapshot-end')) {
    it(`end ${f.file}`, () => expect(validate_end(f.data)).toBe(false))
  }
})

describe('parse_snapshot', () => {
  it('reads every whole valid snapshot fixture', () => {
    for (const f of valid.filter(f => f.lines)) {
      const snap = parse_snapshot(f.lines.map(l => JSON.stringify(l)))
      expect(snap.valid, f.file).toBe(true)
      expect(snap.items).toHaveLength(f.lines.length - 2)
    }
  })

  it('refuses a snapshot with no end line', () => {
    const f = invalid.find(f => f.file === 'snapshot-no-end.json')
    const snap = parse_snapshot(f.lines.map(l => JSON.stringify(l)))
    expect(snap.valid).toBe(false)
    expect(snap.problems.join(' ')).toMatch(/no end line/)
    expect(snap.items).toEqual([])
  })

  it('refuses a snapshot whose count does not match', () => {
    const f = invalid.find(f => f.file === 'snapshot-wrong-count.json')
    expect(parse_snapshot(f.lines.map(l => JSON.stringify(l))).valid).toBe(false)
  })

  it('refuses a first line that is not a header', () => {
    const lines = snapshot_lines([value('a', null)])
    lines[0] = JSON.stringify(value('x', null))
    expect(parse_snapshot(lines).valid).toBe(false)
  })

  it('drops invalid items and repeated ids but keeps the rest', () => {
    const items = [value('a', null), { id: 'b', kind: 'value' }, value('a', null), value('c', null)]
    const lines = [
      JSON.stringify(HEADER),
      ...items.map(i => JSON.stringify(i)),
      '{not json',
      JSON.stringify(end(items.length + 1)),
    ]
    const snap = parse_snapshot(lines)
    expect(snap.valid).toBe(true)
    expect(snap.items.map(i => i.id)).toEqual(['a', 'c'])
    expect(snap.dropped).toBe(3)
  })

  it('keeps hostile strings as plain data', () => {
    const evil = value('<img src=x onerror=alert(1)>', null, {
      name: '<script>alert(1)</script>', description: '"}\n{"end":{}}',
    })
    const proto = value('__proto__', null)
    const snap = parse_snapshot(snapshot_lines([evil, proto]))
    expect(snap.valid).toBe(true)
    expect(snap.items[0].name).toBe('<script>alert(1)</script>')
    const index = build_index(snap.items)
    expect(index.by_id.get('__proto__').kind).toBe('value')
    expect({}.kind).toBeUndefined()
  })
})

describe('decode_snapshot', () => {
  it('gunzips and reads NDJSON', async () => {
    const items = [folder('L'), value('L/a', 'L'), value('L/b', 'L')]
    const gz = zlib.gzipSync(snapshot_lines(items).join('\n') + '\n')
    const snap = await decode_snapshot(gz)
    expect(snap.valid).toBe(true)
    expect(snap.items.map(i => i.id)).toEqual(['L', 'L/a', 'L/b'])
    expect(snap.header.scan).toBe(HEADER.scan)
  })

  it('finds a truncated file', async () => {
    const lines = snapshot_lines([value('a', null)]).slice(0, -1)
    const snap = await decode_snapshot(zlib.gzipSync(lines.join('\n')))
    expect(snap.valid).toBe(false)
  })
})

describe('normalisers', () => {
  it('opcua strips ns=0;', () => {
    expect(NORMALISERS.opcua('ns=0;i=2258')).toBe('i=2258')
    expect(NORMALISERS.opcua('ns=2;s=Line1')).toBe('ns=2;s=Line1')
  })

  it('opcua reduces an index range to its node', () => {
    expect(NORMALISERS.opcua('ns=2;s=Arr[2:5]')).toBe('ns=2;s=Arr')
    expect(NORMALISERS.opcua('ns=0;i=7[1]')).toBe('i=7')
  })

  it('opcua keeps an element the snapshot listed', () => {
    const has = a => a === 'ns=2;s=Arr[2]'
    expect(NORMALISERS.opcua('ns=2;s=Arr[2]', has)).toBe('ns=2;s=Arr[2]')
    expect(NORMALISERS.opcua('ns=2;s=Arr[3]', has)).toBe('ns=2;s=Arr')
  })

  it('opcua leaves brackets that are not a range', () => {
    expect(NORMALISERS.opcua('ns=2;s=Tag[abc]')).toBe('ns=2;s=Tag[abc]')
  })

  it('mqtt and exact compare unchanged, and an unknown form is exact', () => {
    expect(normalise_address('mqtt', 'ns=0;a/b')).toBe('ns=0;a/b')
    expect(normalise_address('exact', 'ns=0;i=1')).toBe('ns=0;i=1')
    expect(normalise_address('nonsense', 'ns=0;i=1')).toBe('ns=0;i=1')
    expect(normalise_address(undefined, 'ns=0;i=1')).toBe('ns=0;i=1')
  })

  it('metric_key uses Address and Path', () => {
    expect(metric_key({ Address: 'a/b', Path: '$.x' }, 'mqtt')).toBe(identity('a/b', '$.x'))
    expect(metric_key({ Address: 'a/b', Path: '' }, 'mqtt')).toBe(identity('a/b', null))
    expect(metric_key({ Value: 3 }, 'mqtt')).toBeNull()
  })
})

describe('index, tree and search', () => {
  const items = [
    folder('A'),
    value('A/speed', 'A', { name: 'Speed', unit: 'rpm' }),
    folder('A/B', 'A'),
    value('A/B/temp', 'A/B', { name: 'Temp', description: 'Motor temperature' }),
    value('orphan', 'missing-parent'),
  ]
  const index = build_index(items)

  it('puts orphans at the top', () => {
    expect(index.children.get(null)).toEqual(['A', 'orphan'])
  })

  it('shows only the top when nothing is open', () => {
    expect(visible_rows(index).map(r => r.id)).toEqual(['A', 'orphan'])
  })

  it('shows children of open folders, folders first', () => {
    const rows = visible_rows(index, { expanded: new Set(['A', 'A/B']) })
    expect(rows.map(r => [r.id, r.depth])).toEqual([
      ['A', 0], ['A/B', 1], ['A/B/temp', 2], ['A/speed', 1], ['orphan', 0],
    ])
  })

  it('keeps folders in place when a branch scan is appended', () => {
    /* A merged snapshot after a branch scan of Line1: the branch comes
     * last in the file, but the tree must not move it. */
    const merged = build_index([
      folder('P'),
      folder('P/Line2', 'P', { name: 'Line2' }),
      value('P/Energy', 'P', { name: 'Energy' }),
      folder('P/Line10', 'P', { name: 'Line10' }),
      folder('P/Line1', 'P', { name: 'Line1' }),
      value('P/Line1/speed', 'P/Line1', { name: 'speed' }),
    ])
    const fresh = build_index([
      folder('P'),
      folder('P/Line1', 'P', { name: 'Line1' }),
      value('P/Line1/speed', 'P/Line1', { name: 'speed' }),
      folder('P/Line2', 'P', { name: 'Line2' }),
      folder('P/Line10', 'P', { name: 'Line10' }),
      value('P/Energy', 'P', { name: 'Energy' }),
    ])
    const order = ['P/Line1', 'P/Line2', 'P/Line10', 'P/Energy']
    expect(merged.children.get('P')).toEqual(order)
    expect(fresh.children.get('P')).toEqual(order)
  })

  it('searches name, address, description and unit', () => {
    expect([...search(index, 'TEMPERATURE').matches]).toEqual(['A/B/temp'])
    expect([...search(index, 'rpm').matches]).toEqual(['A/speed'])
    expect([...search(index, 'a/b/t').matches]).toEqual(['A/B/temp'])
    expect(search(index, '  ').matches.size).toBe(0)
  })

  it('opens the ancestors of matches', () => {
    const { matches } = search(index, 'temp')
    expect(visible_rows(index, { keep: matches }).map(r => r.id)).toEqual(['A', 'A/B', 'A/B/temp'])
  })

  it('names the ancestor path', () => {
    expect(ancestor_path(index, 'A/B/temp')).toBe('A / B')
  })

  it('survives a parent cycle', () => {
    const cyc = build_index([folder('x', 'y'), folder('y', 'x')])
    expect(visible_rows(cyc, { expanded: new Set(['x', 'y']) })).toEqual([])
  })

  it('keys folders without an address by id', () => {
    expect(item_key(folder('F'))).not.toBe(item_key(value('F', null)))
  })
})

describe('comparable and diff', () => {
  const meta = (extra = {}) => ({
    exhaustive: true, truncated: false, options_hash: 'sha256:a', root: null,
    excluded: [{ id: 'i=2253', reason: 'skipped', prefixes: ['i='] }], ...extra,
  })

  it('needs both exhaustive, untruncated, same options, root and exclusions', () => {
    expect(comparable(meta(), meta()).ok).toBe(true)
    expect(comparable(meta(), meta({ exhaustive: false })).reason).toBe('not-exhaustive')
    expect(comparable(meta({ truncated: true }), meta()).reason).toBe('truncated')
    expect(comparable(meta(), meta({ options_hash: 'sha256:b' })).reason).toBe('options')
    expect(comparable(meta(), meta({ root: 'x' })).reason).toBe('root')
    expect(comparable(meta(), meta({ excluded: [] })).reason).toBe('excluded')
    expect(comparable(meta(), null).ok).toBe(false)
  })

  it('compares excluded scopes regardless of order', () => {
    const a = [{ id: 'x', prefixes: ['b', 'a'] }, { id: 'y' }]
    const b = [{ id: 'y' }, { id: 'x', prefixes: ['a', 'b'] }]
    expect(comparable(meta({ excluded: a }), meta({ excluded: b })).ok).toBe(true)
  })

  const prev = build_index([
    folder('A'),
    value('A/a', 'A', { type: 'Int32', access: 'r' }),
    value('A/b', 'A', { type: 'Double' }),
    value('A/gone', 'A'),
    value('A/arr', 'A', { detail: { dims: [3] } }),
  ])
  const cur = build_index([
    folder('A'),
    value('A/a', 'A', { type: 'Int32', access: 'rw' }),
    value('A/b', 'A', { type: 'Double', name: 'Bee' }),
    value('A/new', 'A'),
    value('A/arr', 'A', { detail: { dims: [4] } }),
  ])

  it('finds new, changed, renamed and gone between comparable scans', () => {
    const d = diff(cur, prev, { cur: meta(), prev: meta() })
    expect([...d.added]).toEqual(['A/new'])
    expect(d.changed.get('A/a')).toEqual(['access'])
    expect(d.changed.get('A/arr')).toEqual(['dims'])
    expect([...d.renamed]).toEqual(['A/b'])
    expect(d.gone.map(i => i.id)).toEqual(['A/gone'])
    expect(d.not_seen).toEqual([])
  })

  it('says not seen instead of gone when scans are not comparable', () => {
    const d = diff(cur, prev, { cur: meta(), prev: meta({ exhaustive: false }) })
    expect(d.comparable).toBe(false)
    expect(d.gone).toEqual([])
    expect(d.not_seen.map(i => i.id)).toEqual(['A/gone'])
  })

  it('never says gone for MQTT, which is never exhaustive', () => {
    const m = meta({ exhaustive: false, excluded: [] })
    expect(diff(cur, prev, { cur: m, prev: m }).gone).toEqual([])
  })

  it('limits a branch scan diff to its subtree', () => {
    const p = build_index([folder('A'), value('A/x', 'A'), folder('B'), value('B/y', 'B')])
    const c = build_index([folder('A'), value('A/z', 'A'), folder('B'), value('B/w', 'B')])
    const d = diff(c, p, { cur: meta(), prev: meta(), scope: 'B' })
    expect([...d.added]).toEqual(['B/w'])
    expect(d.gone.map(i => i.id)).toEqual(['B/y'])
  })
})

describe('mapped but missing', () => {
  const index = build_index([
    folder('ns=2;s=Line1'),
    value('ns=2;s=Line1/Speed', 'ns=2;s=Line1', { type: 'Double' }),
    value('i=2258', null),
  ])
  const meta = (extra = {}) => ({
    root: null, exhaustive: true, truncated: false,
    excluded: [{ id: 'i=2253', reason: 'skipped', prefixes: ['i='] }], ...extra,
  })
  const model = {
    Schema_UUID: 's', Instance_UUID: 'i',
    Line: {
      Schema_UUID: 's2',
      Speed: { Address: 'ns=2;s=Line1/Speed', Sparkplug_Type: 'FloatBE' },
      Lost: { Address: 'ns=2;s=Line1/Lost', Sparkplug_Type: 'DoubleBE' },
      Time: { Address: 'ns=0;i=2258' },
      Status: { Address: 'i=2256' },
      Fixed: { Value: '3', Sparkplug_Type: 'String' },
    },
  }

  it('collects only address metrics', () => {
    expect(collect_metrics(model).map(m => m.path.join('/')))
      .toEqual(['Line/Speed', 'Line/Lost', 'Line/Time', 'Line/Status'])
  })

  it('lists a missing metric and leaves the skipped Server object alone', () => {
    const out = mapped_but_missing(model, index, meta(), 'opcua')
    expect(out.missing.map(m => m.path.at(-1))).toEqual(['Lost'])
    expect(out.not_seen).toEqual([])
  })

  it('finds a namespace 0 address in its canonical form', () => {
    expect(metric_status(model.Line.Time, index, meta(), 'opcua').status).toBe('found')
  })

  it('flags a type conflict', () => {
    const out = mapped_but_missing(model, index, meta(), 'opcua')
    expect(out.conflicts.map(c => c.path.at(-1))).toEqual(['Speed'])
    expect(type_conflict({ type: 'Double' }, { Sparkplug_Type: 'DoubleLE' })).toBe(false)
    expect(base_type('UInt16BE')).toBe('UInt16')
  })

  it('says not seen when a scope has no prefixes', () => {
    const out = mapped_but_missing(model, index, meta({ excluded: [{ id: 'x', reason: 'skipped' }] }), 'opcua')
    expect(out.missing).toEqual([])
    expect(out.not_seen.map(m => m.path.at(-1))).toEqual(['Lost', 'Status'])
  })

  it('says not seen when a folder has more or was denied', () => {
    const more = build_index([...index.items, folder('ns=2;s=Deep', null, { more: true })])
    expect(mapped_but_missing(model, more, meta(), 'opcua').missing).toEqual([])
    const denied = build_index([...index.items, folder('ns=2;s=No', null, { detail: { denied: true } })])
    expect(mapped_but_missing(model, denied, meta(), 'opcua').missing).toEqual([])
  })

  it('lists nothing as missing from a branch, a truncated or a non-exhaustive scan', () => {
    for (const m of [meta({ root: 'x' }), meta({ truncated: true }), meta({ exhaustive: false })]) {
      expect(mapped_but_missing(model, index, m, 'opcua').missing).toEqual([])
    }
  })

  it('maps usage by device', () => {
    const u = usage([{ name: 'D1', model }, { name: 'D2', model: { X: { Address: 'i=2258' } } }], 'opcua', index)
    expect(u.get(identity('i=2258', null)).map(e => e.device)).toEqual(['D1', 'D2'])
  })
})

describe('applying an item', () => {
  const enum_ = ['Int16BE', 'Int16LE', 'Double', 'FloatBE', 'String']

  it('places plain types, then BE, then LE', () => {
    expect(place_type('Double', enum_)).toBe('Double')
    expect(place_type('Int16', enum_)).toBe('Int16BE')
    expect(place_type('Int16', ['Int16LE'])).toBe('Int16LE')
    expect(place_type('Int64', enum_)).toBeNull()
    expect(place_type(null, enum_)).toBeNull()
  })

  it('fills type, unit and docs only when empty', () => {
    const item = value('a', null, { path: '$.x', type: 'Int16', unit: 'rpm', description: 'Speed' })
    expect(proposal_for_item(item, {}, { allowed_types: enum_ })).toEqual({
      Address: 'a', Path: '$.x', Sparkplug_Type: 'Int16BE', Eng_Unit: 'rpm', Documentation: 'Speed',
    })
    expect(proposal_for_item(item, { Sparkplug_Type: 'String', Eng_Unit: 'Hz', Documentation: 'x' },
      { allowed_types: enum_ })).toEqual({ Address: 'a', Path: '$.x' })
  })

  it('replaces the type the editor stamped on a metric with no address', () => {
    const item = value('a', null, { type: 'Double' })
    const opts = { allowed_types: enum_, default_type: 'Int16BE' }
    expect(proposal_for_item(item, { Sparkplug_Type: 'Int16BE' }, opts))
      .toEqual({ Address: 'a', Path: null, Sparkplug_Type: 'Double' })
    /* With an address, the type is the operator's, so it stays. */
    expect(proposal_for_item(item, { Sparkplug_Type: 'Int16BE', Address: 'old' }, opts))
      .toEqual({ Address: 'a', Path: null })
    /* A type other than the stamped one is the operator's too. */
    expect(proposal_for_item(item, { Sparkplug_Type: 'FloatBE' }, opts))
      .toEqual({ Address: 'a', Path: null })
  })

  it('clears Path for an item with none, and skips units the vocabulary lacks', () => {
    const item = value('a', null, { unit: 'furlongs' })
    expect(proposal_for_item(item, {}, { resolve_unit: () => null })).toEqual({ Address: 'a', Path: null })
  })
})

describe('bulk mapping', () => {
  const schema = {
    properties: {
      Schema_UUID: { const: 'x' },
      Axis_X: {
        properties: {
          Position: { allOf: [{}, { properties: { Sparkplug_Type: { enum: ['DoubleBE'] } } }] },
          Speed: { allOf: [{}, { properties: { Sparkplug_Type: { enum: ['FloatBE'] } } }] },
        },
      },
      Axis_Y: {
        properties: {
          Position: { allOf: [{}, { properties: { Sparkplug_Type: { enum: ['DoubleBE'] } } }] },
        },
      },
      Mode: { allOf: [{}, { properties: { Sparkplug_Type: { enum: ['String'] } } }] },
      Status: { allOf: [{}, { properties: { Sparkplug_Type: { enum: ['String'] } } }] },
      Motors: {
        patternProperties: {
          '^[A-Za-z0-9_]+$': {
            properties: {
              Schema_UUID: { const: 'm' },
              Current: { allOf: [{}, { properties: { Sparkplug_Type: { enum: ['FloatBE'] } } }] },
            },
          },
        },
      },
    },
  }
  const index = build_index([
    folder('X'), folder('Y'),
    value('X/position', 'X', { name: 'POSITION', type: 'Double' }),
    value('Y/position', 'Y', { name: 'Position', type: 'Double' }),
    value('X/speed', 'X', { name: 'speed', type: 'Double' }),
    value('mode', null, { name: 'Mode', type: 'String' }),
    value('mode2', null, { name: 'mode!', type: 'String' }),
    value('pos', null, { name: 'position', type: 'Double' }),
    value('other', null, { name: 'Nothing like it' }),
  ])
  const slots = metric_slots(schema)

  it('lists every schema metric', () => {
    expect(slots.map(s => s.path.join('/'))).toEqual([
      'Axis_X/Position', 'Axis_X/Speed', 'Axis_Y/Position', 'Mode', 'Status',
    ])
  })

  it('normalises names', () => {
    expect(norm_name('Spindle_Speed-1 ')).toBe('spindlespeed1')
  })

  it('matches, tie-breaks by parent, and flags conflicts and gaps', () => {
    const pick = ids => ids.map(id => index.by_id.get(id))
    const rows = auto_match(pick(['X/position', 'X/speed', 'pos', 'other']), slots, index)
    const by = Object.fromEntries(rows.map(r => [r.item.id, r]))
    /* Parent "X" does not match "Axis_X", so two Position metrics tie. */
    expect(by['X/position'].status).toBe('ambiguous')
    expect(by['X/speed'].status).toBe('type_conflict')
    expect(by['X/speed'].slot.path).toEqual(['Axis_X', 'Speed'])
    expect(by.pos.status).toBe('ambiguous')
    expect(by.other.status).toBe('no_metric')
  })

  it('tie-breaks by parent name when it matches', () => {
    const idx = build_index([folder('Axis_X'), value('Axis_X/p', 'Axis_X', { name: 'position', type: 'Double' })])
    const [row] = auto_match([idx.by_id.get('Axis_X/p')], slots, idx)
    expect(row.status).toBe('matched')
    expect(row.slot.path).toEqual(['Axis_X', 'Position'])
    expect(row.type).toBe('DoubleBE')
  })

  it('makes two items that claim one metric ambiguous', () => {
    const rows = auto_match([index.by_id.get('mode'), index.by_id.get('mode2')], slots, index)
    expect(rows.map(r => r.status)).toEqual(['ambiguous', 'ambiguous'])
  })

  it('finds patternProperties collections', () => {
    const cols = collections(schema)
    expect(cols.map(c => c.path.join('/'))).toEqual(['Motors'])
    expect(cols[0].metrics.map(m => m.name)).toEqual(['Current'])
  })

  it('names objects to fit the pattern', () => {
    expect(object_name({ name: 'Motor 1' }, '^[A-Za-z0-9_]+$')).toBe('Motor_1')
    expect(object_name({ name: 'M1' }, '^[A-Za-z0-9_]+$')).toBe('M1')
    expect(object_name({ name: '***' }, '^[A-Za-z0-9_]+$')).toBeNull()
  })

  it('never names an object with a path separator, even when the pattern allows it', () => {
    expect(object_name({ name: 'Line 1/Motor.2' }, '.*')).toBe('Line_1_Motor_2')
    expect(object_name({ name: 'a.b' }, '^.+$')).toBe('a_b')
    expect(object_name({ name: '<new>' }, '.*')).toBe('new')
    expect(object_name({ name: '/' }, '.*')).toBeNull()
  })

  it('explains why a typed object name cannot be used', () => {
    const p = '^[A-Za-z0-9_]+$'
    expect(object_name_problem(['M1', 'M2'], 1, p)).toBeNull()
    expect(object_name_problem(['M1', ''], 1, p)).toMatch(/Give this object a name/)
    expect(object_name_problem(['a/b'], 0, '.*')).toMatch(/cannot contain/)
    expect(object_name_problem(['a.b'], 0, '.*')).toMatch(/cannot contain/)
    expect(object_name_problem(['<new>'], 0, '.*')).toMatch(/cannot contain/)
    expect(object_name_problem(['m-1'], 0, p)).toMatch(/does not allow/)
    expect(object_name_problem(['M1', 'M1'], 1, p)).toMatch(/Another object/)
    expect(object_name_problem(['M1', 'M1'], 0, p)).toBeNull()
    /* A pattern that is not a valid regular expression allows any name. */
    expect(object_name_problem(['x'], 0, '(')).toBeNull()
  })

  it('refuses a name the collection already holds', () => {
    const p = '^[A-Za-z0-9_]+$'
    const model = { Motors: { Schema_UUID: 's', Instance_UUID: 'i', Motor1: {} } }
    const have = existing_objects(model, ['Motors'])
    expect([...have]).toEqual(['Motor1'])
    expect(object_name_problem(['Motor1'], 0, p, have)).toMatch(/already exists/)
    expect(object_name_problem(['Motor2'], 0, p, have)).toBeNull()
    expect(existing_objects({}, ['Motors']).size).toBe(0)
  })

  it('finds the type a new metric gets for each slot', () => {
    const m = e => ({ allOf: [{}, { properties: { Sparkplug_Type: { enum: e } } }] })
    const slots = metric_slots({ properties: { A: m(['Int32BE', 'DoubleBE']), B: m([]) } })
    expect(slots.map(sl => sl.default_type)).toEqual(['Int32BE', null])
  })

  it('deletes a static Value when it maps an address', () => {
    const rows = bulk_rows([{
      item: index.by_id.get('mode'), path: ['Mode'],
      metric: { Value: 'Auto', Sparkplug_Type: 'String' }, allowed_types: ['String'],
    }])
    expect(rows[0].fields).toEqual({ Address: 'mode', Path: '', Value: '' })
  })

  it('builds CSV import rows', () => {
    const rows = bulk_rows([{
      item: index.by_id.get('mode'),
      path: ['Mode'],
      metric: null,
      allowed_types: ['String'],
    }])
    expect(rows).toEqual([{ tagPath: 'Mode', fields: { Address: 'mode', Path: '', Sparkplug_Type: 'String' } }])
  })
})

describe('panel_state', () => {
  const NODE = '9b2e4c6d-1f3a-4b5c-8d7e-6f5a4b3c2d1e'
  const base = {
    hidden: false, online: true, birth_seen: true, has_metric: true,
    entry: { version: 1, node: NODE, supported: true }, node: NODE,
    deployed: true, can_scout: true, pending: null, now: 0,
  }
  const st = over => panel_state({ ...base, ...over }).state
  const entry = over => ({ ...base.entry, ...over })
  const current = { file: 'f', items: 10 }

  it('follows the table order', () => {
    expect(st({ hidden: true, online: false })).toBe('hidden')
    expect(st({ online: false, entry: entry({ node: 'other' }) })).toBe('offline')
    expect(st({ has_metric: false, entry: entry({ node: 'other' }) })).toBe('agent_old')
    /* An entry from another node counts as no entry, so Scan stays. */
    expect(st({ entry: entry({ node: 'other', supported: false }) })).toBe('never')
    expect(st({ deployed: false, entry: entry({ supported: false }) })).toBe('undeployed')
    expect(st({ entry: entry({ last_request: { request: 'r', code: 'UNDEPLOYED' } }) })).toBe('undeployed')
    expect(st({ entry: entry({ supported: false }), can_scout: false })).toBe('unsupported')
    expect(st({ entry: entry({ supported: 'library' }), can_scout: false })).toBe('driver_old')
    expect(st({ entry: entry({ last_request: { request: 'r', code: 'NODRIVER', message: 'CONF' } }), can_scout: false }))
      .toBe('driver_down')
    expect(st({ can_scout: false, entry: entry({ current }) })).toBe('no_permission')
    expect(st({})).toBe('never')
  })

  it('ignores an untrusted entry, so the operator can scan to replace it', () => {
    const foreign = entry({ node: 'other', state: 'done', current, last_request: { request: 'r', code: 'UNDEPLOYED' } })
    expect(st({ entry: foreign })).toBe('never')
    expect(can_start(st({ entry: foreign }))).toBe(true)
  })

  it('passes the agent\'s message on for UNDEPLOYED when the config lists the connection', () => {
    const last = { request: 'r', code: 'UNDEPLOYED', message: 'This connection is not in the Edge Agent\'s config, or it is not a split driver' }
    expect(panel_state({ ...base, entry: entry({ last_request: last }) }))
      .toEqual({ state: 'undeployed', message: last.message })
    expect(panel_state({ ...base, deployed: null, entry: entry({ last_request: last }) }))
      .toEqual({ state: 'undeployed', message: null })
    expect(panel_state({ ...base, deployed: false, entry: entry({ last_request: last }) }))
      .toEqual({ state: 'undeployed' })
  })

  it('does not call an agent old before it has seen a birth', () => {
    expect(st({ birth_seen: false, has_metric: false })).toBe('never')
  })

  it('treats an unknown online state as up', () => {
    expect(st({ online: null })).toBe('never')
  })

  it('waits 15 s for the agent to record a request', () => {
    const pending = { request: 'mine', sent: 1000 }
    expect(st({ pending, now: 1000 + WAIT_MS - 1 })).toBe('sending')
    expect(st({ pending, now: 1000 + WAIT_MS })).toBe('waiting')
  })

  it('shows this browser\'s refusal', () => {
    const pending = { request: 'mine', sent: 0 }
    const e = entry({ current, state: 'running', scan: 's', request: 'theirs',
      last_request: { request: 'mine', code: 'BUSY', message: null } })
    expect(panel_state({ ...base, pending, entry: e })).toMatchObject({ state: 'refused', code: 'BUSY' })
  })

  it('ignores another browser\'s refusal', () => {
    const e = entry({ current, state: 'running', scan: 's', request: 'theirs',
      last_request: { request: 'other', code: 'BUSY' } })
    expect(st({ entry: e })).toBe('running')
  })

  it('shows queued, running, done, empty, failed, cancelled and interrupted', () => {
    expect(st({ entry: entry({ scan: 's', state: 'queued' }) })).toBe('queued')
    expect(st({ entry: entry({ scan: 's', state: 'running', current }) })).toBe('running')
    expect(st({ entry: entry({ scan: 's', state: 'done', current }) })).toBe('done')
    expect(st({ entry: entry({ scan: 's', state: 'done', current: { file: 'f', items: 0 } }) })).toBe('done_empty')
    expect(st({ entry: entry({ scan: 's', state: 'failed', code: 'TIMEOUT' }) })).toBe('failed')
    expect(st({ entry: entry({ scan: 's', state: 'cancelled', code: 'CANCELLED' }) })).toBe('cancelled')
    expect(st({ entry: entry({ scan: 's', state: 'failed', code: 'INTERRUPTED' }) })).toBe('interrupted')
  })

  it('offers Scan and Stop in the right states', () => {
    expect(can_start('done')).toBe(true)
    expect(can_start('running')).toBe(false)
    expect(can_start('no_permission')).toBe(false)
    expect(can_stop('queued')).toBe(true)
    expect(can_stop('done')).toBe(false)
  })

  it('has plain words for every code', () => {
    for (const c of ['REQUEST', 'UNDEPLOYED', 'NODRIVER', 'LIBRARY', 'BUSY', 'LIMIT', 'NOTRUNNING',
      'UNSUPPORTED', 'OPTIONS', 'CONN', 'AUTH', 'CANCELLED', 'ERR', 'TIMEOUT', 'LOST',
      'INTERRUPTED', 'STORE', 'AGENT']) {
      const text = code_text(c, { message: 'detail' })
      expect(text).not.toMatch(/[—–;]/)
      expect(text.length).toBeGreaterThan(10)
    }
    expect(code_text('NODRIVER', { message: 'CONF' })).toBe("The driver isn't ready. CONF.")
  })
})

describe('permissions, requests and the custom UI', () => {
  it('reads the scout permission from an ACL', () => {
    const acl = [{ permission: Scout.Perm, target: WILDCARD }]
    expect(has_permission(acl, Scout.Perm, 'n')).toBe(true)
    expect(has_permission([{ permission: Scout.Perm, target: 'm' }], Scout.Perm, 'n')).toBe(false)
    expect(has_permission(null, Scout.Perm, 'n')).toBe(false)
  })

  it('builds requests that match ncmd.schema.json fixtures', () => {
    const ncmd = valid.find(f => f.file === 'ncmd-cancel.json').data
    expect(Object.keys(cancel_request({ request: 'r', connection: 'c' })).sort())
      .toEqual(Object.keys(ncmd).sort())
    expect(start_request({ request: 'r', connection: 'c' })).toEqual({
      version: 1, op: 'start', request: 'r', connection: 'c', root: null, folder_id: null, options: {},
      limits: { samples: true },
    })
  })

  it('hides samples unless the driver shares them', () => {
    const item = value('a', null, { sample: '42', detail: { x: 1 } })
    expect(share_item(item, false)).not.toHaveProperty('sample')
    expect(share_item(item, true).sample).toBe('42')
    expect(share_item(item, true).detail).not.toBe(item.detail)
  })

  it('answers queries by prefix, in order, at most 500', () => {
    const items = Array.from({ length: 700 }, (_, i) => value(`a/${i}`, null))
    const index = build_index([...items, value('b/1', null)])
    expect(query_items(index, { prefix: 'a/', limit: 10000 })).toHaveLength(500)
    expect(query_items(index, { prefix: 'b/' }).map(i => i.id)).toEqual(['b/1'])
    expect(query_items(index, { prefix: 'a/1', limit: 2 }).map(i => i.id)).toEqual(['a/1', 'a/10'])
    expect(query_items(null, { prefix: '' })).toEqual([])
  })

  it('summarises a status entry, and nothing from an untrusted one', () => {
    const e = { state: 'done', current: { finished: 't', items: 4 } }
    expect(scout_summary(e)).toEqual({ available: true, state: 'done', finished: 't', items: 4 })
    expect(scout_summary(e, false)).toEqual({ available: false, state: null, finished: null, items: 0 })
  })
})

describe('search inside names and addresses', () => {
  const index = build_index([
    folder('shellies/', null, { name: 'shellies' }),
    folder('shellies/shellyhtg3-0a1b2c3d4e5f/', 'shellies/', { name: 'shellyhtg3-0a1b2c3d4e5f' }),
    value('shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0', 'shellies/shellyhtg3-0a1b2c3d4e5f/',
      { name: 'humidity:0', address: 'shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0', type: 'Double' }),
    value('shellies/shellyplug-a1b2c3/power', 'shellies/', { name: 'power', address: 'shellies/shellyplug-a1b2c3/power' }),
  ])
  const found = q => [...search(index, q).matches].sort()

  it('finds a serial after a dash in a folder name and inside addresses', () => {
    expect(found('0a1b2c3d4e5f')).toEqual([
      'shellies/shellyhtg3-0a1b2c3d4e5f/',
      'shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0',
    ])
  })

  it('finds parts of a name after a slash or colon, ignoring case', () => {
    expect(found('0A1B')).toHaveLength(2)
    expect(found('humidity:0')).toEqual(['shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0'])
    expect(found(':0')).toEqual(['shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0'])
    expect(found('status/hum')).toEqual(['shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0'])
  })

  it('matches every word, and ignores separators and invisible characters', () => {
    expect(found('shellyhtg3 humidity')).toEqual(['shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0'])
    expect(found('shellyhtg30a1b')).toHaveLength(2)
    expect(found('shellyhtg3_0a1b')).toHaveLength(2)
    expect(found('\u200b0a1b2c3d4e5f\u00a0')).toHaveLength(2)
    expect(found('shellyhtg3 nothere')).toEqual([])
  })

  it('keeps a matching folder under the value filters, and its matching values', () => {
    const { matches } = search(index, '0a1b2c3d4e5f')
    const keep = keep_items(index, { matches, filters: { values: true } })
    expect([...keep].sort()).toEqual([
      'shellies/shellyhtg3-0a1b2c3d4e5f/',
      'shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0',
    ])
    const rows = visible_rows(index, { keep }).map(r => r.id)
    expect(rows).toEqual([
      'shellies/',
      'shellies/shellyhtg3-0a1b2c3d4e5f/',
      'shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0',
    ])
  })

  it('keeps nothing extra with no search or filter', () => {
    expect(keep_items(index, {})).toBeNull()
    expect([...keep_items(index, { type: 'Double' })])
      .toEqual(['shellies/shellyhtg3-0a1b2c3d4e5f/status/humidity:0'])
  })
})

describe('panel_layout', () => {
  it('has no Scan button where nobody can scan', () => {
    for (const st of ['offline', 'agent_old', 'unsupported', 'no_permission'])
      expect(panel_layout(st, { scanned: true })).toBe('blocked')
  })

  it('shows the empty state only before the first scan', () => {
    expect(panel_layout('never')).toBe('empty')
    expect(panel_layout('never', { scanned: true })).toBe('normal')
    expect(panel_layout('done', { scanned: true })).toBe('normal')
    expect(panel_layout('failed')).toBe('normal')
  })
})
