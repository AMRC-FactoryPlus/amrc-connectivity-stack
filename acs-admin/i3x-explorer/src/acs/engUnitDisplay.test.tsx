// @vitest-environment jsdom
/*
 * ACS: tests for showing engineering units after values: the Current value
 * table, a leaf's current value and its components, and the subscriptions table.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { createClient, destroyClient } from '../api/client'
import { clearServerQueries, queryClient } from '../data/queryClient'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore } from '../stores/explorer'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { ChildValues } from '../components/main/ChildValues'
import { ValueDisplay } from '../components/details/ValueDisplay'
import { SubscriptionsView } from '../components/subscriptions/SubscriptionsView'
import { SubscriptionTransportProvider } from '../components/subscriptions/SubscriptionTransport'
import { installJsdomLayout } from '../testing/jsdomLayout'

const object = (elementId: string, displayName: string, parentId: string | null, extra: Partial<ObjectInstance> = {}): ObjectInstance => ({
  elementId,
  displayName,
  typeId: 'type',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
  ...extra,
})

// Press 3 holds a temperature in °C, a mode with no unit, and a gearbox (a container with no value).
const press = object('press-3', 'Press 3', null, { isComposition: true })
const temp = object('temp', 'Temperature', 'press-3')
const mode = object('mode', 'Mode', 'press-3')
const gearbox = object('gearbox', 'Gearbox', 'press-3', { isComposition: true })

const metadata: Record<string, Record<string, unknown>> = {
  temp: { engUnit: 'CEL', system: { Eng_Unit: '°C' } },
  mode: { sourceTypeId: 'metric-string' },
}

const vqt = (elementId: string, value: unknown): LastKnownValue =>
  ({ elementId, value, quality: 'Good', timestamp: '2026-01-01T00:00:00Z', parentId: null, namespaceUri: '' } as unknown as LastKnownValue)

function fakeServer() {
  const client = createClient('http://server')
  const values: Record<string, unknown> = { temp: 21.5, mode: 'Idle', gearbox: null }
  vi.spyOn(client, 'getValues').mockImplementation(async ids => ids.map(id => vqt(id, values[id])))
  vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({ related: new Map(), failures: [] })
  const details = vi.spyOn(client, 'getObjectDetails').mockImplementation(async ids => ({
    objects: ids.map(id => object(id, id, 'press-3', { metadata: metadata[id] })),
    failures: [],
  }))
  return { details }
}

beforeAll(installJsdomLayout)

beforeEach(() => {
  useExplorerStore.getState().reset()
  useExplorerStore.getState().setAllObjects([press, temp, mode, gearbox])
  useSubscriptionsStore.getState().clearAll()
  useConnectionStore.setState({ isConnected: true })
})

afterEach(() => {
  cleanup()
  clearServerQueries()
  destroyClient()
  vi.restoreAllMocks()
})

describe('Current value table', () => {
  const showTable = () => render(
    <QueryClientProvider client={queryClient}>
      <ChildValues parentId="press-3" />
    </QueryClientProvider>
  )
  const rowOf = (name: string) => screen.getByRole('button', { name }).closest('[role="row"]') as HTMLElement

  it('puts the unit after a value, with its code in the tooltip, from one lookup', async () => {
    const server = fakeServer()
    showTable()

    const unit = await within(await waitFor(() => rowOf('Temperature'))).findByText('°C')
    expect(unit.getAttribute('title')).toBe('°C: UNECE code CEL')
    expect(within(rowOf('Temperature')).getByText('21.5')).toBeTruthy()

    // Only rows with a value were looked up, together.
    expect(server.details).toHaveBeenCalledTimes(1)
    expect(server.details).toHaveBeenCalledWith(['temp', 'mode'])
    expect(rowOf('Mode').querySelector('[data-eng-unit]')).toBeNull()
    expect(rowOf('Gearbox').querySelector('[data-eng-unit]')).toBeNull()
  })

  it('uses an object already held with its metadata, without a lookup', async () => {
    const server = fakeServer()
    useExplorerStore.getState().setAllObjects([press, { ...temp, metadata: metadata.temp }, mode, gearbox])
    showTable()

    await within(await waitFor(() => rowOf('Temperature'))).findByText('°C')
    await waitFor(() => expect(server.details).toHaveBeenCalled())
    expect(server.details).toHaveBeenCalledWith(['mode'])
  })
})

describe('a leaf value', () => {
  it('shows the unit after a scalar, not after a structured value or in the raw view', () => {
    const unit = { symbol: 'kWh', code: 'KWH' }
    const { container, rerender } = render(<ValueDisplay value={vqt('power', 12.5)} unit={unit} />)
    expect(container.querySelector('[data-eng-unit]')?.textContent).toBe('kWh')

    rerender(<ValueDisplay value={vqt('power', { a: 1 })} unit={unit} />)
    expect(container.querySelector('[data-eng-unit]')).toBeNull()

    rerender(<ValueDisplay value={vqt('power', 12.5)} unit={unit} view="raw" />)
    expect(container.querySelector('[data-eng-unit]')).toBeNull()
  })

  it('puts each component\'s unit after its value, looked up together', async () => {
    const server = fakeServer()
    const value = {
      ...vqt('press-3', null),
      components: { temp: vqt('temp', 21.5), mode: vqt('mode', 'Idle'), gearbox: vqt('gearbox', { ratio: 3 }) },
    } as LastKnownValue
    render(<ValueDisplay value={value} />)
    const rowOf = (id: string) => screen.getByTitle(id).closest('button') as HTMLElement

    const unit = await within(rowOf('temp')).findByText('°C')
    expect(unit.getAttribute('title')).toBe('°C: UNECE code CEL')
    // A structured component asks for no unit.
    expect(server.details).toHaveBeenCalledTimes(1)
    expect(server.details).toHaveBeenCalledWith(['temp', 'mode'])
    expect(rowOf('mode').querySelector('[data-eng-unit]')).toBeNull()
    expect(rowOf('gearbox').querySelector('[data-eng-unit]')).toBeNull()
  })
})

describe('subscriptions table', () => {
  it('puts the unit after a live value', async () => {
    const server = fakeServer()
    useSubscriptionsStore.getState().addSubscription({ id: 's', createdAt: '', monitoredItems: ['temp'], isStreaming: false })
    useSubscriptionsStore.getState().updateLiveValue({
      elementId: 'temp',
      displayName: 'Temperature',
      value: 21.5,
      timestamp: '2026-01-01T00:00:00Z',
      quality: 'Good',
    })
    const { container } = render(
      <SubscriptionTransportProvider>
        <SubscriptionsView />
      </SubscriptionTransportProvider>
    )

    await waitFor(() => expect(container.querySelector('[data-eng-unit]')?.textContent).toBe('°C'))
    expect(server.details).toHaveBeenCalledWith(['temp'])
  })
})
