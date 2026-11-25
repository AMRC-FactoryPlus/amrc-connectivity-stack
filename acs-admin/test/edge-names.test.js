/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { describe, it, expect } from 'vitest'

import { driver_ids } from '@amrc-factoryplus/service-client/lib/edge-connection.js'
import {
  CONNECTION_NAME_HINT, EXTERNAL_NAME_HINT,
  connection_name_hint, connection_name_problem, external_name_problem,
  is_external_driver, name_problem,
} from '@/lib/edge-names.js'

const EXTERNAL = { external: true, polled: false }
const SPLIT = { image: { registry: 'r', repository: 'edge-modbus', tag: '1' } }

describe('name_problem', () => {
  it('allows the names either dialog allowed before', () => {
    for (const name of ['My CNC Machine', 'press_1', 'plc-1.line2', 'PLC-1'])
      expect(name_problem(name)).toBeNull()
  })

  it('allows hyphens and dots in a device name, and spaces in a connection name', () => {
    expect(name_problem('Press-1 Line.2')).toBeNull()
  })

  it('refuses Sparkplug topic characters and other symbols', () => {
    for (const name of ['Press/1', 'Press+1', 'Press#1', 'Press (old)', 'Prëss'])
      expect(name_problem(name)).toMatch(/Only letters, numbers/)
  })

  it('needs a letter or number', () => {
    expect(name_problem('-- __')).toMatch(/at least one letter or number/)
  })

  it('leaves an empty name to the required check', () => {
    expect(name_problem('')).toBeNull()
    expect(name_problem(null)).toBeNull()
  })
})

describe('external drivers', () => {
  it('knows an external DriverDef', () => {
    expect(is_external_driver(EXTERNAL)).toBe(true)
    expect(is_external_driver(SPLIT)).toBe(false)
    expect(is_external_driver(undefined)).toBe(false)
  })

  it('keeps an external connection name to what the driver broker routes', () => {
    expect(external_name_problem('my_driver-1')).toBeNull()
    expect(external_name_problem('my driver')).toMatch(/hyphens and underscores/)
    expect(external_name_problem('my.driver')).toMatch(/hyphens and underscores/)
    /* The Edge Agent's driver broker only routes fpEdge1/<id>/... for
     * an id of [\w-]+. */
    const topicrx = /^fpEdge1\/([\w-]+)\/(\w+)(?:\/(.+))?$/
    expect(topicrx.test('fpEdge1/my_driver-1/status')).toBe(true)
    expect(topicrx.test('fpEdge1/my.driver/status')).toBe(false)
  })

  it('applies the stricter rule only with an external driver', () => {
    expect(connection_name_problem('PLC line.2', SPLIT)).toBeNull()
    expect(connection_name_problem('PLC line.2', undefined)).toBeNull()
    expect(connection_name_problem('PLC line.2', EXTERNAL)).toMatch(/external driver/)
    expect(connection_name_problem('PLC/2', SPLIT)).toMatch(/Only letters/)
  })

  it('says the rule under the field before anyone types', () => {
    expect(connection_name_hint(SPLIT)).toBe(CONNECTION_NAME_HINT)
    expect(connection_name_hint(EXTERNAL)).toBe(EXTERNAL_NAME_HINT)
  })
})

describe('split driver ids', () => {
  it('works for any allowed connection name, so the rule needs nothing more', () => {
    const ids = driver_ids([
      { name: 'PLC line.2', uuid: '11111111-2222-3333-4444-555555555555' },
      { name: 'Press_1', uuid: '66666666-2222-3333-4444-555555555555' },
    ])
    for (const id of ids)
      expect(id).toMatch(/^[a-z0-9-]*[a-z0-9]$/i)
  })
})
