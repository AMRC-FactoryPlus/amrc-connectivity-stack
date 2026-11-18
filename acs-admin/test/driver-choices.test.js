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

import { driverByUuid, driverChoices } from '../src/utils/driverChoices.js'

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

  it('never finds a driver by its name', () => {
    expect(source).not.toMatch(/d\.name\s*===?/)
    expect(source).not.toMatch(/selectedDriverName/)
  })
})
