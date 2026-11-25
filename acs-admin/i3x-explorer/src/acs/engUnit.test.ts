/*
 * ACS: tests for reading engineering units from i3X object metadata, and for
 * the batched unit lookup.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ObjectInstance } from '../api/types'
import { createEngUnitLoader, engUnitOf, engUnitTitle } from './engUnit'

const object = (elementId: string, metadata?: Record<string, unknown>): ObjectInstance => ({
  elementId,
  displayName: elementId,
  typeId: 'type',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:test',
  metadata,
})

describe('engUnitOf', () => {
  it('shows the configured string, with the UNECE code beside it', () => {
    expect(engUnitOf({ engUnit: 'KWH', system: { Eng_Unit: 'kWh' } })).toEqual({ symbol: 'kWh', code: 'KWH' })
  })

  it('shows the code when the server sends only that', () => {
    expect(engUnitOf({ engUnit: 'CEL' })).toEqual({ symbol: 'CEL', code: 'CEL' })
  })

  it('shows a string that means no unit, without a code', () => {
    expect(engUnitOf({ system: { Eng_Unit: 'furlongs' } })).toEqual({ symbol: 'furlongs' })
  })

  it('trims spaces, and ignores blank and non-string values', () => {
    expect(engUnitOf({ engUnit: ' KWH ', system: { Eng_Unit: ' kWh ' } })).toEqual({ symbol: 'kWh', code: 'KWH' })
    expect(engUnitOf({ engUnit: '', system: { Eng_Unit: '  ' } })).toBeNull()
    expect(engUnitOf({ engUnit: 5, system: { Eng_Unit: true } })).toBeNull()
    expect(engUnitOf({ system: 'kWh' })).toBeNull()
  })

  it('is null without a unit or without metadata', () => {
    expect(engUnitOf({ sourceTypeId: 'metric-number' })).toBeNull()
    expect(engUnitOf(undefined)).toBeNull()
  })
})

describe('engUnitTitle', () => {
  it('names the code, once when it is also the symbol', () => {
    expect(engUnitTitle({ symbol: 'kWh', code: 'KWH' })).toBe('kWh: UNECE code KWH')
    expect(engUnitTitle({ symbol: 'CEL', code: 'CEL' })).toBe('UNECE code CEL')
  })

  it('says when a string has no code', () => {
    expect(engUnitTitle({ symbol: 'furlongs' })).toBe('furlongs: no UNECE code (not in the engineering unit vocabulary)')
  })
})

describe('createEngUnitLoader', () => {
  const units: Record<string, Record<string, unknown>> = {
    temp: { engUnit: 'CEL', system: { Eng_Unit: '°C' } },
    power: { engUnit: 'KWH', system: { Eng_Unit: 'kWh' } },
    mode: { sourceTypeId: 'metric-string' },
  }
  const server = () =>
    vi.fn(async (ids: string[]) => ({
      objects: ids.filter(id => id in units).map(id => object(id, units[id])),
    }))

  it('asks for every id wanted in one tick in one request, each id once', async () => {
    const fetch = server()
    const load = createEngUnitLoader(fetch)

    const results = await Promise.all([load('temp'), load('power'), load('temp'), load('mode')])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(['temp', 'power', 'mode'])
    expect(results).toEqual([
      { symbol: '°C', code: 'CEL' },
      { symbol: 'kWh', code: 'KWH' },
      { symbol: '°C', code: 'CEL' },
      null,
    ])
  })

  it('gives no unit to an id the server does not answer for', async () => {
    const load = createEngUnitLoader(server())
    await expect(load('gone')).resolves.toBeNull()
  })

  it('asks again for ids wanted later', async () => {
    const fetch = server()
    const load = createEngUnitLoader(fetch)

    await load('temp')
    await load('power')

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls).toEqual([[['temp']], [['power']]])
  })

  it('fails every lookup in a batch whose request fails', async () => {
    const load = createEngUnitLoader(async () => {
      throw new Error('offline')
    })
    const results = await Promise.allSettled([load('temp'), load('power')])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
  })
})
