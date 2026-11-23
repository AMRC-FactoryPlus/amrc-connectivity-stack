// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SubscriptionsView } from './SubscriptionsView'
import { SubscriptionTransportProvider } from './SubscriptionTransport'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import type { ObjectInstance } from '../../api/types'
import { installJsdomLayout, TEST_ROW_HEIGHT } from '../../testing/jsdomLayout'

beforeAll(installJsdomLayout)
afterEach(cleanup)
beforeEach(() => {
  // The transport provider clears every subscription while disconnected.
  useConnectionStore.setState({ isConnected: true })
  useSubscriptionsStore.getState().clearAll()
  useExplorerStore.setState({ objectIndex: new Map(), allObjectsLoaded: false }) // ACS
})

function renderComposition(componentCount: number) {
  const components = Array.from({ length: componentCount }, (_, i) => `line:c${i}`)
  // ACS: a loaded catalog without these elements, so rows show their ids rather than "Loading name…".
  useExplorerStore.setState({ allObjectsLoaded: true })
  useSubscriptionsStore.getState().addSubscription({
    id: 's',
    createdAt: '',
    monitoredItems: ['line'],
    isStreaming: false,
    monitoredDepth: { line: 0 },
    components: { line: components },
  })
  const view = render(
    <SubscriptionTransportProvider>
      <SubscriptionsView />
    </SubscriptionTransportProvider>
  )
  const scroller = view.container.querySelector('[data-windowed-list]') as HTMLElement
  return { scroller }
}

describe('SubscriptionsView', () => {
  it('mounts only a window of rows for a composition with 10,000 components', () => {
    const { scroller } = renderComposition(10_000)

    const mounted = scroller.querySelectorAll('tbody[data-index]').length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(100)
    expect(screen.getByText('line')).toBeDefined()
    expect(screen.getByText('10000 components')).toBeDefined()
  })

  it('reserves the whole list height so the last component can be scrolled to', () => {
    const { scroller } = renderComposition(10_000)

    const table = scroller.querySelector('table') as HTMLElement
    expect(parseFloat(table.style.minHeight)).toBeGreaterThanOrEqual(10_001 * TEST_ROW_HEIGHT)
  })
})

// ACS: rows are named by their path, not their id.
describe('SubscriptionsView element names', () => {
  const object = (elementId: string, displayName: string, parentId: string) =>
    ({ elementId, displayName, parentId, typeId: 't', namespaceUri: 'urn:test', isComposition: false }) as ObjectInstance

  function renderItem(names?: Record<string, string>) {
    useSubscriptionsStore.getState().addSubscription({
      id: 's',
      createdAt: '',
      monitoredItems: ['x-pos'],
      isStreaming: false,
      names,
    })
    return render(
      <SubscriptionTransportProvider>
        <SubscriptionsView />
      </SubscriptionTransportProvider>
    )
  }

  it('shows the full path, with the id only in the tooltip', () => {
    const objects = [object('station', 'Line 1', '/'), object('x-pos', 'Spindle speed', 'station')]
    useExplorerStore.setState({ objectIndex: new Map(objects.map(item => [item.elementId, item])), allObjectsLoaded: true })
    renderItem()

    const button = screen.getByRole('button', { name: 'Open Line 1 / Spindle speed' })
    expect(button.textContent).toBe('Line 1 / Spindle speed')
    expect(button.getAttribute('title')).toContain('x-pos')
    expect(screen.queryByText('x-pos')).toBeNull()
  })

  it('shows the name recorded at subscribe time until the catalog holds the element, then its path', () => {
    renderItem({ 'x-pos': 'Line 1 / Spindle speed' })
    expect(screen.getByText('Line 1 / Spindle speed')).toBeDefined()
    expect(screen.queryByText('x-pos')).toBeNull()

    const objects = [object('site', 'Site', '/'), object('station', 'Line 1', 'site'), object('x-pos', 'Spindle speed', 'station')]
    act(() => {
      useExplorerStore.setState({ objectIndex: new Map(objects.map(item => [item.elementId, item])), allObjectsLoaded: true })
    })
    expect(screen.getByRole('button', { name: 'Open Site / Line 1 / Spindle speed' })).toBeDefined()
  })

  it('says the name is loading, not the id, while the catalog loads', () => {
    renderItem()
    expect(screen.getByText('Loading name…')).toBeDefined()
    expect(screen.queryByText('x-pos')).toBeNull()
  })
})
