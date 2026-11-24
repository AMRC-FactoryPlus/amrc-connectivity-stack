// @vitest-environment jsdom
/*
 * ACS: tests for subscribing to an ISA-95 level, which subscribes to the
 * devices under it because a registration on the level itself delivers nothing
 * under i3X 1.0 maxDepth.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkOutcome } from '../api/normalize'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { createClient, destroyClient } from '../api/client'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { useExplorerStore } from '../stores/explorer'
import { resetSubscribeState, subscribeElement, useSubscribeStatus } from './useSubscribe'
import { isLevel, LEVEL_CONFIRM_DEVICES, targetsUnder } from './levelSubscribe'

function obj(elementId: string, parentId: string | null, isComposition: boolean, typeId = 't'): ObjectInstance {
  return { elementId, displayName: elementId, typeId, parentId, isComposition, namespaceUri: 'urn:x' }
}

/** Builds the store slices from a flat list, the way the catalog does. */
function source(objects: ObjectInstance[], related = new Map<string, ObjectInstance[]>()) {
  const objectIndex = new Map(objects.map(o => [o.elementId, o]))
  const childrenByParent = new Map<string, ObjectInstance[]>()
  for (const o of objects) {
    if (!o.parentId) continue
    const list = childrenByParent.get(o.parentId) ?? []
    list.push(o)
    childrenByParent.set(o.parentId, list)
  }
  return { objectIndex, childrenByParent, relatedObjects: related }
}

// Site > Area > (Cell > Press 1, Press 2), with a branch and a metric inside Press 1.
const tree = [
  obj('site', null, false),
  obj('area', 'site', false),
  obj('cell', 'area', false),
  obj('press-1', 'cell', true),
  obj('press-1/hydraulics', 'press-1', true),
  obj('press-1/hydraulics/pressure', 'press-1/hydraulics', false),
  obj('press-2', 'cell', true),
  obj('empty-area', 'site', false, 'isa95-level'),
]

describe('isLevel', () => {
  it('is true for a non-composition with children, false for a device or a metric', () => {
    const s = source(tree)
    expect(isLevel(s.objectIndex.get('area')!, s)).toBe(true)
    expect(isLevel(s.objectIndex.get('press-1')!, s)).toBe(false)
    expect(isLevel(s.objectIndex.get('press-1/hydraulics/pressure')!, s)).toBe(false)
  })

  it('is true for an empty ISA-95 level, known by its type', () => {
    const s = source(tree)
    expect(isLevel({ elementId: 'empty-area', isComposition: false }, s)).toBe(true)
  })
})

describe('targetsUnder', () => {
  it('finds the first composition on each branch, at any depth, and does not go inside it', () => {
    expect(targetsUnder('site', source(tree)).map(d => d.elementId)).toEqual(['press-1', 'press-2'])
  })

  it('follows HasChildren edges the catalog does not place under the level', () => {
    const extra = { ...obj('press-9', null, true), sourceRelationship: 'HasChildren' }
    const s = source(tree, new Map([['empty-area', [extra]]]))
    expect(targetsUnder('empty-area', s).map(d => d.elementId)).toEqual(['press-9'])
  })

  it('takes a metric that sits outside any device on its own', () => {
    const s = source([...tree, obj('area/energy', 'area', false)])
    expect(targetsUnder('site', s).map(d => d.elementId)).toEqual(['press-1', 'press-2', 'area/energy'])
  })

  it('finds nothing under a level with no devices', () => {
    expect(targetsUnder('empty-area', source(tree))).toEqual([])
  })
})

const accept = async (_id: string, elementIds: string[]): Promise<BulkOutcome> => ({ accepted: elementIds, rejected: [] })

function fakeServer() {
  const client = createClient('http://server')
  let next = 0
  const createSubscription = vi.spyOn(client, 'createSubscription').mockImplementation(async () =>
    ({ subscriptionId: `sub-${++next}`, message: 'Subscription created' }))
  vi.spyOn(client, 'deleteSubscription').mockResolvedValue()
  const register = vi.spyOn(client, 'registerMonitoredItems').mockImplementation(accept)
  vi.spyOn(client, 'unregisterMonitoredItems').mockImplementation(accept)
  vi.spyOn(client, 'getValue').mockImplementation(async (elementId: string) => ({
    elementId, parentId: null, namespaceUri: 'urn:x', value: {},
    components: { [elementId]: { value: null }, [`${elementId}/m`]: { value: 1 } },
  } as LastKnownValue))
  const startStream = vi.fn(async (id: string) => useSubscriptionsStore.getState().setStreaming(id, true))
  return { createSubscription, register, startStream }
}

function loadTree(objects: ObjectInstance[]) {
  const s = source(objects)
  useExplorerStore.setState({ objectIndex: s.objectIndex, childrenByParent: s.childrenByParent, relatedObjects: s.relatedObjects })
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

describe('subscribeElement on an ISA-95 level', () => {
  it('subscribes to each device under it on one subscription, and not to the level', async () => {
    loadTree(tree)
    const server = fakeServer()

    await expect(subscribeElement({ elementId: 'site', displayName: 'Site', isComposition: false }, null, server.startStream))
      .resolves.toBe(true)

    expect(server.createSubscription).toHaveBeenCalledTimes(1)
    expect(server.register).toHaveBeenCalledWith('sub-1', ['press-1'], 0)
    expect(server.register).toHaveBeenCalledWith('sub-1', ['press-2'], 0)
    expect(server.register).not.toHaveBeenCalledWith('sub-1', ['site'], expect.anything())
    expect(server.startStream).toHaveBeenCalledTimes(1)
    expect(useSubscriptionsStore.getState().subscriptions.get('sub-1')?.monitoredItems).toEqual(['press-1', 'press-2'])
  })

  it('fails with a reason, instead of waiting forever, when the level has no devices', async () => {
    loadTree(tree)
    const server = fakeServer()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(subscribeElement({ elementId: 'empty-area', displayName: 'Empty area', isComposition: false }, null, server.startStream))
      .resolves.toBe(false)

    expect(server.createSubscription).not.toHaveBeenCalled()
    expect(useSubscribeStatus.getState().errors.get('empty-area')).toMatch(/no devices/)
  })

  it('asks first above the limit, and subscribes to nothing when declined', async () => {
    const many = [obj('big', null, false)]
    for (let i = 0; i <= LEVEL_CONFIRM_DEVICES; i++) many.push(obj(`dev-${i}`, 'big', true))
    loadTree(many)
    const server = fakeServer()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await expect(subscribeElement({ elementId: 'big', displayName: 'Big', isComposition: false }, null, server.startStream))
      .resolves.toBe(true)

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`${LEVEL_CONFIRM_DEVICES + 1} devices`))
    expect(server.register).not.toHaveBeenCalled()
    expect(useSubscriptionsStore.getState().subscriptions.size).toBe(0)
  })

  it('does not ask at the limit', async () => {
    const some = [obj('mid', null, false)]
    for (let i = 0; i < LEVEL_CONFIRM_DEVICES; i++) some.push(obj(`dev-${i}`, 'mid', true))
    loadTree(some)
    const server = fakeServer()
    const confirm = vi.spyOn(window, 'confirm')

    await subscribeElement({ elementId: 'mid', displayName: 'Mid', isComposition: false }, null, server.startStream)

    expect(confirm).not.toHaveBeenCalled()
    expect(useSubscriptionsStore.getState().subscriptions.get('sub-1')?.monitoredItems).toHaveLength(LEVEL_CONFIRM_DEVICES)
  })

  it('keeps going past a device that fails and reports it', async () => {
    loadTree(tree)
    const server = fakeServer()
    server.register.mockImplementation(async (_id, elementIds) => elementIds[0] === 'press-1'
      ? { accepted: [], rejected: [{ elementId: 'press-1', message: 'Not found' }] } as unknown as BulkOutcome
      : { accepted: elementIds, rejected: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(subscribeElement({ elementId: 'site', displayName: 'Site', isComposition: false }, null, server.startStream))
      .resolves.toBe(false)

    const subs = [...useSubscriptionsStore.getState().subscriptions.values()]
    expect(subs.flatMap(s => s.monitoredItems)).toEqual(['press-2'])
    expect(useSubscribeStatus.getState().errors.get('site')).toMatch(/1 of 2 devices.*Not found/)
  })

  it('still subscribes a metric directly', async () => {
    loadTree(tree)
    const server = fakeServer()

    await subscribeElement({ elementId: 'press-1/hydraulics/pressure', displayName: 'Pressure', isComposition: false }, null, server.startStream)

    expect(server.register).toHaveBeenCalledWith('sub-1', ['press-1/hydraulics/pressure'], 1)
  })
})
