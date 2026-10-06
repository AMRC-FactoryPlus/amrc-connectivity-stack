/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Sub-device dataset metric selection: grouping, filtering, references
 * that no longer resolve, and group select-all.
 */

import { describe, it, expect } from 'vitest'

import {
  metric_key, key_to_ref,
  group_metrics, filter_groups, missing_keys, group_state, set_group,
} from '@/lib/sub-device.js'

const DEVICE = '55555555-5555-5555-5555-555555555555'
const AXIS = 'a1a1a1a1-0000-4000-8000-000000000001'
const CHARS = '1e74e2b2-44a3-44ff-8b2c-8c14a5f15c0b'

/* Shaped like GET v1/sparkplug-sources/:uuid/metrics. */
const METRICS = [
  { instance: DEVICE, metric: 'Switch_Closed', path: 'Switch_Closed', type: 'Boolean' },
  { instance: CHARS, metric: 'Current_AC', path: 'Characteristics/Current_AC', type: 'FloatLE', unit: 'A' },
  { instance: CHARS, metric: 'Voltage_AC', path: 'Characteristics/Voltage_AC', type: 'FloatLE', unit: 'V' },
  { instance: AXIS, metric: 'Position/Actual', path: 'Axes/X/Position/Actual', type: 'Double' },
]

const key = path => metric_key(METRICS.find(m => m.path === path))

describe('metric keys', () => {
  it('round-trip, including metric paths that contain slashes', () => {
    const ref = { instance: AXIS, metric: 'Position/Actual' }
    expect(key_to_ref(metric_key(ref))).toEqual(ref)
  })
})

describe('group_metrics', () => {
  const groups = group_metrics(METRICS)

  it('groups by object in origin-map order', () => {
    expect(groups.map(g => [g.instance, g.path])).toEqual([
      [DEVICE, ''],
      [CHARS, 'Characteristics'],
      [AXIS, 'Axes/X'],
    ])
  })

  it('keeps plain folders inside their object, in the metric name', () => {
    const [actual] = groups[2].metrics
    expect(actual.name).toBe('Position/Actual')
    expect(actual.key).toBe(`${AXIS}/Position/Actual`)
  })

  it('puts a metric in a plain folder at the device root in the device group', () => {
    const [device] = group_metrics([
      { instance: DEVICE, metric: 'Program/Line', path: 'Program/Line', type: 'Int32' },
    ])
    expect(device.path).toBe('')
    expect(device.metrics[0].name).toBe('Program/Line')
  })
})

describe('filter_groups', () => {
  const groups = group_metrics(METRICS)

  it('matches on the full path, ignoring case, and drops empty groups', () => {
    const filtered = filter_groups(groups, '  CURRENT ')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].metrics.map(m => m.path)).toEqual(['Characteristics/Current_AC'])
  })

  it('matches object names as well as metric names', () => {
    expect(filter_groups(groups, 'axes').map(g => g.path)).toEqual(['Axes/X'])
  })

  it('returns everything for an empty query', () => {
    expect(filter_groups(groups, '')).toBe(groups)
  })
})

describe('missing_keys', () => {
  it('lists saved references the device no longer offers', () => {
    const gone = `${'99999999-9999-4999-8999-999999999999'}/Old_Metric`
    expect(missing_keys([key('Switch_Closed'), gone], METRICS)).toEqual([gone])
  })
})

describe('group select-all', () => {
  const chars = group_metrics(METRICS)[1]

  it('reports none, some or all of a group as selected', () => {
    expect(group_state(chars, new Set())).toBe(false)
    expect(group_state(chars, new Set([key('Characteristics/Current_AC')]))).toBe('indeterminate')
    expect(group_state(chars, new Set(chars.metrics.map(m => m.key)))).toBe(true)
  })

  it('adds a whole group without duplicating or dropping other selections', () => {
    const selected = set_group([key('Switch_Closed'), key('Characteristics/Current_AC')], chars, true)
    expect(selected.sort()).toEqual([
      key('Switch_Closed'),
      key('Characteristics/Current_AC'),
      key('Characteristics/Voltage_AC'),
    ].sort())
  })

  it('removes a whole group and leaves the rest', () => {
    const selected = set_group(
      [key('Switch_Closed'), key('Characteristics/Current_AC')], chars, false)
    expect(selected).toEqual([key('Switch_Closed')])
  })
})
