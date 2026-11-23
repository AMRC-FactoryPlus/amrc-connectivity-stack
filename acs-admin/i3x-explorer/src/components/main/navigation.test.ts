import { describe, expect, it } from 'vitest'
import { objectPath, objectPathSegments } from './navigation'
import type { ObjectInstance } from '../../api/types'

// ACS: element paths for rows listed out of tree context.
const object = (elementId: string, displayName: string, parentId: string | null): ObjectInstance =>
  ({ elementId, displayName, parentId, typeId: 't', namespaceUri: 'urn:test', isComposition: false }) as ObjectInstance

const indexOf = (...objects: ObjectInstance[]) => new Map(objects.map(item => [item.elementId, item]))

const site = object('site', 'Site', '/')
const station = object('station', 'Line 1', 'site')
const table = object('table', 'Press 3', 'station')
const xPos = object('x-pos', 'Spindle speed', 'table')

describe('objectPath', () => {
  it('joins the display names from the top of the hierarchy down to the element', () => {
    const index = indexOf(site, station, table, xPos)
    expect(objectPathSegments('x-pos', index)).toEqual(['Site', 'Line 1', 'Press 3', 'Spindle speed'])
    expect(objectPath('x-pos', index)).toBe('Site / Line 1 / Press 3 / Spindle speed')
  })

  it('is the name alone for a top-level element', () => {
    expect(objectPath('site', indexOf(site))).toBe('Site')
  })

  it('is undefined for an element the index does not hold', () => {
    expect(objectPath('x-pos', indexOf(site))).toBeUndefined()
  })

  it('starts at the highest ancestor loaded so far', () => {
    expect(objectPath('x-pos', indexOf(table, xPos))).toBe('Press 3 / Spindle speed')
  })

  it('uses the element id where a display name is empty', () => {
    expect(objectPath('x-pos', indexOf(site, { ...xPos, displayName: '', parentId: 'site' }))).toBe('Site / x-pos')
  })

  it('stops at a parent cycle instead of looping', () => {
    const a = object('a', 'A', 'b')
    const b = object('b', 'B', 'a')
    expect(objectPath('a', indexOf(a, b))).toBe('B / A')
  })
})
