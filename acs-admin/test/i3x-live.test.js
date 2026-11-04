/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Live values from i3X: each id registers on its own, so one id i3X
 * does not show the person no longer stops the others. Ids that did
 * not register wait for the 30 s timer, which picks up new grants.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { register_outcome } from '../src/composables/useI3xClient.js'
import { useI3xLive, RETRY_MS } from '../src/composables/useI3xLive.js'

describe('register_outcome', () => {
  it('sorts ids into registered, not found and failed', () => {
    const out = register_outcome([
      { success: true, elementId: 'a', result: null },
      { success: false, elementId: 'b', error: { code: 404, message: 'Object b not found' } },
      { success: false, elementId: 'c', error: { code: 500, message: 'boom' } },
    ])
    expect(out).toEqual({ ok: ['a'], missing: ['b'], failed: ['c'] })
  })

  it('counts an id with no result as failed', () => {
    const out = register_outcome([{ success: true, elementId: 'a' }], ['a', 'b'])
    expect(out).toEqual({ ok: ['a'], missing: [], failed: ['b'] })
  })

  it('takes the first result for an id and skips results with no id', () => {
    const out = register_outcome([
      { success: true, elementId: 'a' },
      { success: false, elementId: 'a', error: { code: 404 } },
      { success: true },
    ])
    expect(out).toEqual({ ok: ['a'], missing: [], failed: [] })
  })

  it('handles no results', () => {
    expect(register_outcome(null)).toEqual({ ok: [], missing: [], failed: [] })
  })
})

/* A fake i3X. `visible` is the set of ids it shows this principal;
 * anything else answers 404, as i3X does. */
function fake_i3x ({ visible = [], fail = false } = {}) {
  const shown = new Set(visible)
  const calls = { create: 0, register: [], unregister: [], deleted: [], streams: 0 }
  let n = 0
  const client = {
    shown,
    calls,
    stream: null,
    async createSubscription () {
      calls.create++
      if (fail) throw new Error('i3X request failed: 503')
      return { subscriptionId: `sub-${++n}` }
    },
    async deleteSubscription (clientId, ids) { calls.deleted.push(...ids) },
    async registerEach (clientId, sub, ids) {
      calls.register.push([...ids])
      return ids.map(id => shown.has(id)
        ? { success: true, elementId: id, result: null }
        : { success: false, elementId: id, error: { code: 404, message: `Object ${id} not found` } })
    },
    async unregisterEach (clientId, sub, ids) {
      calls.unregister.push([...ids])
      return ids.map(id => ({ success: true, elementId: id }))
    },
    async streamSubscription (clientId, sub, onMessage, onClose) {
      calls.streams++
      client.stream = { sub, onMessage, onClose, closed: false, close () { this.closed = true } }
      return client.stream
    },
  }
  return client
}

describe('useI3xLive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('streams the ids it can see when another id is unknown', async () => {
    const client = fake_i3x({ visible: ['a', 'b'] })
    const got = []
    const live = useI3xLive(items => got.push(...items), { client })
    await live.watch(['a', 'b', 'gone'])

    expect(live.status.value).toBe('live')
    expect([...live.subscribed.value].sort()).toEqual(['a', 'b'])
    expect(client.calls.streams).toBe(1)

    client.stream.onMessage([{ elementId: 'a', value: 1 }])
    expect(got).toEqual([{ elementId: 'a', value: 1 }])
    await live.close()
  })

  it('is denied when i3X answers 404 for every id, and keeps no subscription', async () => {
    const client = fake_i3x({ visible: [] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a', 'b'])

    expect(live.status.value).toBe('denied')
    expect(live.subscribed.value.size).toBe(0)
    expect(client.calls.streams).toBe(0)
    expect(client.calls.deleted).toEqual(['sub-1'])
    await live.close()
  })

  it('tries parked ids again on the timer, and picks up a new grant', async () => {
    const client = fake_i3x({ visible: ['a'] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a', 'b'])
    expect([...live.subscribed.value]).toEqual(['a'])

    // Watching the same ids again does not ask about the parked one.
    await live.watch(['a', 'b'])
    expect(client.calls.register).toEqual([['a', 'b']])

    client.shown.add('b')
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(client.calls.register).toEqual([['a', 'b'], ['b']])
    expect([...live.subscribed.value].sort()).toEqual(['a', 'b'])
    // The same subscription and stream carry on.
    expect(client.calls.create).toBe(1)
    expect(client.calls.streams).toBe(1)
    await live.close()
  })

  it('goes live from denied once a grant arrives', async () => {
    const client = fake_i3x({ visible: [] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a'])
    expect(live.status.value).toBe('denied')

    client.shown.add('a')
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(live.status.value).toBe('live')
    expect(client.calls.create).toBe(2)
    expect(client.calls.streams).toBe(1)
    await live.close()
  })

  it('unregisters ids that are no longer wanted and forgets parked ones', async () => {
    const client = fake_i3x({ visible: ['a', 'b'] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a', 'b', 'gone'])
    await live.watch(['a'])

    expect(client.calls.unregister).toEqual([['b']])
    expect([...live.subscribed.value]).toEqual(['a'])
    // Nothing parked any more, so the timer asks nothing.
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(client.calls.register).toEqual([['a', 'b', 'gone']])
    await live.close()
  })

  it('is unavailable when i3X fails, and tries again in 30 s', async () => {
    const client = fake_i3x({ fail: true })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a'])
    expect(live.status.value).toBe('unavailable')
    expect(client.calls.create).toBe(1)

    await vi.advanceTimersByTimeAsync(RETRY_MS - 1)
    expect(client.calls.create).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.calls.create).toBe(2)
    await live.close()
  })

  it('starts again with a new subscription when the stream ends', async () => {
    const client = fake_i3x({ visible: ['a'] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a'])
    client.stream.onClose()

    expect(live.status.value).toBe('unavailable')
    expect(live.subscribed.value.size).toBe(0)
    expect(client.calls.deleted).toEqual(['sub-1'])

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(live.status.value).toBe('live')
    expect(client.calls.create).toBe(2)
    expect(client.calls.streams).toBe(2)
    await live.close()
  })

  it('is off with nothing to watch, and closes the subscription', async () => {
    const client = fake_i3x({ visible: ['a'] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a'])
    await live.watch([])

    expect(live.status.value).toBe('off')
    expect(client.stream.closed).toBe(true)
    expect(client.calls.deleted).toEqual(['sub-1'])
  })

  it('stops trying after close', async () => {
    const client = fake_i3x({ visible: [] })
    const live = useI3xLive(() => {}, { client })
    await live.watch(['a'])
    await live.close()
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3)
    expect(client.calls.create).toBe(1)
    expect(live.status.value).toBe('off')
  })
})
