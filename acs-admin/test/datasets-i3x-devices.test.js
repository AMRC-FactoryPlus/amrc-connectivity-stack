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
  devices_from_tree, group_by_path, path_chips, merge_device_index, path_label, NO_PATH,
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

describe('group_by_path', () => {
  it('groups under each path, sorted, with unplaced devices last', () => {
    const groups = group_by_path([
      { uuid: '1', name: 'b', path: ['Works', 'South site'] },
      { uuid: '2', name: 'z', path: [] },
      { uuid: '3', name: 'c', path: ['Works', 'North site'] },
      { uuid: '4', name: 'a', path: ['Works', 'South site'] },
    ])
    expect(groups.map(g => g.label)).toEqual(['Works / North site', 'Works / South site', NO_PATH])
    expect(groups[1].devices.map(d => d.name)).toEqual(['a', 'b'])
    expect(groups[2].path).toEqual([])
  })

  it('labels a path', () => {
    expect(path_label(['Works', 'Hall 1'])).toBe('Works / Hall 1')
    expect(path_label(null)).toBe(NO_PATH)
  })
})

describe('path_chips', () => {
  it('offers the first level at which the devices differ', () => {
    const devices = devices_from_tree(LEVELS, RELATED)
    expect(path_chips(devices)).toEqual({ depth: 1, values: ['North site', 'South site'] })
  })

  it('offers nothing when every device shares its path', () => {
    expect(path_chips([{ path: ['Works', 'Hall 1'] }, { path: ['Works', 'Hall 1'] }])).toBeNull()
    expect(path_chips([])).toBeNull()
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
