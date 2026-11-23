/*
 * ACS: tests for the shared subscribe action: it creates one subscription,
 * registers the element, starts the stream once, rolls a new subscription back
 * when registering fails, and quick clicks on several rows share one
 * subscription.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkOutcome } from '../api/normalize'
import type { LastKnownValue } from '../api/types'
import { createClient, destroyClient } from '../api/client'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { useExplorerStore } from '../stores/explorer'
import { isElementSubscribed, resetSubscribeState, subscribeElement, useSubscribeStatus } from './useSubscribe'

const press = { elementId: 'press-3', displayName: 'Press 3', isComposition: false }
const spindle = { elementId: 'spindle', displayName: 'Spindle speed', isComposition: false }
const line = { elementId: 'line-1', displayName: 'Line 1', isComposition: true }

const accept = async (_id: string, elementIds: string[]): Promise<BulkOutcome> => ({ accepted: elementIds, rejected: [] })

function fakeServer() {
  const client = createClient('http://server')
  let next = 0
  const createSubscription = vi.spyOn(client, 'createSubscription').mockImplementation(async () => {
    // Slow enough that a second click arrives while this is in flight.
    await new Promise(resolve => setTimeout(resolve, 5))
    return { subscriptionId: `sub-${++next}`, message: 'Subscription created' }
  })
  const deleteSubscription = vi.spyOn(client, 'deleteSubscription').mockResolvedValue()
  const register = vi.spyOn(client, 'registerMonitoredItems').mockImplementation(accept)
  vi.spyOn(client, 'unregisterMonitoredItems').mockImplementation(accept)
  const getValue = vi.spyOn(client, 'getValue')
  // The transport marks the subscription streaming once it starts.
  const startStream = vi.fn(async (id: string) => useSubscriptionsStore.getState().setStreaming(id, true))
  return { createSubscription, deleteSubscription, register, getValue, startStream }
}

beforeEach(() => {
  useSubscriptionsStore.getState().clearAll()
  useExplorerStore.getState().reset()
  resetSubscribeState()
})

afterEach(() => {
  destroyClient()
  vi.restoreAllMocks()
})

describe('subscribeElement', () => {
  it('creates a subscription, registers the element, starts the stream and opens the drawer', async () => {
    const server = fakeServer()

    await expect(subscribeElement(press, null, server.startStream)).resolves.toBe(true)

    expect(server.createSubscription).toHaveBeenCalledTimes(1)
    expect(server.register).toHaveBeenCalledWith('sub-1', ['press-3'], 1)
    expect(server.startStream).toHaveBeenCalledTimes(1)
    expect(server.startStream).toHaveBeenCalledWith('sub-1')
    const state = useSubscriptionsStore.getState()
    expect(state.subscriptions.get('sub-1')?.monitoredItems).toEqual(['press-3'])
    expect(state.subscriptions.get('sub-1')?.names?.['press-3']).toBe('Press 3')
    expect(state.isSubscriptionsOpen).toBe(true)
    expect(useSubscribeStatus.getState().pending.size).toBe(0)
  })

  it('adds to the active subscription and leaves a running stream alone', async () => {
    const server = fakeServer()
    await subscribeElement(press, null, server.startStream)
    await subscribeElement(spindle, null, server.startStream)

    expect(server.createSubscription).toHaveBeenCalledTimes(1)
    expect(server.startStream).toHaveBeenCalledTimes(1)
    expect(useSubscriptionsStore.getState().subscriptions.get('sub-1')?.monitoredItems).toEqual(['press-3', 'spindle'])
  })

  it('shares one subscription between clicks made before the first one finishes', async () => {
    const server = fakeServer()

    const results = await Promise.all([
      subscribeElement(press, null, server.startStream),
      subscribeElement(spindle, null, server.startStream),
    ])

    expect(results).toEqual([true, true])
    expect(server.createSubscription).toHaveBeenCalledTimes(1)
    expect(server.startStream).toHaveBeenCalledTimes(1)
    const subs = useSubscriptionsStore.getState().subscriptions
    expect([...subs.keys()]).toEqual(['sub-1'])
    expect(subs.get('sub-1')?.monitoredItems).toEqual(['press-3', 'spindle'])
  })

  it('reads a composition’s value itself when the row has none, at the whole-tree depth', async () => {
    const server = fakeServer()
    server.getValue.mockResolvedValue({
      elementId: 'line-1',
      parentId: null,
      namespaceUri: 'urn:x',
      value: {},
      components: { 'line-1': { value: null }, spindle: { value: 1200 } },
    } as LastKnownValue)

    await expect(subscribeElement(line, null, server.startStream)).resolves.toBe(true)

    expect(server.getValue).toHaveBeenCalledWith('line-1', 0)
    expect(server.register).toHaveBeenCalledWith('sub-1', ['line-1'], 0)
    expect(useSubscriptionsStore.getState().subscriptions.get('sub-1')?.components?.['line-1']).toEqual(['spindle'])
  })

  it('deletes a subscription it created when registering fails, and keeps the error', async () => {
    const server = fakeServer()
    server.register.mockResolvedValueOnce({ accepted: [], rejected: [{ elementId: 'press-3', message: 'Not found' }] } as unknown as BulkOutcome)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(subscribeElement(press, null, server.startStream)).resolves.toBe(false)

    expect(server.deleteSubscription).toHaveBeenCalledWith('sub-1')
    expect(useSubscriptionsStore.getState().subscriptions.size).toBe(0)
    expect(server.startStream).not.toHaveBeenCalled()
    expect(useSubscribeStatus.getState().errors.get('press-3')).toMatch(/Not found/)
    expect(useSubscribeStatus.getState().pending.size).toBe(0)

    // A later click starts afresh, with a new subscription, and clears the error.
    await expect(subscribeElement(press, null, server.startStream)).resolves.toBe(true)
    expect(useSubscribeStatus.getState().errors.has('press-3')).toBe(false)
    expect(isElementSubscribed(useSubscriptionsStore.getState(), 'press-3')).toBe(true)
  })

  it('keeps a subscription that was already there when registering fails', async () => {
    const server = fakeServer()
    await subscribeElement(press, null, server.startStream)
    server.register.mockResolvedValueOnce({ accepted: [], rejected: [{ elementId: 'spindle', message: 'Denied' }] } as unknown as BulkOutcome)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(subscribeElement(spindle, null, server.startStream)).resolves.toBe(false)

    expect(server.deleteSubscription).not.toHaveBeenCalled()
    expect(useSubscriptionsStore.getState().subscriptions.get('sub-1')?.monitoredItems).toEqual(['press-3'])
  })

  it('does not register an element twice when it is clicked twice', async () => {
    const server = fakeServer()
    await Promise.all([
      subscribeElement(press, null, server.startStream),
      subscribeElement(press, null, server.startStream),
    ])
    expect(server.register).toHaveBeenCalledTimes(1)
  })
})
