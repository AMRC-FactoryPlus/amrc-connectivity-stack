// ACS: search matches names the way people type them.
import { describe, it, expect } from 'vitest'
import { matchesQuery, matchRank, queryWords } from './searchMatch'

describe('search matching', () => {
  it('ignores case, spaces and underscores', () => {
    expect(matchesQuery('PressThreeNorth', 'id', 'press three')).toBe(true)
    expect(matchesQuery('Press_3_North', 'id', 'press 3')).toBe(true)
    expect(matchesQuery('PressThreeNorth', 'id', 'pressthree')).toBe(true)
  })

  it('takes the words in any order', () => {
    expect(matchesQuery('PressThreeNorth', 'id', 'north press')).toBe(true)
  })

  it('needs every word', () => {
    expect(matchesQuery('PressThreeNorth', 'id', 'press south')).toBe(false)
  })

  it('still matches an element ID as typed', () => {
    expect(matchesQuery('Spindle speed', '850a6e3e-271c', '850a6e3e')).toBe(true)
  })

  it('matches nothing for a blank query', () => {
    expect(queryWords('  ')).toEqual([])
    expect(matchesQuery('Anything', 'id', ' ')).toBe(false)
  })

  it('ranks names that start with the query first', () => {
    expect(matchRank('PressThreeNorth', 'press three')).toBe(0)
    expect(matchRank('NorthPressThree', 'press three')).toBe(1)
  })
})
