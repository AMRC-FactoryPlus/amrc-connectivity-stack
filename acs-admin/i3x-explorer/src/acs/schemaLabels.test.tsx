// @vitest-environment jsdom
/*
 * ACS Admin
 * Tests that the Explorer labels i3X namespaces as Schemas
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useExplorerStore } from '../stores/explorer'
import { useConnectionStore } from '../stores/connection'
import { computeModelStats } from '../components/main/modelStats'
import type { Namespace, ObjectInstance, ObjectType } from '../api/types'

const objects: ObjectInstance[] = [
  { elementId: 'line-1', displayName: 'Line 1', typeId: 'Line', parentId: null, isComposition: false, namespaceUri: 'urn:a' },
  { elementId: 'press-3', displayName: 'Press 3', typeId: 'Press', parentId: 'line-1', isComposition: false, namespaceUri: 'urn:b' },
]
const objectTypes: ObjectType[] = [
  { elementId: 'Line', displayName: 'Line', namespaceUri: 'urn:a', schema: {} },
  { elementId: 'Press', displayName: 'Press', namespaceUri: 'urn:b', schema: {} },
]

vi.mock('../data/useInsightsReport', () => ({
  useInsightsReport: () => ({ stats: computeModelStats(objects, objectTypes, 2), report: {} }),
}))
vi.mock('../components/main/ModelInsightsCard', () => ({ ModelInsightsCard: () => null }))
vi.mock('../components/main/ObjectDetailView', () => ({ ObjectDetailView: () => null }))
vi.mock('../components/details/NamespaceDetail', () => ({ NamespaceDetail: () => null }))

const { StatusBar } = await import('../components/layout/StatusBar')
const { MainPanel } = await import('../components/layout/MainPanel')
const { ModelOverview } = await import('../components/main/ModelOverview')

beforeEach(() => {
  useExplorerStore.getState().reset()
})

afterEach(() => {
  cleanup()
  useConnectionStore.setState({ isConnected: false })
})

describe('Schemas labels', () => {
  it('counts schemas, not namespaces, in the status bar', () => {
    useConnectionStore.setState({ isConnected: true })
    useExplorerStore.setState({ namespaces: [{ uri: 'urn:a', displayName: 'A' }] })
    const { container, rerender } = render(<StatusBar />)
    expect(container.textContent).toContain('1 schema')
    expect(container.textContent).not.toMatch(/namespace/i)

    useExplorerStore.setState({
      namespaces: [{ uri: 'urn:a', displayName: 'A' }, { uri: 'urn:b', displayName: 'B' }],
    })
    rerender(<StatusBar />)
    expect(container.textContent).toContain('2 schemas')
  })

  it('labels a selected namespace as a Schema in its header', () => {
    const namespace: Namespace = { uri: 'urn:a', displayName: 'Machines' }
    useExplorerStore.getState().selectItem({ type: 'namespace', id: 'ns:urn:a', data: namespace })
    const { container } = render(<MainPanel />)
    expect(container.textContent).toContain('Machines')
    expect(container.textContent).toContain('Schema')
    expect(container.textContent).not.toContain('Namespace')
  })

  it('names the overview cards by schema', () => {
    const { container } = render(<ModelOverview objects={objects} objectTypes={objectTypes} namespaceCount={2} />)
    expect(container.textContent).toContain('Schemas')
    expect(container.textContent).toContain('Objects by schema')
    expect(container.textContent).not.toMatch(/namespace/i)
  })
})
