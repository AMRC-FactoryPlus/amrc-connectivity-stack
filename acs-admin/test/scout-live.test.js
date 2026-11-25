/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Live values: the JSONPath evaluator for MQTT JSON leaves, the
 * addresses a lease asks for, the requests, what a row shows and the
 * wording.
 */

import { describe, it, expect } from 'vitest'

import {
  apply_path,
  live_counts,
  live_value,
  parse_path,
  unwatch_request,
  watch_addresses,
  watch_request,
} from '../src/lib/scout/live.js'
import {
  LIVE_CONFIRM,
  live_blocked_text,
  live_status_text,
  read_age_text,
  watch_refusal_text,
} from '../src/lib/scout/text.js'

describe('parse_path', () => {
  it('reads the dotted and bracket forms a scan writes', () => {
    expect(parse_path('$')).toEqual([])
    expect(parse_path('$.a.b[0]')).toEqual(['a', 'b', 0])
    expect(parse_path("$['odd key']")).toEqual(['odd key'])
    expect(parse_path("$.a['b c'][12].d")).toEqual(['a', 'b c', 12, 'd'])
    expect(parse_path('$["x"]')).toEqual(['x'])
    expect(parse_path("$['it\\'s']")).toEqual(["it's"])
    expect(parse_path("$['']")).toEqual([''])
  })

  it('refuses anything else', () => {
    for (const p of [null, '', 'a.b', '$.', '$..a', '$[*]', '$[-1]', "$['a'", "$['a']x", '$.a[', '$[a]', '$.a[?(@.x)]'])
      expect(parse_path(p), String(p)).toBeNull()
  })
})

describe('apply_path', () => {
  const doc = { t: 21.4, a: { b: [10, { c: 'x' }] }, 'odd key': true, n: null, list: [] }

  it('finds leaves', () => {
    expect(apply_path(doc, '$.t')).toEqual({ found: true, value: 21.4 })
    expect(apply_path(doc, '$.a.b[0]')).toEqual({ found: true, value: 10 })
    expect(apply_path(doc, '$.a.b[1].c')).toEqual({ found: true, value: 'x' })
    expect(apply_path(doc, "$['odd key']")).toEqual({ found: true, value: true })
    expect(apply_path(doc, '$.n')).toEqual({ found: true, value: null })
    expect(apply_path(42, '$')).toEqual({ found: true, value: 42 })
  })

  it('says when a leaf is not there', () => {
    expect(apply_path(doc, '$.missing').found).toBe(false)
    expect(apply_path(doc, '$.a.b[5]').found).toBe(false)
    expect(apply_path(doc, '$.t.x').found).toBe(false)
    expect(apply_path(doc, '$.a[0]').found).toBe(false)
    expect(apply_path(doc, '$.list.length').found).toBe(false)
    expect(apply_path(doc, '$.a.b.0').found).toBe(false)
    expect(apply_path(doc, '$.constructor').found).toBe(false)
    expect(apply_path(doc, 'bad').found).toBe(false)
  })
})

const value = (id, extra = {}) => ({ id, parent: null, name: id, kind: 'value', address: id, path: null, ...extra })

describe('watch_addresses', () => {
  it('keeps value items once each, in order', () => {
    const items = [
      value('a'),
      { id: 'f', kind: 'folder' },
      value('t\u0000$.x', { address: 't', path: '$.x' }),
      value('t\u0000$.y', { address: 't', path: '$.y' }),
      value('b'),
      value('a2', { address: 'a' }),
    ]
    expect(watch_addresses(items)).toEqual(['a', 't', 'b'])
  })

  it('asks for at most 40', () => {
    const items = Array.from({ length: 60 }, (_, i) => value(`v${i}`))
    const out = watch_addresses(items)
    expect(out).toHaveLength(40)
    expect(out[39]).toBe('v39')
  })

  it('skips addresses the agent would refuse', () => {
    expect(watch_addresses([value('x', { address: '' }), value('y', { address: 'z'.repeat(1025) }), value('ok')]))
      .toEqual(['ok'])
    expect(watch_addresses(null)).toEqual([])
  })
})

describe('requests', () => {
  it('builds watch and unwatch as the spec shows them', () => {
    expect(watch_request({ request: 'r', connection: 'c', lease: 'l', addresses: ['a'] })).toEqual({
      version: 1, op: 'watch', request: 'r', connection: 'c', lease: 'l', addresses: ['a'],
    })
    expect(unwatch_request({ request: 'r', connection: 'c', lease: 'l' })).toEqual({
      version: 1, op: 'unwatch', request: 'r', connection: 'c', lease: 'l',
    })
  })
})

describe('live_value', () => {
  const read = '2026-11-25T10:00:00Z'
  const entry = {
    version: 1, node: 'n', leases: 1, dropped: 0,
    values: {
      'ns=2;s=Speed': { value: '1450.5', type: 'Double', ts: 1, read, error: null },
      'ns=2;s=Gone': { value: null, type: null, ts: null, read, error: 'BadNodeIdUnknown' },
      'plant/temp': { value: '{"t":21.4,"s":{"ok":true},"l":["a","b"]}', type: 'String', ts: 1, read, error: null },
      'plant/text': { value: 'hello', type: 'String', ts: 1, read, error: null },
      'plant/long': { value: '{"t":' + '1'.repeat(1019), type: 'String', ts: 1, read, error: null },
      'plant/quiet': { value: null, type: null, ts: null, read, error: 'No message yet' },
    },
  }

  it('gives a plain value with its read time and type', () => {
    expect(live_value(value('ns=2;s=Speed'), entry)).toEqual({ text: '1450.5', error: null, read, type: 'Double' })
  })

  it('passes an error through', () => {
    expect(live_value(value('ns=2;s=Gone'), entry)).toMatchObject({ text: null, error: 'BadNodeIdUnknown' })
    expect(live_value(value('q', { address: 'plant/quiet', path: '$.t' }), entry).error).toBe('No message yet')
  })

  it('applies a JSON leaf path to the payload', () => {
    const leaf = path => value(`plant/temp\u0000${path}`, { address: 'plant/temp', path })
    expect(live_value(leaf('$.t'), entry).text).toBe('21.4')
    expect(live_value(leaf('$.s.ok'), entry).text).toBe('true')
    expect(live_value(leaf('$.l[1]'), entry).text).toBe('b')
    expect(live_value(leaf('$.s'), entry).text).toBe('{"ok":true}')
    expect(live_value(leaf('$.nope'), entry)).toMatchObject({ text: null, error: 'Not in the latest message' })
  })

  it('says why a leaf cannot be read from a payload that is not JSON or was cut', () => {
    expect(live_value(value('x', { address: 'plant/text', path: '$.t' }), entry).error).toBe('The latest message is not JSON.')
    expect(live_value(value('x', { address: 'plant/long', path: '$.t' }), entry).error).toMatch(/too long/)
  })

  it('shows the value as it is for a driver path that is not a JSONPath', () => {
    /* edge-test gives its items the metric path "0". Found on a dev
     * cluster, where every edge-test row said "Not in the latest
     * message". */
    expect(live_value(value('t', { address: 'ns=2;s=Speed', path: '0' }), entry))
      .toEqual({ text: '1450.5', error: null, read, type: 'Double' })
  })

  it('has nothing for an address the entry does not hold', () => {
    expect(live_value(value('other'), entry)).toBeNull()
    expect(live_value(value('ns=2;s=Speed'), null)).toBeNull()
    expect(live_value(value('constructor'), entry)).toBeNull()
  })
})

describe('live wording', () => {
  it('uses the spec text in the dialog', () => {
    expect(LIVE_CONFIRM.message).toBe('The Edge Agent will read the addresses on screen from the device every 5 seconds while this panel is open. This adds a small load to the device and the Edge Agent. Turn it off when you have finished.')
    expect(LIVE_CONFIRM.confirmText).toBe('Turn on')
    expect(LIVE_CONFIRM.cancelText).toBe('Cancel')
  })

  it('says why the switch is disabled', () => {
    expect(live_blocked_text('offline')).toMatch(/online/)
    expect(live_blocked_text('no_permission')).toMatch(/Scan device addresses permission/)
    expect(live_blocked_text('noreads')).toBe("This driver can't read live values.")
    expect(live_blocked_text('unknown')).toMatch(/Update them/)
    expect(live_blocked_text(null)).toBeNull()
  })

  it('has plain words for a refused watch', () => {
    expect(watch_refusal_text('NOREADS')).toBe("Live values stopped because this driver can't read values.")
    expect(watch_refusal_text('LIMIT')).toMatch(/four other panels/)
    expect(watch_refusal_text('UNDEPLOYED')).toMatch(/^Live values stopped\. The Edge Agent has not loaded/)
    expect(watch_refusal_text('NODRIVER', { message: 'CONN' })).toBe("Live values stopped. The driver isn't ready. CONN.")
  })

  it('counts what is shown and what the agent left out', () => {
    const entry = { leases: 2, dropped: 5, values: { a: {}, b: {} } }
    expect(live_counts(entry, ['a', 'b', 'c'])).toEqual({ shown: 2, dropped: 5 })
    expect(live_counts(null, ['a'])).toEqual({ shown: 0, dropped: 0 })
    expect(live_status_text({ started: true, wanted: 3, shown: 2, dropped: 0 })).toBe('Showing live values for 2 addresses.')
    expect(live_status_text({ started: true, wanted: 40, shown: 40, dropped: 5 }))
      .toBe('Showing live values for 40 addresses. The Edge Agent reads at most 40 addresses on this connection, so it left out 5 addresses.')
    expect(live_status_text({ started: false, wanted: 3, shown: 0, dropped: 0 })).toBe('Waiting for the first values.')
    expect(live_status_text({ started: false, wanted: 0, shown: 0, dropped: 0 })).toMatch(/Scroll/)
  })

  it('gives the age of a value', () => {
    expect(read_age_text('2026-11-25T10:00:00Z', Date.parse('2026-11-25T10:00:03Z'))).toBe('Read 3 s ago')
    expect(read_age_text('2026-11-25T10:00:00Z', Date.parse('2026-11-25T10:01:05Z'))).toBe('Read 1 min 5 s ago')
    expect(read_age_text(null, 1)).toBeNull()
  })
})
