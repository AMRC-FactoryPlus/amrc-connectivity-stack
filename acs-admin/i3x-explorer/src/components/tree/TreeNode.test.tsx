// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TreeNode } from './TreeNode'
import { TreeView } from './TreeView'
import type { NodeRow } from './treeData'
import { HIERARCHICAL_FOLDER_ID } from './treeData'
import { useExplorerStore } from '../../stores/explorer'
import { createClient, destroyClient } from '../../api/client'
import { installJsdomLayout } from '../../testing/jsdomLayout'

beforeAll(installJsdomLayout)
afterEach(() => {
  cleanup()
  destroyClient()
  useExplorerStore.getState().reset()
  useExplorerStore.setState({ showComponentsInTree: true, showRelationshipsInTree: false })
  vi.restoreAllMocks()
})

it('colors component occurrences without a badge or changing selection or expansion', () => {
  const row: NodeRow = {
    kind: 'node', key: 'parent/component', id: 'hier:component',
    nodeType: 'object', label: 'Speed', depth: 2, parentIndex: 1,
    hasChildren: true, isExpanded: false, isComponent: true,
  }
  const { rerender } = render(<TreeNode row={row} />)
  expect(screen.queryByText('component')).toBeNull()
  expect(screen.getByText('Speed').classList.contains('tree-component')).toBe(true)
  expect(screen.getByText('Speed').classList.contains('font-medium')).toBe(false)
  expect(screen.getByText('Speed').title).toBe('Component: Speed')
  expect(screen.getByRole('treeitem').querySelector('svg.tree-component')).not.toBeNull()
  expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('Speed')).toBeTruthy()

  rerender(<TreeNode row={{ ...row, isComponent: false }} />)
  expect(screen.queryByText('component')).toBeNull()
  expect(screen.getByText('Speed')).toBeTruthy()
  expect(screen.getByText('Speed').classList.contains('tree-component')).toBe(false)
  expect(screen.getByRole('treeitem').querySelector('svg.tree-component')).toBeNull()
})

it('resolves and distinguishes components in the hierarchy with graph relationships hidden', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
  const parent = {
    elementId: 'parent', displayName: 'Parent', typeId: 'T', parentId: null,
    isComposition: true, namespaceUri: 'urn:test',
  }
  const child = { ...parent, elementId: 'child', displayName: 'Child', parentId: 'parent' }
  const component = { ...child, elementId: 'component', displayName: 'Speed', isComposition: false }
  const client = createClient('http://server')
  const getRelated = vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({ related: new Map([
    ['parent', [
      { ...component, sourceRelationship: 'HasComponent' },
      { ...child, sourceRelationship: 'HasChildren' },
    ]],
  ]), failures: [] })
  useExplorerStore.getState().setAllObjects([parent, component, child])
  useExplorerStore.setState({
    namespaces: [{ uri: 'urn:test', displayName: 'Test' }],
    hierarchicalRoots: [parent],
    expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:parent']),
    showRelationshipsInTree: false,
    showComponentsInTree: true,
  })

  render(<TreeView />)
  // ACS: the toggles are in the toolbar's settings menu, not above the tree.
  expect(screen.queryByRole('button', { name: 'Component Relationships' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Graph Relationships' })).toBeNull()
  const toggleComponents = () => act(() => useExplorerStore.getState().toggleShowComponentsInTree())
  await waitFor(() => expect(screen.getByText('Speed').classList.contains('tree-component')).toBe(true))
  expect(screen.queryByText('component')).toBeNull()
  expect(screen.getByText('Child').classList.contains('tree-component')).toBe(false)
  expect(getRelated).toHaveBeenCalledWith(expect.arrayContaining(['parent']))
  const labels = screen.getAllByRole('treeitem').map(row => row.textContent)
  expect(labels.findIndex(label => label?.includes('Child')))
    .toBeLessThan(labels.findIndex(label => label?.includes('Speed')))
  expect(screen.queryByTitle('Relationship: HasComponent')).toBeNull()

  toggleComponents()
  expect(screen.queryByText('Speed')).toBeNull()
  expect(screen.getByText('Child')).toBeTruthy()
  toggleComponents()
  expect(screen.getByText('Speed')).toBeTruthy()
})

it('discovers components for a collapsed owner with no parent-linked children while graph relationships are hidden', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
  const parent = {
    elementId: 'parent', displayName: 'Owner', typeId: 'T', parentId: null,
    isComposition: true, namespaceUri: 'urn:test',
  }
  const component = {
    ...parent, elementId: 'remote', displayName: 'Remote component', parentId: 'elsewhere',
    isComposition: false, sourceRelationship: 'HasComponent',
  }
  const client = createClient('http://server')
  const getRelated = vi.spyOn(client, 'getRelatedObjectsBatch').mockImplementation(async ids =>
    ({ related: new Map(ids.map(id => [id, id === 'parent' ? [component] : []])), failures: [] }))
  useExplorerStore.getState().setAllObjects([parent])
  useExplorerStore.setState({
    namespaces: [{ uri: 'urn:test', displayName: 'Test' }],
    hierarchicalRoots: [parent],
    expandedNodes: new Set([HIERARCHICAL_FOLDER_ID]),
    showRelationshipsInTree: false,
    showComponentsInTree: true,
  })

  render(<TreeView />)
  await waitFor(() => expect(screen.getByText('Owner').closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('false'))
  expect(getRelated).toHaveBeenCalledWith(['parent'])
  fireEvent.click(screen.getByText('Owner'))
  expect(screen.getAllByText('Remote component')).toHaveLength(1)
  expect(screen.getByTitle('Component: Remote component')).toBeTruthy()

  act(() => useExplorerStore.getState().toggleShowComponentsInTree()) // ACS: toggle is in the settings menu
  expect(screen.queryByText('Remote component')).toBeNull()
  expect(screen.getByText('Owner').closest('[role="treeitem"]')?.hasAttribute('aria-expanded')).toBe(false)
})
