/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * A version 2 driver document cannot keep the picker open over the
 * editor. After the operator closes the picker without choosing, a
 * request inside the wait is answered with no item and starts the wait
 * again, so a document that asks on every answer never reopens it.
 */

import { describe, it, expect } from 'vitest'

import { PICK_COOLDOWN_MS, REFUSE_DELAY_MS, create_host } from '../src/lib/driver-ui/host.js'

const ITEM = { id: 'a', parent: null, name: 'A', kind: 'value', address: 'ns=2;s=A', path: null, sample: '1' }

function world ({ choose = () => null } = {}) {
  let t = 1_000_000
  const timers = []
  const posted = []
  const opened = []
  const host = create_host({
    post: m => posted.push(m),
    document: '<p>doc</p>',
    version: 2,
    init_values: () => ({ config: {}, metric: {}, allowed_types: [] }),
    scout: {
      summary: () => ({ available: true }),
      index: () => ({ by_id: new Map() }),
      pick: async filter => { opened.push(filter); return choose() },
    },
    on: {},
    now: () => t,
    set_timeout: (fn, ms) => timers.push({ at: t + ms, fn }),
  })
  const advance = async ms => {
    t += ms
    for (const tm of timers.filter(x => x.at <= t)) {
      timers.splice(timers.indexOf(tm), 1)
      tm.fn()
    }
    await Promise.resolve()
  }
  const ask = async () => {
    host.handle({ fpDriverUi: 2, type: 'pick-address' })
    await Promise.resolve()
    await Promise.resolve()
  }
  return { host, posted, opened, advance, ask, timers }
}

const picks = posted => posted.filter(m => m.type === 'picked')

describe('pick-address after the operator cancels', () => {
  it('does not reopen the picker for a document that asks again at once', async () => {
    const w = world()
    await w.ask()
    expect(w.opened.length).toBe(1)
    expect(picks(w.posted).at(-1).item).toBeNull()

    /* A hostile document asks on every answer. */
    for (let i = 0; i < 10; i++) {
      await w.ask()
      await w.advance(REFUSE_DELAY_MS)
    }
    expect(w.opened.length).toBe(1)
    expect(picks(w.posted).length).toBe(11)
    expect(picks(w.posted).every(m => m.item === null)).toBe(true)
  })

  it('answers several requests in the wait with one refusal', async () => {
    const w = world()
    await w.ask()
    await w.ask()
    await w.ask()
    await w.ask()
    expect(w.timers.length).toBe(1)
    await w.advance(REFUSE_DELAY_MS)
    expect(picks(w.posted).length).toBe(2)
  })

  it('opens the picker again once the document has been quiet', async () => {
    const w = world()
    await w.ask()
    await w.advance(PICK_COOLDOWN_MS)
    await w.ask()
    expect(w.opened.length).toBe(2)
  })

  it('does not wait after the operator chose an item', async () => {
    const w = world({ choose: () => ITEM })
    await w.ask()
    await w.ask()
    expect(w.opened.length).toBe(2)
    expect(picks(w.posted).map(m => m.item?.id)).toEqual(['a', 'a'])
    expect(picks(w.posted)[0].item).not.toHaveProperty('sample')
  })
})
