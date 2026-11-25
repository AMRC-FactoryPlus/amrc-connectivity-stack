import { describe, expect, it } from 'vitest'

import { randomUuid } from './randomUuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  it('uses randomUUID where the browser offers it', () => {
    expect(randomUuid({ randomUUID: () => 'from-browser', getRandomValues: a => a })).toBe('from-browser')
  })

  it('makes a v4 UUID from getRandomValues on a plain-HTTP site', () => {
    // A crypto object without randomUUID, as on a site served over plain HTTP.
    const plain = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    const ids = new Set(Array.from({ length: 50 }, () => randomUuid(plain)))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(V4)
  })
})
