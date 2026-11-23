// ACS: "Active only" hides rows still waiting for their first update.
import { describe, it, expect } from 'vitest'
import { visibleRows } from './activeOnly'

const rows = [
  { elementId: 'press', rootId: 'press', isComponent: false },
  { elementId: 'speed', rootId: 'press', isComponent: true },
  { elementId: 'alarm', rootId: 'press', isComponent: true },
  { elementId: 'temp', rootId: 'temp', isComponent: false },
  { elementId: 'quiet', rootId: 'quiet', isComponent: false },
]

describe('visibleRows', () => {
  it('shows everything when off', () => {
    expect(visibleRows(rows, false, () => false)).toEqual(rows)
  })

  it('hides waiting rows and keeps the heading of an active component', () => {
    const active = new Set(['speed', 'temp'])
    expect(visibleRows(rows, true, id => active.has(id)).map(r => r.elementId))
      .toEqual(['press', 'speed', 'temp'])
  })

  it('hides a composition with no active components', () => {
    expect(visibleRows(rows, true, () => false)).toEqual([])
  })
})
