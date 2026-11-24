// @vitest-environment jsdom
/*
 * ACS: tests for subscribing from a row: the Current value table's and the
 * relationship list's Subscribe buttons, and the tree menu's Subscribe entry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BulkOutcome } from '../api/normalize'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { createClient, destroyClient } from '../api/client'
import { clearServerQueries, queryClient } from '../data/queryClient'
import { useExplorerStore } from '../stores/explorer'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { ChildValues } from '../components/main/ChildValues'
import { RelationshipList } from '../components/graph/RelationshipList'
import { buildEgoTree } from '../components/graph/egoTree'
import { buildTreeMenu } from '../components/tree/treeMenu'
import type { MenuActionEntry } from '../components/common/ContextMenu'
import type { NodeRow } from '../components/tree/treeData'
import { resetSubscribeState } from './useSubscribe'

const startStream = vi.hoisted(() => vi.fn(async (_id: string) => {}))
vi.mock('../components/subscriptions/SubscriptionTransport', () => ({
  useSubscriptionTransport: () => ({ startStream }),
  useOptionalSubscriptionTransport: () => ({ startStream }),
}))

const object = (elementId: string, displayName: string, parentId: string | null, extra: Partial<ObjectInstance> = {}): ObjectInstance => ({
  elementId,
  displayName,
  typeId: 'type',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
  ...extra,
})

// Line 1 holds Press 3 (a device, holding Spindle speed) and Robot 2 (a metric).
const line = object('line-1', 'Line 1', null)
const press = object('press-3', 'Press 3', 'line-1', { isComposition: true })
const robot = object('robot-2', 'Robot 2', 'line-1')
const spindle = object('spindle', 'Spindle speed', 'press-3')

const vqt = (elementId: string, value: unknown): LastKnownValue =>
  ({ elementId, value, quality: 'Good', timestamp: '2026-01-01T00:00:00Z', parentId: null, namespaceUri: '' } as unknown as LastKnownValue)

function fakeServer() {
  const client = createClient('http://server')
  const values: Record<string, unknown> = { 'press-3': null, 'robot-2': 'Idle', spindle: 1200 }
  vi.spyOn(client, 'getValue').mockImplementation(async id => vqt(id, values[id]))
  vi.spyOn(client, 'getValues').mockImplementation(async ids => ids.map(id => vqt(id, values[id])))
  vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({ related: new Map(), failures: [] })
  const create = vi.spyOn(client, 'createSubscription').mockResolvedValue({ subscriptionId: 'sub-1', message: '' })
  const register = vi.spyOn(client, 'registerMonitoredItems').mockImplementation(
    async (_id: string, elementIds: string[]): Promise<BulkOutcome> => ({ accepted: elementIds, rejected: [] }))
  return { create, register }
}

beforeEach(() => {
  useExplorerStore.getState().reset()
  useExplorerStore.getState().setAllObjects([line, press, robot, spindle])
  useSubscriptionsStore.getState().clearAll()
  useSubscriptionsStore.getState().setSubscriptionsOpen(false)
  resetSubscribeState()
  startStream.mockClear()
})

afterEach(() => {
  cleanup()
  clearServerQueries()
  destroyClient()
  vi.restoreAllMocks()
})

function subscribed(elementId: string) {
  useSubscriptionsStore.getState().addSubscription({ id: 'sub-0', createdAt: '', monitoredItems: [elementId], isStreaming: true })
}

describe('Current value table', () => {
  const showTable = () => render(
    <QueryClientProvider client={queryClient}>
      <ChildValues parentId="line-1" />
    </QueryClientProvider>
  )
  const rowOf = (name: string) => screen.getByRole('button', { name }).closest('[role="row"]') as HTMLElement

  it('gives each row a Subscribe button that shows on hover, in its own narrow column', async () => {
    fakeServer()
    showTable()
    await screen.findByRole('button', { name: 'Robot 2' })

    const header = screen.getAllByRole('row')[0]
    expect(within(header).getAllByRole('columnheader')).toHaveLength(6)
    expect(header.className).toContain('_1.25rem]')

    for (const name of ['Press 3', 'Robot 2']) {
      const row = rowOf(name)
      expect(row.className).toContain('group')
      const button = within(row).getByRole('button', { name: `Subscribe to ${name}` })
      expect(button.className).toContain('opacity-0')
      expect(button.className).toContain('group-hover:opacity-100')
      expect(button.className).toContain('focus:opacity-100')
    }
  })

  it('always shows the button, in the success style, for a subscribed row, and opens the drawer', async () => {
    fakeServer()
    subscribed('robot-2')
    showTable()
    await screen.findByRole('button', { name: 'Robot 2' })

    const button = within(rowOf('Robot 2')).getByRole('button', { name: /Robot 2 is subscribed/ })
    expect(button.className).not.toContain('opacity-0')
    expect(button.className).toContain('text-i3x-success')

    fireEvent.click(button)
    expect(useSubscriptionsStore.getState().isSubscriptionsOpen).toBe(true)
    expect(useExplorerStore.getState().selectedItem).toBeNull()
  })

  it('subscribes to a row without opening it, a container included', async () => {
    const server = fakeServer()
    showTable()
    await screen.findByRole('button', { name: 'Press 3' })

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Press 3' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Press 3 is subscribed/ })).toBeTruthy())
    expect(server.create).toHaveBeenCalledTimes(1)
    expect(server.register).toHaveBeenCalledWith('sub-1', ['press-3'], 0)
    expect(startStream).toHaveBeenCalledWith('sub-1')
    expect(useSubscriptionsStore.getState().isSubscriptionsOpen).toBe(true)
    // The row's name was not clicked, so nothing was opened.
    expect(useExplorerStore.getState().selectedItem).toBeNull()
  })

  it('shows a failure on the button rather than across the page', async () => {
    const server = fakeServer()
    server.register.mockResolvedValueOnce({ accepted: [], rejected: [{ elementId: 'robot-2', message: 'Denied' }] } as unknown as BulkOutcome)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showTable()
    await screen.findByRole('button', { name: 'Robot 2' })

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Robot 2' }))

    const failed = await screen.findByRole('button', { name: /Subscribe to Robot 2 failed: .*Denied/ })
    expect(failed.getAttribute('title')).toMatch(/Denied/)
    expect(failed.className).not.toContain('opacity-0')
  })
})

describe('Relationship list', () => {
  function showList(onSelect = vi.fn()) {
    const tree = buildEgoTree({
      nodes: [
        { object: line, depth: 0 },
        { object: press, depth: 1, via: 'line-1', viaBucket: 'child' },
      ],
      edges: [{ source: 'line-1', target: 'press-3', relationshipType: 'HasChildren', bucket: 'child' }],
    })
    render(<RelationshipList tree={tree} isLoading={false} error={null} onSelect={onSelect} onFocus={vi.fn()} onRoot={vi.fn()} />)
    return onSelect
  }

  it('has a Subscribe button on hover that subscribes without selecting the row', async () => {
    const server = fakeServer()
    const onSelect = showList()

    const button = screen.getByRole('button', { name: 'Subscribe to Press 3' })
    expect(button.className).toContain('group-hover:opacity-100')
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByRole('button', { name: /Press 3 is subscribed/ })).toBeTruthy())
    expect(server.register).toHaveBeenCalledWith('sub-1', ['press-3'], 0)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Tree menu', () => {
  const row: NodeRow = {
    kind: 'node',
    key: 'hier:press-3',
    id: 'hier:press-3',
    nodeType: 'object',
    label: 'Press 3',
    data: press,
    depth: 1,
    hasChildren: true,
    isExpanded: false,
  } as unknown as NodeRow
  const actions = (entries: ReturnType<typeof buildTreeMenu>) =>
    (entries ?? []).filter((e): e is MenuActionEntry => e.kind === 'action')

  it('offers Subscribe for an object row', () => {
    const subscribe = vi.fn()
    const entry = actions(buildTreeMenu(row, vi.fn(), vi.fn(), subscribe)).find(e => e.label === 'Subscribe')
    expect(entry).toBeTruthy()
    entry!.onSelect()
    expect(subscribe).toHaveBeenCalledWith(press)
  })

  it('offers Show in subscriptions once the object is subscribed', () => {
    subscribed('press-3')
    const labels = actions(buildTreeMenu(row, vi.fn(), vi.fn(), vi.fn())).map(e => e.label)
    expect(labels).toContain('Show in subscriptions')
    expect(labels).not.toContain('Subscribe')
    actions(buildTreeMenu(row, vi.fn(), vi.fn(), vi.fn())).find(e => e.label === 'Show in subscriptions')!.onSelect()
    expect(useSubscriptionsStore.getState().isSubscriptionsOpen).toBe(true)
  })
})
