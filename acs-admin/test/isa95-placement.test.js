/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * ISA-95 placements in the admin UI: reading a placement, the bulk
 * import, vocabulary merges, and the Edge Agent config merge.
 */

import { describe, it, expect } from 'vitest'

import {
  devices_placed_under, on_uns, parse_placement_csv, placement_path,
  placement_state, plan_merge, plan_placements, vocabulary_of,
} from '../src/lib/isa95-placement.js'
import { applyPlacement } from '../src/utils/edgeAgentConfigUpdater.js'

const P = 'Device_Information/ISA95_Hierarchy'
const D1 = 'dddddddd-0000-4000-8000-000000000001'
const D2 = 'dddddddd-0000-4000-8000-000000000002'
const D3 = 'dddddddd-0000-4000-8000-000000000003'

const NODES = [
  { uuid: 'acme', name: 'Acme', level: 'Enterprise', aliases: [], children: ['site1', 'site1b'] },
  { uuid: 'site1', name: 'Site1', level: 'Site', aliases: ['Main Site'], children: ['area1'] },
  /* A duplicate of Site1, to merge. */
  { uuid: 'site1b', name: 'Site 1', level: 'Site', aliases: ['S1'], children: ['area2'] },
  { uuid: 'area1', name: 'Area1', level: 'Area', aliases: [], children: [] },
  { uuid: 'area2', name: 'Area2', level: 'Area', aliases: [], children: [] },
  { uuid: 'other', name: 'Other Co', level: 'Enterprise', aliases: [], children: [] },
  { uuid: 'lost', name: 'Lost', level: 'Area', aliases: [], children: [] },
]
const vocab = () => vocabulary_of(NODES)

describe('reading a placement', () => {
  it('gives the path from the Enterprise down', () => {
    expect(placement_path(vocab(), { node: 'area1' })).toEqual(['Acme', 'Site1', 'Area1'])
    expect(placement_path(vocab(), null)).toEqual([])
  })

  it('tells placed, unplaced and broken devices apart', () => {
    expect(placement_state(vocab(), { node: 'site1' })).toEqual({ state: 'placed', path: ['Acme', 'Site1'] })
    expect(placement_state(vocab(), null).state).toBe('unplaced')
    const broken = placement_state(vocab(), { node: 'lost' })
    expect(broken.state).toBe('broken')
    expect(broken.error).toMatch(/no Site above it/)
    expect(on_uns(vocab(), { node: 'acme' })).toBe(true)
    expect(on_uns(vocab(), { node: 'lost' })).toBe(false)
  })

  it('finds the devices placed at or under a node', () => {
    const placements = new Map([[D1, { node: 'area1' }], [D2, { node: 'site1b' }], [D3, { node: 'acme' }]])
    expect(devices_placed_under(vocab(), placements, 'site1')).toEqual([D1])
    expect(devices_placed_under(vocab(), placements, 'acme').sort()).toEqual([D1, D2, D3].sort())
  })
})

describe('the placement CSV', () => {
  it('reads rows, skipping a header and blank lines', () => {
    const { rows, errors } = parse_placement_csv([
      'device_uuid,Enterprise,Site,Area,Work Center,Work Unit',
      `${D1},Acme,Site1,Area1,,`,
      '',
      `${D2.toUpperCase()}, "Acme" ,Main Site`,
    ].join('\n'))
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { line: 2, device: D1, names: ['Acme', 'Site1', 'Area1'] },
      { line: 4, device: D2, names: ['Acme', 'Main Site'] },
    ])
  })

  it('reports bad rows by line', () => {
    const { rows, errors } = parse_placement_csv([
      'not-a-uuid,Acme',
      `${D1},Acme,,Area1`,
      `${D2},`,
      `${D3},Acme,Site/1`,
      `${D3},Acme,Edge`,
    ].join('\n'))
    expect(rows).toEqual([])
    expect(errors.map(e => e.line)).toEqual([1, 2, 3, 4, 5])
    expect(errors[1].message).toMatch(/Site is empty but a lower level is not/)
    expect(errors[3].message).toMatch(/contains/)
    expect(errors[4].message).toMatch(/Edge/)
  })
})

describe('planning a bulk import', () => {
  const devices = () => new Map([
    [D1, { name: 'Lathe', placement: null }],
    [D2, { name: 'Mill', placement: { node: 'acme', instances: { [P]: 'kept' } } }],
    [D3, { name: 'Press', placement: { node: 'area1' } }],
  ])
  const rows = [
    { line: 1, device: D1, names: ['acme', 'MAIN SITE', 'Area1'] },
    { line: 2, device: D2, names: ['Acme', 'Site1'] },
    { line: 3, device: D3, names: ['Acme', 'Site1', 'Area1'] },
  ]

  it('fills unplaced devices and keeps placed ones without overwrite', () => {
    const plan = plan_placements({ rows, vocab: vocab(), devices: devices(), overwrite: false })
    expect(plan.changes).toEqual([{
      line: 1, device: D1, name: 'Lathe', from: null,
      to: ['Acme', 'Site1', 'Area1'], placement: { node: 'area1' },
    }])
    expect(plan.kept.map(k => k.device)).toEqual([D2])
    expect(plan.unchanged).toBe(1)
    expect(plan.errors).toEqual([])
  })

  it('replaces placements with overwrite, keeping Instance_UUIDs', () => {
    const plan = plan_placements({ rows, vocab: vocab(), devices: devices(), overwrite: true })
    const d2 = plan.changes.find(c => c.device === D2)
    expect(d2.from).toEqual(['Acme'])
    expect(d2.to).toEqual(['Acme', 'Site1'])
    expect(d2.placement).toEqual({ node: 'site1', instances: { [P]: 'kept' } })
  })

  it('is idempotent once applied', () => {
    const devs = devices()
    for (const c of plan_placements({ rows, vocab: vocab(), devices: devs, overwrite: true }).changes)
      devs.get(c.device).placement = c.placement
    const again = plan_placements({ rows, vocab: vocab(), devices: devs, overwrite: true })
    expect(again.changes).toEqual([])
    expect(again.unchanged).toBe(3)
  })

  it('refuses unknown devices, unknown names and duplicate rows', () => {
    const plan = plan_placements({
      rows: [
        { line: 1, device: 'eeeeeeee-0000-4000-8000-000000000000', names: ['Acme'] },
        { line: 2, device: D1, names: ['Acme', 'Nowhere'] },
        { line: 3, device: D3, names: ['Acme'] },
        { line: 4, device: D3, names: ['Acme'] },
      ],
      vocab: vocab(), devices: devices(), overwrite: true,
    })
    expect(plan.errors.map(e => e.line)).toEqual([1, 2, 4])
    expect(plan.errors[1].message).toMatch(/Site "Nowhere" is not in the vocabulary under Acme/)
  })
})

describe('merging vocabulary nodes', () => {
  it('moves children, aliases and placements, then deletes the duplicate', () => {
    const placements = new Map([[D1, { node: 'site1b', instances: { x: 'y' } }], [D2, { node: 'area2' }]])
    const { steps, error } = plan_merge(vocab(), 'site1b', 'site1', placements)
    expect(error).toBeUndefined()
    expect(steps).toEqual([
      { vocabulary: 'site1', config: { aliases: ['Main Site', 'Site 1', 'S1'], children: ['area1', 'area2'] } },
      { vocabulary: 'site1b', config: { aliases: ['S1'], children: [] } },
      { vocabulary: 'acme', config: { aliases: [], children: ['site1'] } },
      { placement: D1, config: { node: 'site1', instances: { x: 'y' } } },
      { delete: 'site1b' },
    ])
  })

  it('refuses nodes of different levels, itself, or a node under the duplicate', () => {
    expect(plan_merge(vocab(), 'site1', 'area1', new Map()).error).toMatch(/is a Site/)
    expect(plan_merge(vocab(), 'site1', 'site1', new Map()).error).toMatch(/itself/)
    expect(plan_merge(vocab(), 'nope', 'site1', new Map()).error).toMatch(/vocabulary/)
  })
})

describe('the Edge Agent config generator', () => {
  const other = { Name: 'Temperature', type: 'Float' }
  const legacy = { Name: `${P}/Enterprise`, type: 'String', value: 'Typed by hand' }
  const nested = { Name: 'Device_Information/Base_Device_Information/ISA95_Hierarchy/Site', value: 'Old' }

  it('replaces origin-map hierarchy tags with the rendered placement', () => {
    const tags = applyPlacement([other, legacy, nested], { uuid: D1, placement: { node: 'site1' } }, vocab(), null)
    expect(tags.filter(t => t.Name.includes('ISA95_Hierarchy') && t.type === 'String')
      .map(t => [t.Name, t.value]))
      .toEqual([[`${P}/Enterprise`, 'Acme'], [`${P}/Site`, 'Site1']])
    expect(tags[0]).toEqual(other)
  })

  it('gives an unplaced device no hierarchy', () => {
    expect(applyPlacement([other, legacy], { uuid: D1, placement: null }, vocab(), null)).toEqual([other])
  })

  it('keeps the existing hierarchy when the placement does not render', () => {
    const existing = [other, { Name: `${P}/Enterprise`, value: 'Was there' }]
    const tags = applyPlacement([other, legacy], { uuid: D1, placement: { node: 'lost' } }, vocab(), existing)
    expect(tags).toEqual([other, { Name: `${P}/Enterprise`, value: 'Was there' }])
  })
})
