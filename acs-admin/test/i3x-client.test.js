/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The i3X client turns the edges of a related lookup into the objects
 * the pages work with.
 */

import { describe, expect, it } from 'vitest'

import { REL, children_of, objects_of, register_outcome } from '../src/composables/useI3xClient.js'

const edge = (sourceRelationship, elementId) =>
  ({ sourceRelationship, object: { elementId, displayName: elementId.toUpperCase() } })

describe('objects_of', () => {
  it('gives each related object the relationship that leads to it', () => {
    expect(objects_of([edge(REL.HasParent, 'site'), edge(REL.HasChildren, 'dev')])).toEqual([
      { elementId: 'site', displayName: 'SITE', sourceRelationship: 'HasParent' },
      { elementId: 'dev', displayName: 'DEV', sourceRelationship: 'HasChildren' },
    ])
  })

  it('answers nothing for a missing result', () => {
    expect(objects_of(undefined)).toEqual([])
  })
})

describe('children_of', () => {
  it('keeps what a level holds and what a device is made of, and drops the way up', () => {
    const level = objects_of([edge(REL.HasParent, 'ent'), edge(REL.HasChildren, 'dev')])
    expect(children_of(level).map(o => o.elementId)).toEqual(['dev'])
    const device = objects_of([edge(REL.HasParent, 'site'), edge(REL.HasComponent, 'temp'), edge(REL.HasComponent, 'axes')])
    expect(children_of(device).map(o => o.elementId)).toEqual(['temp', 'axes'])
    const branch = objects_of([edge(REL.ComponentOf, 'dev'), edge(REL.HasComponent, 'x')])
    expect(children_of(branch).map(o => o.elementId)).toEqual(['x'])
  })
})

describe('register_outcome', () => {
  it('reads the status from the i3X 1.0 responseDetail', () => {
    expect(register_outcome([
      { success: true, elementId: 'a', result: null },
      { success: false, elementId: 'b', responseDetail: { title: 'Not Found', status: 404, detail: 'Element not found: b' } },
      { success: false, elementId: 'c', responseDetail: { title: 'Internal Server Error', status: 500, detail: 'boom' } },
    ], ['a', 'b', 'c', 'd'])).toEqual({ ok: ['a'], missing: ['b'], failed: ['c', 'd'] })
  })
})
