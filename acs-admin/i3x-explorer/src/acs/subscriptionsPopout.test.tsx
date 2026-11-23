// @vitest-environment jsdom
/*
 * ACS Admin
 * Tests for popping the subscriptions panel out into its own window and docking it back
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SubscriptionsDrawer } from '../components/subscriptions/SubscriptionsDrawer'
import { SubscriptionTransportProvider } from '../components/subscriptions/SubscriptionTransport'
import { StatusBar } from '../components/layout/StatusBar'
import { useConnectionStore } from '../stores/connection'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { installJsdomLayout } from '../testing/jsdomLayout'
import { POPOUT_WINDOW_NAME, useSubscriptionsPopout } from './subscriptionsPopout'

interface FakePopup {
  document: Document
  closed: boolean
  focus: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: EventTarget['addEventListener']
  removeEventListener: EventTarget['removeEventListener']
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (handle: number) => void
  /** The user closes the window: it reports pagehide, as a browser does. */
  userCloses: () => void
}

/** A stand-in for the window `window.open` returns, with a real document from an iframe. */
function fakePopup(): FakePopup {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  const events = new EventTarget()
  const popup: FakePopup = {
    document: frame.contentDocument!,
    closed: false,
    focus: vi.fn(),
    close: vi.fn(() => {
      if (popup.closed) return
      popup.closed = true
      events.dispatchEvent(new Event('pagehide'))
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    requestAnimationFrame: callback => window.setTimeout(() => callback(0), 16),
    cancelAnimationFrame: handle => window.clearTimeout(handle),
    userCloses: () => {
      popup.closed = true
      events.dispatchEvent(new Event('pagehide'))
    },
  }
  return popup
}

function renderApp() {
  return render(
    <SubscriptionTransportProvider>
      <SubscriptionsDrawer />
      <StatusBar />
    </SubscriptionTransportProvider>
  )
}

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

beforeAll(installJsdomLayout)

beforeEach(() => {
  useConnectionStore.setState({ isConnected: true })
  useSubscriptionsStore.getState().clearAll()
  useSubscriptionsStore.getState().setSubscriptionsOpen(true)
  useSubscriptionsPopout.setState({ popout: null, container: null, blocked: false, restoreFocus: false })
  const style = document.createElement('style')
  style.dataset.testStyle = ''
  style.textContent = ':root { --i3x-bg: 1 2 3; }'
  document.head.appendChild(style)
  document.documentElement.dataset.theme = 'light'
})

afterEach(() => {
  useSubscriptionsPopout.getState().dock()
  cleanup()
  vi.restoreAllMocks()
  document.head.querySelectorAll('[data-test-style]').forEach(node => node.remove())
  document.querySelectorAll('iframe').forEach(node => node.remove())
})

describe('popping the subscriptions panel out', () => {
  it('opens its own window with the panel, the styles and the theme, and hides the drawer', async () => {
    const popup = fakePopup()
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'Pop out subscriptions' }))

    expect(open).toHaveBeenCalledWith('', POPOUT_WINDOW_NAME, expect.stringContaining('popup'))
    expect(popup.focus).toHaveBeenCalled()
    const dock = Array.from(popup.document.querySelectorAll('button')).find(button => button.textContent === 'Dock')
    expect(dock).toBeDefined()
    expect(popup.document.body.textContent).toContain('Subscriptions')
    expect(popup.document.head.querySelector('style')?.textContent).toContain('--i3x-bg')
    expect(popup.document.documentElement.dataset.theme).toBe('light')
    // Keyboard focus starts on Dock in the new window.
    expect(popup.document.activeElement).toBe(dock)

    // The drawer is gone from the frame, and the status bar says where it went.
    expect(screen.queryByRole('button', { name: 'Close subscriptions' })).toBeNull()
    expect(screen.getByText(/popped out/)).toBeDefined()

    // The theme follows the frame's.
    document.documentElement.dataset.theme = 'dark'
    await act(async () => {})
    expect(popup.document.documentElement.dataset.theme).toBe('dark')

    // The status bar brings the window to the front.
    popup.focus.mockClear()
    fireEvent.click(screen.getByText(/popped out/))
    expect(popup.focus).toHaveBeenCalled()
  })

  it('docks back from the window\'s Dock button, closing the window and focusing the drawer', () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Pop out subscriptions' }))

    const dock = Array.from(popup.document.querySelectorAll('button')).find(button => button.textContent === 'Dock')!
    click(dock)

    expect(popup.close).toHaveBeenCalled()
    expect(useSubscriptionsPopout.getState().popout).toBeNull()
    const popOut = screen.getByRole('button', { name: 'Pop out subscriptions' })
    expect(document.activeElement).toBe(popOut)
    expect(screen.queryByText(/popped out/)).toBeNull()
  })

  it('docks back when the window is closed', () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Pop out subscriptions' }))

    act(() => popup.userCloses())

    expect(useSubscriptionsPopout.getState().popout).toBeNull()
    expect(screen.getByRole('button', { name: 'Close subscriptions' })).toBeDefined()
  })

  it('docks back when the window closes without saying so', () => {
    vi.useFakeTimers()
    try {
      const popup = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
      renderApp()
      fireEvent.click(screen.getByRole('button', { name: 'Pop out subscriptions' }))

      popup.closed = true
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(useSubscriptionsPopout.getState().popout).toBeNull()
      expect(screen.getByRole('button', { name: 'Close subscriptions' })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the window when the frame goes away', () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Pop out subscriptions' }))

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(popup.close).toHaveBeenCalled()
  })

  it('stays docked and says so when the browser blocks the window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'Pop out subscriptions' }))

    expect(screen.getByRole('status').textContent).toContain('blocked the new window')
    expect(screen.getByRole('button', { name: 'Close subscriptions' })).toBeDefined()
    expect(useSubscriptionsPopout.getState().popout).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
