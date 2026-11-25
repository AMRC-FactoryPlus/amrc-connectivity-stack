/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * After an upgrade to ACS 7 the retired built-in DriverDefs are kept,
 * hidden, with the same names as the split DriverDefs that replace
 * them. The connection dialog must offer and find drivers by UUID, so
 * a new connection never lands on a retired driver and an edit never
 * moves a connection to the other driver of the same name.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

import { UNNAMED_DRIVER, driverByUuid, driverChoices, driverLabel } from '../src/utils/driverChoices.js'

const BUILTIN_REST = { uuid: 'rest-builtin', name: 'REST', definition: { hidden: true } }
const SPLIT_REST = { uuid: 'rest-split', name: 'REST', definition: { image: { repository: 'edge-rest' } } }
const MODBUS = { uuid: 'modbus', name: 'Modbus', definition: { image: { repository: 'edge-modbus' } } }

/* The retired driver first, as the store may list it. */
const drivers = [BUILTIN_REST, MODBUS, SPLIT_REST]

describe('driverChoices', () => {
  it('leaves retired drivers out for a new connection', () => {
    expect(driverChoices(drivers).map(d => d.uuid)).toEqual(['modbus', 'rest-split'])
  })

  it('offers each name once for a new connection', () => {
    const names = driverChoices(drivers).map(d => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the retired driver a connection already uses', () => {
    expect(driverChoices(drivers, 'rest-builtin').map(d => d.uuid))
      .toEqual(['modbus', 'rest-builtin', 'rest-split'])
  })
})

/* An older service-setup registered the shared image settings of an
 * old edge-agent chart as a driver named "(unknown driver)", with an
 * image but no repository. */
const IMAGE_DEFAULTS = { uuid: 'defaults', name: '(unknown driver)',
  definition: { image: { registry: 'reg.example', tag: 'v3.0.0' } } }
const NO_NAME = { uuid: 'no-name', definition: { image: { repository: 'edge-x' } } }
const BLANK_NAME = { uuid: 'blank', name: '  ', definition: { image: { repository: 'edge-y' } } }
const NO_DEF = { uuid: 'no-def', name: 'Half made' }
const EXTERNAL = { uuid: 'external', name: 'External driver', definition: { external: true } }

describe('drivers that cannot be offered', () => {
  const all = [IMAGE_DEFAULTS, NO_NAME, BLANK_NAME, NO_DEF, EXTERNAL, MODBUS]

  it('leaves out drivers with no name, no DriverDef, or an image with no repository', () => {
    expect(driverChoices(all).map(d => d.uuid)).toEqual(['external', 'modbus'])
  })

  it('never offers "(unknown driver)" first', () => {
    expect(driverChoices(all).map(d => d.name)).not.toContain('(unknown driver)')
  })

  it('still lists one a connection already uses, labelled sensibly', () => {
    const choices = driverChoices(all, 'no-name')
    expect(choices.map(d => d.uuid)).toContain('no-name')
    expect(driverLabel(NO_NAME)).toBe(UNNAMED_DRIVER)
    expect(driverLabel(BLANK_NAME)).toBe(UNNAMED_DRIVER)
    expect(driverLabel(MODBUS)).toBe('Modbus')
  })
})

describe('driverByUuid', () => {
  it('finds the split driver, not the retired one with the same name', () => {
    expect(driverByUuid(drivers, 'rest-split')).toBe(SPLIT_REST)
  })

  it('finds the retired driver an existing connection uses', () => {
    expect(driverByUuid(drivers, 'rest-builtin')).toBe(BUILTIN_REST)
  })

  it('finds nothing with no UUID', () => {
    expect(driverByUuid(drivers, undefined)).toBeUndefined()
    expect(driverByUuid(drivers, null)).toBeUndefined()
  })
})

/* The dialog itself has no component tests, so check it chooses and
 * finds by UUID rather than by name. */
describe('the connection dialog', () => {
  const source = fs.readFileSync(new URL(
    '../src/components/EdgeManager/Connections/NewConnectionDialog.vue', import.meta.url), 'utf8')

  it('uses the UUID as the value of each choice', () => {
    expect(source).toMatch(/<SelectItem v-for="driver in sortedDrivers" :value="driver\.uuid"/)
  })

  it('shows each driver by its label, so an unnamed one is not blank', () => {
    expect(source).toMatch(/\{\{driverLabel\(driver\)\}\}/)
  })

  it('never finds a driver by its name', () => {
    expect(source).not.toMatch(/d\.name\s*===?/)
    expect(source).not.toMatch(/selectedDriverName/)
  })
})
