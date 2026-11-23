// @vitest-environment jsdom
/*
 * ACS Admin
 * Tests the Explorer's toolbar when the Manager UI frames it
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useExplorerStore } from '../stores/explorer'

vi.mock('./host', () => ({
  acsHost: {
    theme: () => 'light',
    openNewWindow: () => {},
  },
}))

const { Toolbar } = await import('../components/layout/Toolbar')

beforeEach(() => {
  useExplorerStore.getState().reset()
})

afterEach(() => {
  cleanup()
})

describe('branding when hosted', () => {
  it('hides the i3X Explorer logo and name', () => {
    const { container } = render(<Toolbar />)
    expect(screen.queryByRole('button', { name: 'i3X Explorer' })).toBeNull()
    expect(screen.queryByText('i3X Explorer')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps the About dialog and its credit, from the settings menu', () => {
    render(<Toolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'About i3X Explorer' }))
    const about = screen.getByRole('dialog')
    expect(about.textContent).toContain('MIT Licensed')
  })
})
