/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { describe, it, expect } from 'vitest'

import { random_uuid } from '@/lib/random-uuid.js'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('random_uuid', () => {
  it('uses randomUUID where the browser offers it', () => {
    expect(random_uuid({ randomUUID: () => 'from-browser' })).toBe('from-browser')
  })

  it('makes a v4 UUID from getRandomValues on a plain-HTTP site', () => {
    const plain = { getRandomValues: a => globalThis.crypto.getRandomValues(a) }
    const ids = new Set(Array.from({ length: 50 }, () => random_uuid(plain)))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(V4)
  })
})
