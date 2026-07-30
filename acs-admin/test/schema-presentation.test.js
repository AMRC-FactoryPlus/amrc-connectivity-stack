/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Presentation conventions.
 *
 * The type selector shows types by group. A Sparkplug type missing from
 * the groups would be unreachable in the editor, and a duplicated one
 * would appear twice, so the grouping is asserted against the canonical
 * list rather than left to inspection.
 */

import { describe, it, expect } from 'vitest'

import { SPARKPLUG_TYPES, NodeKind } from '../src/lib/schema/constants.js'
import {
  GROUPED_TYPES,
  NODE_PRESENTATION,
  TYPE_GROUPS,
  lifecycleOf,
  originOf,
  presentationFor,
} from '../src/lib/schema/presentation.js'

describe('type grouping', () => {
  it('covers every Sparkplug type exactly once', () => {
    expect([...GROUPED_TYPES].sort()).toEqual([...SPARKPLUG_TYPES].sort())
  })

  it('has no duplicates across groups', () => {
    expect(new Set(GROUPED_TYPES).size).toEqual(GROUPED_TYPES.length)
  })

  it('gives every group a label and at least one type', () => {
    for (const group of TYPE_GROUPS) {
      expect(group.label).toBeTruthy()
      expect(group.types.length).toBeGreaterThan(0)
    }
  })
})

describe('node presentation', () => {
  it('has an entry for every node kind', () => {
    for (const kind of Object.values(NodeKind))
      expect(NODE_PRESENTATION[kind]).toBeDefined()
  })

  it('falls back to the not-modelled treatment for an unknown kind', () => {
    expect(presentationFor('something-else').title).toEqual('Not modelled')
  })

  it('uses amber for groups, matching the folder glyph already in the app', () => {
    expect(NODE_PRESENTATION[NodeKind.GROUP].colour).toEqual('text-amber-500')
  })

  it('never uses red, which is reserved for failure', () => {
    for (const entry of Object.values(NODE_PRESENTATION))
      expect(entry.colour).not.toMatch(/red/)
  })
})

describe('lifecycle', () => {
  it('badges a draft', () => {
    expect(lifecycleOf({ isDraft: true }).label).toEqual('Draft')
  })

  it('badges a superseded schema', () => {
    expect(lifecycleOf({ supersededBy: 'other' }).label).toEqual('Superseded')
  })

  it('leaves a published schema unbadged, since that is the default state', () => {
    expect(lifecycleOf({ isDraft: false, supersededBy: null })).toBeNull()
  })
})

describe('origin', () => {
  it('marks library rows with a lock', () => {
    expect(originOf({ origin: 'AMRC library' }).icon).toEqual('fa-lock')
  })

  it('marks local rows with a pin', () => {
    expect(originOf({ origin: 'Local' }).icon).toEqual('fa-location-dot')
  })

  /* Origin is carried by the glyph alone. A deployment is almost all
   * library, so tying it to name colour greyed the whole table. */
  it('does not colour the name', () => {
    expect(originOf({ origin: 'AMRC library' }).name).toBeUndefined()
    expect(originOf({ origin: 'Local' }).name).toBeUndefined()
    expect(originOf({ origin: 'Local', supersededBy: 'x' }).name).toBeUndefined()
  })
})
