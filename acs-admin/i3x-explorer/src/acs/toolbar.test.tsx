// @vitest-environment jsdom
/*
 * ACS Admin
 * Tests the ACS changes to the Explorer's toolbar
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useExplorerStore } from '../stores/explorer'
import { Toolbar } from '../components/layout/Toolbar'

beforeEach(() => {
  useExplorerStore.getState().reset()
  useExplorerStore.setState({ showRelationshipsInTree: false, showComponentsInTree: true })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
}

describe('tree relationship toggles in the settings menu', () => {
  it('lists both toggles as ticked options, ticked to match the store', () => {
    render(<Toolbar />)
    openSettings()

    const graph = screen.getByRole('button', { name: /Graph Relationships/ })
    const components = screen.getByRole('button', { name: /Component Relationships/ })
    expect(graph.getAttribute('aria-pressed')).toBe('false')
    expect(graph.querySelector('svg')).toBeNull()
    expect(components.getAttribute('aria-pressed')).toBe('true')
    expect(components.querySelector('svg')).not.toBeNull()
  })

  it('flips the store flags the tree reads and keeps the menu open', () => {
    render(<Toolbar />)
    openSettings()

    fireEvent.click(screen.getByRole('button', { name: /Graph Relationships/ }))
    expect(useExplorerStore.getState().showRelationshipsInTree).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Component Relationships/ }))
    expect(useExplorerStore.getState().showComponentsInTree).toBe(false)

    expect(screen.getByRole('button', { name: /Graph Relationships/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Component Relationships/ }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('branding when standalone', () => {
  it('shows the i3X Explorer logo and name, which open About', () => {
    render(<Toolbar />)
    const logo = screen.getByRole('button', { name: 'i3X Explorer' })
    expect(logo.querySelector('img')).not.toBeNull()
    fireEvent.click(logo)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('leaves About out of the settings menu, as upstream', () => {
    render(<Toolbar />)
    openSettings()
    expect(screen.queryByRole('button', { name: 'About i3X Explorer' })).toBeNull()
  })
})
