/*
 * ACS Admin
 * Tests for how a subscriptions row names its element
 * Copyright 2026 University of Sheffield
 */

import { describe, expect, it } from 'vitest'
import { relativeSegments, rowLabel } from './rowLabel'

const line = ['Site', 'Line 1', 'Press 3']

describe('relativeSegments', () => {
  it('keeps a monitored item\'s full path', () => {
    expect(relativeSegments([...line, 'Spindle speed'], undefined)).toEqual([...line, 'Spindle speed'])
  })

  it('names a component by its path below its composition', () => {
    expect(relativeSegments([...line, 'Spindle speed'], line)).toEqual(['Spindle speed'])
    expect(relativeSegments([...line, 'Axis X', 'Position'], line)).toEqual(['Axis X', 'Position'])
  })

  it('falls back to the full path when the component is not under the composition', () => {
    expect(relativeSegments(['Site', 'Line 2', 'Spindle speed'], line)).toEqual(['Site', 'Line 2', 'Spindle speed'])
    expect(relativeSegments(line, line)).toEqual(line)
  })
})

describe('rowLabel', () => {
  it('puts only the leading names in the trimmable part and the leaf on its own', () => {
    expect(rowLabel([...line, 'Spindle speed'])).toEqual({
      lead: 'Site / Line 1 / Press 3',
      leaf: 'Spindle speed',
      full: 'Site / Line 1 / Press 3 / Spindle speed',
    })
  })

  it('has no lead for a component directly under its composition, and keeps the full path for the tooltip', () => {
    expect(rowLabel([...line, 'Spindle speed'], line)).toEqual({
      lead: '',
      leaf: 'Spindle speed',
      full: 'Site / Line 1 / Press 3 / Spindle speed',
    })
    expect(rowLabel([...line, 'Axis X', 'Position'], line).lead).toBe('Axis X')
  })
})
