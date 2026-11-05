/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The device picker's list, from i3X. i3X shows each person only the
 * devices they may read, each under its deepest ISA-95 level, so the
 * list and each device's path come from the levels and has-children.
 */

import { describe, it, expect } from 'vitest'

import {
  devices_from_tree, device_tree, tree_rows, merge_device_index, path_label, NO_PATH,
} from '../src/lib/datasets/i3x-devices.js'

const DEV1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const DEV2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const DEV3 = 'aaaaaaaa-0000-4000-8000-000000000003'

/* An enterprise with two sites; one area under the first. */
const LEVELS = [
  { elementId: 'ent', displayName: 'Works', parentId: '/', typeElementId: 'isa95-level' },
  { elementId: 'north', displayName: 'North site', parentId: 'ent', typeElementId: 'isa95-level' },
  { elementId: 'south', displayName: 'South site', parentId: 'ent', typeElementId: 'isa95-level' },
  { elementId: 'hall', displayName: 'Hall 1', parentId: 'north', typeElementId: 'isa95-level' },
]

const LEVEL_TYPE = { typeElementId: 'isa95-level' }

/* has-children for every level: levels and devices mixed. */
const RELATED = [
  { success: true, elementId: 'ent', result: [
    { elementId: 'north', displayName: 'North site', parentId: 'ent', ...LEVEL_TYPE },
    { elementId: 'south', displayName: 'South site', parentId: 'ent', ...LEVEL_TYPE },
  ] },
  { success: true, elementId: 'north', result: [
    { elementId: 'hall', displayName: 'Hall 1', parentId: 'north', ...LEVEL_TYPE },
  ] },
  { success: true, elementId: 'hall', result: [
    { elementId: DEV2, displayName: 'Spindle', parentId: 'hall', typeElementId: 'schema-1' },
    { elementId: DEV1, displayName: 'Meter', parentId: 'hall', typeElementId: 'schema-2' },
  ] },
  { success: true, elementId: 'south', result: [
    { elementId: DEV3, displayName: 'Chiller', parentId: 'south', typeElementId: 'schema-1' },
  ] },
]

describe('devices_from_tree', () => {
  it('finds the devices under the levels, with their paths', () => {
    expect(devices_from_tree(LEVELS, RELATED)).toEqual([
      { uuid: DEV1, name: 'Meter', path: ['Works', 'North site', 'Hall 1'], parent: 'hall' },
      { uuid: DEV2, name: 'Spindle', path: ['Works', 'North site', 'Hall 1'], parent: 'hall' },
      { uuid: DEV3, name: 'Chiller', path: ['Works', 'South site'], parent: 'south' },
    ])
  })

  it('skips failed lookups and lists a device once', () => {
    const related = [
      ...RELATED,
      { success: false, elementId: 'gone', error: { code: 404 } },
      { success: true, elementId: 'south', result: [{ elementId: DEV3, displayName: 'Chiller' }] },
    ]
    expect(devices_from_tree(LEVELS, related).map(d => d.uuid)).toEqual([DEV1, DEV2, DEV3])
  })

  it('ignores answers for objects that are not levels', () => {
    const related = [{ success: true, elementId: DEV1, result: [{ elementId: 'leaf', displayName: 'Load' }] }]
    expect(devices_from_tree(LEVELS, related)).toEqual([])
  })

  it('names a device by its UUID when i3X gives no name', () => {
    const related = [{ success: true, elementId: 'south', result: [{ elementId: DEV3 }] }]
    expect(devices_from_tree(LEVELS, related)[0].name).toBe('aaaaaaaa')
  })

  it('stops at a loop in the levels', () => {
    const levels = [
      { elementId: 'a', displayName: 'A', parentId: 'b' },
      { elementId: 'b', displayName: 'B', parentId: 'a' },
    ]
    const related = [{ success: true, elementId: 'a', result: [{ elementId: DEV1, displayName: 'Meter' }] }]
    expect(devices_from_tree(levels, related)[0].path).toEqual(['B', 'A'])
  })

  it('handles nothing', () => {
    expect(devices_from_tree(null, null)).toEqual([])
    expect(devices_from_tree([], [])).toEqual([])
  })
})

describe('device_tree', () => {
  const D = (uuid, name, path) => ({ uuid, name, path })
  const tree = device_tree([
    D('t2', 'Torque 2', ['Works', 'North site', 'Hall 1']),
    D('t1', 'Torque 1', ['Works', 'North site', 'Hall 1']),
    D('m', 'Meter', ['Works']),
    D('l', 'Lathe', ['Works', 'South site']),
    D('r', 'Rig', []),
  ])

  it('nests levels by path, sorted by name, with unplaced devices last', () => {
    expect(tree.map(n => n.name)).toEqual(['Works', NO_PATH])
    expect(tree[0].nodes.map(n => n.name)).toEqual(['North site', 'South site'])
    expect(tree[0].nodes[0].nodes[0].devices.map(d => d.name)).toEqual(['Torque 1', 'Torque 2'])
    expect(tree[1].unplaced).toBe(true)
  })

  it('lists every device at or below each level', () => {
    expect(tree[0].all.sort()).toEqual(['l', 'm', 't1', 't2'])
    expect(tree[0].nodes[0].all.sort()).toEqual(['t1', 't2'])
  })

  it('keeps two levels with the same name apart when their parents differ', () => {
    const t = device_tree([D('a', 'A', ['Works', 'North site', 'Machining']), D('b', 'B', ['Works', 'South site', 'Machining'])])
    const [north, south] = t[0].nodes
    expect(north.nodes[0].key).not.toBe(south.nodes[0].key)
    expect(north.nodes[0].all).toEqual(['a'])
  })

  it('is empty with no devices', () => {
    expect(device_tree([])).toEqual([])
  })
})

describe('tree_rows', () => {
  const D = (uuid, name, path) => ({ uuid, name, path })
  const tree = device_tree([
    D('t1', 'Torque 1', ['Works', 'North site']),
    D('m', 'Meter', ['Works']),
    D('l', 'Lathe', ['Works', 'South site']),
  ])
  const label = r => r.node ? `${'  '.repeat(r.depth)}[${r.node.name}]` : `${'  '.repeat(r.depth)}${r.device.name}`

  it('shows only the closed top level by default', () => {
    expect(tree_rows(tree).map(label)).toEqual(['[Works]'])
  })

  it('lists an open level\'s devices before its levels', () => {
    const open = new Set([tree[0].key, tree[0].nodes[0].key])
    expect(tree_rows(tree, { is_open: k => open.has(k) }).map(label))
      .toEqual(['[Works]', '  Meter', '  [North site]', '    Torque 1', '  [South site]'])
  })

  it('while searching, opens every level with a match and hides the rest', () => {
    const rows = tree_rows(tree, { match: d => d.name.startsWith('Torque') })
    expect(rows.map(label)).toEqual(['[Works]', '  [North site]', '    Torque 1'])
    expect(rows[0].uuids).toEqual(['t1'])
  })

  it('counts every device under a level when not searching', () => {
    expect(tree_rows(tree)[0].uuids.sort()).toEqual(['l', 'm', 't1'])
  })

  it('shows nothing when no device matches', () => {
    expect(tree_rows(tree, { match: () => false })).toEqual([])
  })
})

describe('path_label', () => {
  it('joins a path, or names a device with none', () => {
    expect(path_label(['Works', 'Hall 1'])).toBe('Works / Hall 1')
    expect(path_label(null)).toBe(NO_PATH)
  })
})

describe('merge_device_index', () => {
  it('adds ConfigDB details to i3X devices, and keeps ConfigDB-only ones', () => {
    const i3x = [{ uuid: DEV1, name: 'Meter', path: ['Works'], parent: 'ent' }]
    const configdb = [
      { uuid: DEV1, name: 'Meter (cdb)', sparkplug: 'Meter_1', metrics: [{ path: 'Load' }] },
      { uuid: DEV2, name: 'Spindle', sparkplug: 'Spindle_1', metrics: [] },
    ]
    const status = { [DEV2]: { online: true } }
    const out = merge_device_index(i3x, configdb, status)
    expect(out.map(d => [d.uuid, d.name, d.path, d.in_i3x])).toEqual([
      [DEV1, 'Meter', ['Works'], true],
      [DEV2, 'Spindle', [], false],
    ])
    expect(out[0].sparkplug).toBe('Meter_1')
    expect(out[1].status).toEqual({ online: true })
  })

  it('leaves the metric list unknown for a device only i3X shows', () => {
    const out = merge_device_index([{ uuid: DEV3, name: 'Chiller', path: ['Works'] }], [], {})
    expect(out[0].metrics).toBeNull()
  })
})
