import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpStatusError, PollingSubscription, SSESubscription, isSubscriptionGoneError, parseStreamEvent } from './subscription'
import type { SyncResponseItem } from './types'
import { BearerTokenProvider, StaticAuthProvider } from './authProvider'

// Flush chained microtasks (each `await` in the class body consumes one turn).
async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

// A 200 response whose stream ends immediately, drives the reconnect path.
function endedStreamResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: async () => ({ done: true as const, value: undefined }),
      }),
    },
  } as unknown as Response
}

// A 200 response that streams these SSE chunks, then ends.
function streamingResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  const queue = [...chunks]
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: async () => {
          const chunk = queue.shift()
          return chunk === undefined
            ? { done: true as const, value: undefined }
            : { done: false as const, value: encoder.encode(chunk) }
        },
      }),
    },
  } as unknown as Response
}

function errorResponse(status: number, statusText: string) {
  return { ok: false, status, statusText, body: null } as unknown as Response
}

describe('SSESubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('disconnect() cancels a pending reconnect, no zombie fetch after deletion', async () => {
    const fetchStub = vi.fn(async () => endedStreamResponse())
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()
    // Stream ended → a reconnect timer is now pending.
    expect(fetchStub).toHaveBeenCalledTimes(1)

    sub.disconnect()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('connect() while a reconnect is pending leaves exactly one live loop', async () => {
    const fetchStub = vi.fn(async () => endedStreamResponse())
    vi.stubGlobal('fetch', fetchStub)
    const sub = new SSESubscription('http://server/stream', vi.fn(), vi.fn())

    sub.connect()
    await flushMicrotasks()
    expect(fetchStub).toHaveBeenCalledTimes(1) // first loop ended, timer pending

    sub.connect() // supersedes: must cancel the pending timer
    await flushMicrotasks()
    expect(fetchStub).toHaveBeenCalledTimes(2) // second loop only

    // Advance past the first loop's reconnect delay: only the second loop's own
    // reconnect (also 1000ms, attempts were reset) may fire, one fetch, not two.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchStub).toHaveBeenCalledTimes(3)

    sub.disconnect()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(3)
  })

  it('404 fails fast to onError without entering the reconnect loop', async () => {
    const fetchStub = vi.fn(async () => errorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as HttpStatusError
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(404)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a 2xx JSON failure envelope with status 404 fails fast like a real 404', async () => {
    const body = { success: false, result: null, responseDetail: { title: 'Not Found', status: 404, detail: 'gone' } }
    const fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => body,
    }) as unknown as Response)
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as HttpStatusError
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(404)
    expect(isSubscriptionGoneError(err)).toBe(true)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a JSON reply that is not an event stream fails fast instead of reconnecting forever', async () => {
    const fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ success: true, result: [] }),
    }) as unknown as Response)
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('reopens the stream at once with a renewed token after a 401', async () => {
    const fetchStub = vi.fn(async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization === 'Bearer renewed'
        ? endedStreamResponse()
        : errorResponse(401, 'Unauthorized'))
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const auth = new BearerTokenProvider(async () => ({ accessToken: 'renewed' }), { accessToken: 'expired' })
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError, auth)

    sub.connect()
    await flushMicrotasks(30)

    expect(fetchStub.mock.calls.map(call => (call[1].headers as Record<string, string>).Authorization))
      .toEqual(['Bearer expired', 'Bearer renewed'])
    expect(onError).not.toHaveBeenCalled()
    sub.disconnect()
  })

  it('fails fast when the sign-in cannot be renewed, instead of reconnecting', async () => {
    const fetchStub = vi.fn(async () => endedStreamResponse())
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const auth = new BearerTokenProvider(async () => { throw new Error('The sign-in has expired. Reconnect to sign in again.') })
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError, auth)

    sub.connect()
    await flushMicrotasks(30)

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toBe('The sign-in has expired. Reconnect to sign in again.')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'a credential nothing can renew'],
    [403, 'an account the server does not allow'],
  ])('%i (%s) fails fast to onError without reconnecting', async status => {
    const fetchStub = vi.fn(async () => errorResponse(status, 'Refused'))
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError, new StaticAuthProvider({ type: 'bearer', token: 't' }))

    sub.connect()
    await flushMicrotasks(30)

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as HttpStatusError).status).toBe(status)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})

// ACS: i3X 1.0 streams flat arrays of updates (Implementation Guide, Streaming); batches are still read.
describe('parseStreamEvent', () => {
  const update = { elementId: 'x-pos', value: 12.5, quality: 'Good', timestamp: '2026-11-20T10:00:00.010Z' }

  it('reads the flat form the i3X 1.0 spec defines for the stream', () => {
    expect(parseStreamEvent(JSON.stringify([update]))).toEqual([update])
  })

  it('reads several flat updates in order', () => {
    const later = { ...update, value: 12.6, timestamp: '2026-11-20T10:00:00.020Z' }
    expect(parseStreamEvent(JSON.stringify([update, later])).map(item => item.value)).toEqual([12.5, 12.6])
  })

  it('reads a single flat update that is not wrapped in an array', () => {
    expect(parseStreamEvent(JSON.stringify(update))).toEqual([update])
  })

  it('reads the batch form', () => {
    const batch = [{ sequenceNumber: 7, updates: [update, { ...update, elementId: 'y-pos', value: 3 }] }]
    expect(parseStreamEvent(JSON.stringify(batch)).map(item => item.elementId)).toEqual(['x-pos', 'y-pos'])
  })

  it('keeps the order of a payload that mixes both forms', () => {
    const payload = [
      { ...update, elementId: 'a' },
      { sequenceNumber: 1, updates: [{ ...update, elementId: 'b' }] },
      { ...update, elementId: 'c' },
    ]
    expect(parseStreamEvent(JSON.stringify(payload)).map(item => item.elementId)).toEqual(['a', 'b', 'c'])
  })

  it('fills in missing quality and timestamp with null', () => {
    expect(parseStreamEvent(JSON.stringify([{ elementId: 'x-pos', value: 1 }]))).toEqual([
      { elementId: 'x-pos', value: 1, quality: null, timestamp: null },
    ])
  })

  it('expands the components of a flat composition update', () => {
    const composed = { ...update, elementId: 'table', value: {}, components: { 'x-pos': { value: 4 } } }
    expect(parseStreamEvent(JSON.stringify([composed])).map(item => [item.elementId, item.value])).toEqual([
      ['table', {}],
      ['x-pos', 4],
    ])
  })

  it.each([
    ['null', 'null'],
    ['a number', '42'],
    ['a string', '"hello"'],
    ['an empty array', '[]'],
    ['entries of neither shape', JSON.stringify([null, 3, 'x', { value: 1 }, { elementId: 5 }, { updates: 'no' }])],
  ])('yields nothing for %s', (_label, payload) => {
    expect(parseStreamEvent(payload)).toEqual([])
  })

  it('skips junk entries beside good ones', () => {
    expect(parseStreamEvent(JSON.stringify([null, { value: 1 }, update])).map(item => item.elementId)).toEqual(['x-pos'])
  })

  it('throws on a payload that is not JSON', () => {
    expect(() => parseStreamEvent('{not json')).toThrow()
  })
})

describe('SSESubscription delivery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('delivers flat and batched events and drops a malformed one without stopping', async () => {
    const flat = { elementId: 'x-pos', value: 1, quality: 'Good', timestamp: '2026-11-20T10:00:00Z' }
    const batch = { sequenceNumber: 2, updates: [{ ...flat, value: 2 }] }
    vi.stubGlobal('fetch', vi.fn(async () => streamingResponse([
      `data: ${JSON.stringify([flat])}\n\n`,
      'data: {broken\n\n',
      // An event split across two reads.
      `data: ${JSON.stringify([batch]).slice(0, 10)}`,
      `${JSON.stringify([batch]).slice(10)}\n\n`,
    ])))
    const onData = vi.fn()
    const sub = new SSESubscription('http://server/stream', onData, vi.fn())

    sub.connect()
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(2))
    sub.disconnect()

    expect(onData.mock.calls.map(call => (call[0] as SyncResponseItem[]).map(item => item.value))).toEqual([[1], [2]])
  })
})

describe('PollingSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never stacks concurrent syncs when the server is slower than the interval', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const syncFn = (): Promise<SyncResponseItem[]> => {
      calls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise(resolve =>
        setTimeout(() => {
          inFlight--
          resolve([])
        }, 5000)
      )
    }
    const poller = new PollingSubscription(syncFn, vi.fn(), vi.fn(), 2000)

    poller.start()
    await vi.advanceTimersByTimeAsync(30_000)

    // Each cycle is 5000ms sync + 2000ms wait: starts at 0, 7000, 14000, 21000, 28000.
    expect(maxInFlight).toBe(1)
    expect(calls).toBe(5)
    poller.stop()
  })

  it('stop() mid-flight suppresses the late result and stops the chain', async () => {
    const onData = vi.fn()
    let calls = 0
    const syncFn = (): Promise<SyncResponseItem[]> => {
      calls++
      return new Promise(resolve =>
        setTimeout(() => resolve([{ elementId: 'x', value: 1, quality: null, timestamp: null }]), 5000)
      )
    }
    const poller = new PollingSubscription(syncFn, onData, vi.fn(), 2000)

    poller.start()
    await vi.advanceTimersByTimeAsync(1000)
    poller.stop()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(calls).toBe(1)
    expect(onData).not.toHaveBeenCalled()
    expect(poller.isRunning()).toBe(false)
  })

  it('a failing sync reports onError and the chain continues', async () => {
    const onError = vi.fn()
    const syncFn = vi.fn(async (): Promise<SyncResponseItem[]> => {
      throw new Error('sync failed')
    })
    const poller = new PollingSubscription(syncFn, vi.fn(), onError, 2000)

    poller.start()
    await vi.advanceTimersByTimeAsync(6000)

    // t = 0, 2000, 4000, 6000.
    expect(syncFn).toHaveBeenCalledTimes(4)
    expect(onError).toHaveBeenCalledTimes(4)
    poller.stop()
  })
})
