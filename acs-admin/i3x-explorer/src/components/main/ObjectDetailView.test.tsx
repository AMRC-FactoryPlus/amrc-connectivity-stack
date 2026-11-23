// @vitest-environment jsdom
/*
 * ACS: tests for the tidied object detail view: panel order, the tabs, the
 * description under the title, a container's children as its current value,
 * and the Manager UI's own actions beside Subscribe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LastKnownValue, ObjectInstance } from '../../api/types'

// The Manager UI's host, found through window.parent as when framed. Set before
// acs/host.ts loads, since it looks once.
const host = vi.hoisted(() => {
  const fake = {
    serviceUrl: vi.fn(),
    token: vi.fn(),
    theme: () => 'light',
    openNewWindow: vi.fn(),
    actions: vi.fn(async (): Promise<{ id: string; label: string }[]> => []),
    runAction: vi.fn(),
  }
  Object.defineProperty(window, 'parent', { value: { __acsI3xExplorerHost: fake }, configurable: true })
  return fake
})

vi.mock('../subscriptions/SubscriptionTransport', () => ({
  useSubscriptionTransport: () => ({ startStream: vi.fn() }),
  useOptionalSubscriptionTransport: () => ({ startStream: vi.fn() }),
}))

// The relationship map draws on a canvas jsdom does not have; its place is what is tested here.
vi.mock('./tabs/RelationshipsTab', () => ({
  RelationshipsTab: () => <section><h3>Relationships</h3></section>,
}))

import { createClient, destroyClient } from '../../api/client'
import { clearServerQueries, queryClient } from '../../data/queryClient'
import { useExplorerStore } from '../../stores/explorer'
import { ObjectDetailView } from './ObjectDetailView'

const object = (elementId: string, displayName: string, parentId: string | null, extra: Partial<ObjectInstance> = {}): ObjectInstance => ({
  elementId,
  displayName,
  typeId: 'type',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
  metadata: {},
  ...extra,
})

const vqt = (elementId: string, value: unknown): LastKnownValue =>
  ({ elementId, value, quality: 'Good', timestamp: '2026-01-01T00:00:00Z', parentId: null, namespaceUri: '' } as unknown as LastKnownValue)

// Line 1 (an organisational level) holds Press 3 (a composition) and Robot 2;
// Press 3 is made of Spindle speed.
const line = object('line-1', 'Line 1', null, { typeId: 'isa95-level' })
const press = object('press-3', 'Press 3', 'line-1', { isComposition: true, description: 'Hydraulic press on the main line' })
const robot = object('robot-2', 'Robot 2', 'line-1')
const spindle = object('spindle', 'Spindle speed', 'press-3')

function show(target: ObjectInstance) {
  useExplorerStore.getState().selectItem({ type: 'object', id: `hier:${target.elementId}`, data: target })
  return render(
    <QueryClientProvider client={queryClient}>
      <ObjectDetailView object={target} />
    </QueryClientProvider>
  )
}

function fakeServer() {
  const client = createClient('http://server')
  const values: Record<string, unknown> = { 'line-1': null, 'press-3': null, 'robot-2': 'Idle', spindle: 1200 }
  const getValue = vi.spyOn(client, 'getValue').mockImplementation(async id => vqt(id, values[id]))
  const getValues = vi.spyOn(client, 'getValues').mockImplementation(async ids => ids.map(id => vqt(id, values[id])))
  vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({ related: new Map(), failures: [] })
  return { getValue, getValues }
}

beforeEach(() => {
  useExplorerStore.getState().reset()
  useExplorerStore.getState().setAllObjects([line, press, robot, spindle])
  host.actions.mockReset()
  host.actions.mockResolvedValue([])
  host.runAction.mockReset()
})

afterEach(() => {
  cleanup()
  clearServerQueries()
  destroyClient()
  vi.restoreAllMocks()
})

const detailHeader = () => screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement

const panelTitles = () => screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)

describe('ObjectDetailView', () => {
  it('orders the panels Current Value, Relationships, Identity, with no Description or Object Data', async () => {
    fakeServer()
    show(spindle)
    expect(panelTitles()).toEqual(['Current Value', 'Relationships', 'Identity'])
    expect(screen.queryByText('Object Data')).toBeNull()
    expect(screen.queryByText('Description')).toBeNull()
  })

  it('gives a metric Overview and History, and no Relationships or Subtree tab', () => {
    fakeServer()
    show(spindle)
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Overview', 'History'])
  })

  it('gives a container no tab bar, and lands a History link on Overview', () => {
    fakeServer()
    useExplorerStore.getState().selectItem({ type: 'object', id: 'hier:press-3', data: press }, 'history')
    show(press)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(panelTitles()[0]).toBe('Current Value')
  })

  it('shows the description under the title', () => {
    fakeServer()
    show(press)
    expect(within(detailHeader()).getByTestId('object-description').textContent).toBe('Hydraulic press on the main line')
  })

  it('lists a level’s children with values read in one separate maxDepth 1 request', async () => {
    const { getValue, getValues } = fakeServer()
    show(line)

    await screen.findByText('Idle')
    expect(screen.getByRole('button', { name: 'Press 3' })).toBeTruthy()
    // HasChildren is never followed by maxDepth, so the children are read on their own.
    expect(getValues).toHaveBeenCalledWith(['press-3', 'robot-2'], 1)
    // The level itself is read alone, not at a depth that would claim its children.
    expect(getValue).toHaveBeenCalledWith('line-1', 1)
  })

  it('expands a child container one level at a time', async () => {
    const { getValues } = fakeServer()
    show(line)
    await screen.findByText('Idle')
    expect(screen.queryByText('Spindle speed')).toBeNull()
    // A metric has nothing to expand.
    expect(screen.queryByRole('button', { name: 'Expand Robot 2' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Press 3' }))
    await screen.findByText('1200')
    expect(screen.getByRole('button', { name: 'Spindle speed' })).toBeTruthy()
    expect(getValues).toHaveBeenLastCalledWith(['spindle'], 1)
  })

  it('opens a child when its name is clicked', async () => {
    fakeServer()
    show(line)
    fireEvent.click(await screen.findByRole('button', { name: 'Robot 2' }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:robot-2')
  })

  it('shows the host’s actions left of Subscribe and asks the host to run one', async () => {
    fakeServer()
    host.actions.mockResolvedValue([
      { id: 'access', label: 'Manage access' },
      { id: 'dataset', label: 'Build dataset' },
    ])
    show(press)

    const access = await screen.findByRole('button', { name: 'Manage access' })
    const buttons = within(detailHeader()).getAllByRole('button').map(b => b.textContent)
    expect(buttons.indexOf('Manage access')).toBeLessThan(buttons.indexOf('Build dataset'))
    expect(buttons.indexOf('Build dataset')).toBeLessThan(buttons.findIndex(t => t?.includes('Subscribe')))
    expect(host.actions).toHaveBeenCalledWith({
      object: { elementId: 'press-3', displayName: 'Press 3', typeId: 'type', parentId: 'line-1' },
      ancestors: [{ elementId: 'line-1', displayName: 'Line 1', typeId: 'isa95-level', parentId: null }],
    })

    fireEvent.click(access)
    expect(host.runAction).toHaveBeenCalledWith('access', expect.objectContaining({
      object: expect.objectContaining({ elementId: 'press-3' }),
    }))
  })

  it('shows no host actions when the host offers none', async () => {
    fakeServer()
    show(spindle)
    await waitFor(() => expect(host.actions).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Manage access' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Build dataset' })).toBeNull()
  })
})
