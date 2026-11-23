// @vitest-environment jsdom
/*
 * ACS Admin
 * Tests the tree panel's starting width
 * Copyright 2026 University of Sheffield
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Sidebar } from '../components/layout/Sidebar'
import { useConnectionStore } from '../stores/connection'

afterEach(() => {
  cleanup()
})

describe('tree panel width', () => {
  it('starts 415px wide and stays resizable between 224px and 480px', () => {
    useConnectionStore.setState({ isConnected: false })
    const { container } = render(<Sidebar />)
    const panel = container.firstElementChild as HTMLElement
    expect(panel.style.width).toBe('415px')
    expect(panel.style.minWidth).toBe('224px')
    expect(panel.style.maxWidth).toBe('480px')

    const handle = panel.lastElementChild as HTMLElement
    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: 900 })
    fireEvent.mouseUp(window)
    expect(panel.style.width).toBe('480px')

    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: 100 })
    fireEvent.mouseUp(window)
    expect(panel.style.width).toBe('224px')
  })
})
