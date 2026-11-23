/*
 * ACS: tests for listing a container's children and reading their values.
 */

import { describe, expect, it, vi } from 'vitest'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { isContainer, readChildValues, valueChildren } from './childValues'

const object = (elementId: string, parentId: string | null, extra: Partial<ObjectInstance> = {}): ObjectInstance => ({
  elementId,
  displayName: elementId,
  typeId: 'type',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
  ...extra,
})

const related = (target: ObjectInstance, sourceRelationship: string): ObjectInstance =>
  ({ ...target, sourceRelationship })

describe('valueChildren', () => {
  const line = object('line-1', 'site')
  const press = object('press-3', 'line-1', { isComposition: true })
  const robot = object('robot-2', 'line-1')

  it('keeps the catalog order and adds HasChildren and HasComponent targets the catalog does not place here', () => {
    const tank = object('tank', 'elsewhere')
    const children = valueChildren('line-1', [press, robot], [
      related(object('site', null), 'HasParent'),
      related(robot, 'HasChildren'),
      related(tank, 'HasComponent'),
      related(object('subtype', null), 'InheritedBy'),
      related(object('peer', null), 'Monitors'),
    ], new Map())
    expect(children.map(c => c.elementId)).toEqual(['press-3', 'robot-2', 'tank'])
  })

  it('prefers the catalog copy of a related child', () => {
    const full = object('tank', 'line-1', { displayName: 'Tank' })
    const children = valueChildren('line-1', [], [related(object('tank', null), 'HasComponent')], new Map([['tank', full]]))
    expect(children[0]).toBe(full)
  })

  it('never lists the parent under itself', () => {
    expect(valueChildren('line-1', [line], [related(line, 'HasChildren')], new Map())).toEqual([])
  })
})

describe('isContainer', () => {
  const empty = { childrenByParent: new Map(), relatedObjects: new Map(), objectIndex: new Map() }

  it('is true for a composition', () => {
    expect(isContainer(object('press', null, { isComposition: true }), empty)).toBe(true)
  })

  it('is true for an organisational level with children in the catalog', () => {
    const level = object('line-1', 'site')
    const source = { ...empty, childrenByParent: new Map([['line-1', [object('press', 'line-1')]]]) }
    expect(isContainer(level, source)).toBe(true)
  })

  it('is true when the related objects hold a child edge', () => {
    const level = object('line-1', 'site')
    const source = { ...empty, relatedObjects: new Map([['line-1', [related(object('press', null), 'HasChildren')]]]) }
    expect(isContainer(level, source)).toBe(true)
  })

  it('is false for a metric', () => {
    const metric = object('spindle-speed', 'press')
    const source = { ...empty, relatedObjects: new Map([['spindle-speed', [related(object('press', null), 'ComponentOf')]]]) }
    expect(isContainer(metric, source)).toBe(false)
  })
})

describe('readChildValues', () => {
  it('reads each child at maxDepth 1, in batches, keyed by element', async () => {
    const getValues = vi.fn(async (ids: string[], maxDepth?: number) => {
      expect(maxDepth).toBe(1)
      return ids.map(id => ({ elementId: id, value: id.length } as unknown as LastKnownValue))
    })
    const values = await readChildValues({ getValues }, ['a', 'bb', 'ccc'], 2)
    expect(getValues.mock.calls.map(call => call[0])).toEqual([['a', 'bb'], ['ccc']])
    expect(values.get('ccc')?.value).toBe(3)
  })

  it('leaves out an element the server did not answer for', async () => {
    const values = await readChildValues({ getValues: async () => [] }, ['a'])
    expect(values.has('a')).toBe(false)
  })
})
