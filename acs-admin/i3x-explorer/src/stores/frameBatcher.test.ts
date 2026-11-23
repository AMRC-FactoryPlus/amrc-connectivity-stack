// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameBatcher } from './frameBatcher'
import { applyDeliveries, trendPointsOf, useSubscriptionsStore, type Delivery } from './subscriptions'

// ACS: coalescing of fast live feeds.
describe('FrameBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hands over everything pushed within a frame in one batch, in order', () => {
    const onFlush = vi.fn()
    const batcher = new FrameBatcher<number>(onFlush)

    for (let i = 0; i < 100; i++) batcher.push([i])
    expect(onFlush).not.toHaveBeenCalled()
    expect(batcher.size).toBe(100)

    vi.advanceTimersToNextFrame()
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush.mock.calls[0][0]).toEqual(Array.from({ length: 100 }, (_, i) => i))
    expect(batcher.size).toBe(0)
  })

  it('flushes on the fallback timer when no frame comes, as in a background tab', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onFlush = vi.fn()
    const batcher = new FrameBatcher<number>(onFlush, 250)

    batcher.push([1, 2])
    vi.advanceTimersByTime(249)
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledWith([1, 2])
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })

  it('flushes on the timer where there are no animation frames at all', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const onFlush = vi.fn()
    const batcher = new FrameBatcher<number>(onFlush, 100)

    batcher.push([1])
    vi.advanceTimersByTime(100)
    expect(onFlush).toHaveBeenCalledWith([1])
  })

  it('flushes once per frame, not once per timer as well', () => {
    const onFlush = vi.fn()
    const batcher = new FrameBatcher<number>(onFlush, 250)

    batcher.push([1])
    vi.advanceTimersToNextFrame()
    vi.advanceTimersByTime(1_000)
    expect(onFlush).toHaveBeenCalledTimes(1)

    batcher.push([2])
    vi.advanceTimersToNextFrame()
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush.mock.calls[1][0]).toEqual([2])
  })

  it('cancel() drops what is pending', () => {
    const onFlush = vi.fn()
    const batcher = new FrameBatcher<number>(onFlush)

    batcher.push([1, 2, 3])
    batcher.cancel()
    vi.advanceTimersByTime(1_000)
    expect(onFlush).not.toHaveBeenCalled()
    expect(batcher.size).toBe(0)
  })
})

describe('coalesced live values', () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 20, 10, 0, 0) + ms).toISOString()
  const delivery = (value: number, ms: number, elementId = 'x-pos'): Delivery => ({
    subscriptionId: 's',
    items: [{ elementId, value, quality: 'Good', timestamp: at(ms) }],
  })

  beforeEach(() => {
    vi.useFakeTimers()
    const store = useSubscriptionsStore.getState()
    store.clearAll()
    store.addSubscription({ id: 's', createdAt: '', monitoredItems: ['x-pos', 'y-pos'], isStreaming: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the store once for a second of 100 Hz updates, keeping the latest value and every trend point', () => {
    const listener = vi.fn()
    const unsubscribe = useSubscriptionsStore.subscribe(listener)
    const batcher = new FrameBatcher(applyDeliveries)

    // 100 updates 10 ms apart for each of two metrics, all inside one frame.
    for (let i = 0; i < 100; i++) {
      batcher.push([delivery(i, i * 10)])
      batcher.push([delivery(1_000 + i, i * 10, 'y-pos')])
    }
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersToNextFrame()
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    const { liveValues, trendData } = useSubscriptionsStore.getState()
    expect(liveValues.get('x-pos')).toMatchObject({ value: 99, timestamp: at(990), updateCount: 100 })
    expect(liveValues.get('y-pos')).toMatchObject({ value: 1_099, updateCount: 100 })

    // ACS: the trend keeps every update, at its source time.
    const points = trendPointsOf({ trendData }, 'x-pos') ?? []
    expect(points).toHaveLength(100)
    expect(points.map(point => point.value)).toEqual(Array.from({ length: 100 }, (_, i) => i))
    expect(points.map(point => point.timestamp)).toEqual(
      Array.from({ length: 100 }, (_, i) => Date.parse(at(i * 10)))
    )
  })

  it('appends to the trend across frames', () => {
    const batcher = new FrameBatcher(applyDeliveries)
    for (let frame = 0; frame < 5; frame++) {
      for (let i = 0; i < 20; i++) batcher.push([delivery(frame * 20 + i, (frame * 20 + i) * 10)])
      vi.advanceTimersToNextFrame()
    }

    const points = trendPointsOf(useSubscriptionsStore.getState(), 'x-pos') ?? []
    expect(points.map(point => point.value)).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })

  // ACS: a component registered through its composition and on its own may be delivered twice.
  it('records an update delivered twice in a batch once', () => {
    const batcher = new FrameBatcher(applyDeliveries)
    batcher.push([delivery(7, 100)])
    batcher.push([delivery(7, 100)])
    batcher.push([delivery(8, 110)])
    vi.advanceTimersToNextFrame()

    expect(useSubscriptionsStore.getState().liveValues.get('x-pos')).toMatchObject({ value: 8, updateCount: 2 })
    expect(trendPointsOf(useSubscriptionsStore.getState(), 'x-pos')?.map(point => point.value)).toEqual([7, 8])
  })

  it('plots a reading without a source time at its arrival time', () => {
    vi.setSystemTime(5_000)
    applyDeliveries([{ subscriptionId: 's', items: [{ elementId: 'x-pos', value: 1, quality: null, timestamp: null }] }])
    expect(trendPointsOf(useSubscriptionsStore.getState(), 'x-pos')).toEqual([{ value: 1, timestamp: 5_000 }])
  })

  it('drops buffered updates for an item stopped before the frame', () => {
    const batcher = new FrameBatcher(applyDeliveries)
    batcher.push([delivery(1, 0), delivery(2, 0, 'y-pos')])
    useSubscriptionsStore.getState().removeMonitoredItem('s', 'x-pos')
    vi.advanceTimersToNextFrame()

    const { liveValues } = useSubscriptionsStore.getState()
    expect(liveValues.has('x-pos')).toBe(false)
    expect(liveValues.get('y-pos')?.value).toBe(2)
  })
})
