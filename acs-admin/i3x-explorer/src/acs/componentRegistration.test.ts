/*
 * ACS Admin
 * Tests for which components a composition registered and may release
 * Copyright 2026 University of Sheffield
 */

import { describe, expect, it } from 'vitest'
import type { Subscription } from '../stores/subscriptions'
import { componentsToRelease, neededByComposition, runningComponents } from './componentRegistration'

const sub = (overrides: Partial<Subscription>): Subscription => ({
  id: 's',
  createdAt: '',
  isStreaming: true,
  monitoredItems: [],
  ...overrides,
})

describe('componentsToRelease', () => {
  it('releases only what nothing else still needs', () => {
    const subscription = sub({
      monitoredItems: ['press', 'mill', 'press:temp'],
      components: { press: ['press:speed', 'press:temp', 'shared'], mill: ['shared', 'mill:speed'] },
    })
    // press:temp is subscribed on its own; shared belongs to the mill too.
    expect(componentsToRelease(subscription, 'press')).toEqual(['press:speed'])
  })

  it('does not count a stopped composition as needing its components', () => {
    const subscription = sub({
      monitoredItems: ['press', 'mill'],
      components: { press: ['shared'], mill: ['shared'] },
      stoppedItems: ['mill'],
    })
    expect(componentsToRelease(subscription, 'press')).toEqual(['shared'])
  })
})

describe('neededByComposition', () => {
  it('is true while another running composition registered the element', () => {
    const subscription = sub({ monitoredItems: ['press', 'press:temp'], components: { press: ['press:temp'] } })
    expect(neededByComposition(subscription, 'press:temp')).toBe(true)
    expect(neededByComposition({ ...subscription, stoppedItems: ['press'] }, 'press:temp')).toBe(false)
  })
})

describe('runningComponents', () => {
  it('lists each running composition\'s components once', () => {
    expect(
      runningComponents({
        monitoredItems: ['press', 'mill', 'saw'],
        components: { press: ['a', 'shared'], mill: ['shared', 'b'], saw: ['c'] },
        stoppedItems: ['saw'],
      })
    ).toEqual(['a', 'shared', 'b'])
  })
})
