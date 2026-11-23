// @vitest-environment jsdom
/*
 * ACS Admin
 * Tests search from the tree's filter box
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TreeView } from '../components/tree/TreeView'
import { SearchModal } from '../components/search/SearchModal'
import { Toolbar } from '../components/layout/Toolbar'
import { HIERARCHICAL_FOLDER_ID } from '../components/tree/treeData'
import { useExplorerStore } from '../stores/explorer'
import { useConnectionStore } from '../stores/connection'
import { installJsdomLayout } from '../testing/jsdomLayout'
import type { ObjectInstance } from '../api/types'
import { useSearchDialog } from './searchDialog'

const HINT = 'Nothing in the visible tree. Press Enter to search.'

const line: ObjectInstance = {
  elementId: 'line-1', displayName: 'Line 1', typeId: 'Line', parentId: null,
  isComposition: false, namespaceUri: 'urn:test',
}
const press: ObjectInstance = { ...line, elementId: 'press-3', displayName: 'Press 3', parentId: 'line-1' }

beforeAll(installJsdomLayout)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
  useExplorerStore.getState().reset()
  useExplorerStore.getState().setAllObjects([line, press])
  useExplorerStore.setState({
    namespaces: [{ uri: 'urn:test', displayName: 'Test' }],
    hierarchicalRoots: [line],
    expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:line-1']),
  })
  useSearchDialog.getState().closeSearch()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useConnectionStore.setState({ isConnected: false })
})

const filterBox = () => screen.getByRole('textbox', { name: 'Filter tree' })

describe('search from the tree filter', () => {
  it('puts the Search button beside the filter box', () => {
    render(<TreeView />)
    const button = screen.getByRole('button', { name: 'Search objects' })
    expect(button.parentElement).toBe(filterBox().parentElement)
    expect(filterBox().nextElementSibling).toBe(button)
  })

  it('still filters the tree as you type', () => {
    render(<TreeView />)
    fireEvent.change(filterBox(), { target: { value: 'press' } })
    expect(screen.getByText('Press 3')).toBeTruthy()
    expect(screen.queryByText(HINT)).toBeNull()
    expect(useSearchDialog.getState().open).toBe(false)
  })

  it('opens search with the typed text on Enter', () => {
    render(<TreeView />)
    fireEvent.change(filterBox(), { target: { value: ' Press 3 ' } })
    fireEvent.keyDown(filterBox(), { key: 'Enter' })
    expect(useSearchDialog.getState()).toMatchObject({ open: true, initialQuery: 'Press 3' })
  })

  it('opens search with the typed text from the Search button', () => {
    render(<TreeView />)
    fireEvent.change(filterBox(), { target: { value: 'line' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search objects' }))
    expect(useSearchDialog.getState()).toMatchObject({ open: true, initialQuery: 'line' })
  })

  it('says to press Enter when the filter finds nothing in the visible tree', () => {
    render(<TreeView />)
    fireEvent.change(filterBox(), { target: { value: 'spindle speed' } })
    expect(screen.getByText(HINT)).toBeTruthy()

    fireEvent.change(filterBox(), { target: { value: '' } })
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('starts the search dialog with the text it was opened with', () => {
    render(<SearchModal initialQuery="Press 3" onClose={() => {}} />)
    expect((screen.getByPlaceholderText('Search objects by name or ID…') as HTMLInputElement).value).toBe('Press 3')
  })
})

describe('the toolbar and search', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  it('has no Search button of its own', () => {
    useConnectionStore.setState({ isConnected: true })
    render(<Toolbar />)
    expect(screen.queryByRole('button', { name: 'Search objects' })).toBeNull()
  })

  it('still opens an empty search on ⌘K, and shows the dialog with the filter text', () => {
    useConnectionStore.setState({ isConnected: true })
    render(<Toolbar />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(useSearchDialog.getState()).toMatchObject({ open: true, initialQuery: '' })
    expect((screen.getByPlaceholderText('Search objects by name or ID…') as HTMLInputElement).value).toBe('')

    fireEvent.keyDown(screen.getByPlaceholderText('Search objects by name or ID…'), { key: 'Escape' })
    expect(useSearchDialog.getState().open).toBe(false)

    act(() => useSearchDialog.getState().openSearch('Spindle speed'))
    expect((screen.getByPlaceholderText('Search objects by name or ID…') as HTMLInputElement).value).toBe('Spindle speed')
  })
})
