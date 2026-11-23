/*
 * ACS Admin
 * Pops the subscriptions panel out into its own browser window, and docks it back
 * Copyright 2026 University of Sheffield
 *
 * The pop-out is a window this frame opens, same origin and empty, which the panel is rendered
 * into with a React portal from this app. So it is the same React tree, with the same stores and
 * the same subscription transport: there is no second connection or stream, and the window shows
 * exactly what the docked panel would. The window gets copies of this document's stylesheets and
 * follows its theme, so it looks the same.
 *
 * The window docks back when its Dock button is pressed or it is closed, and it is closed when
 * this frame goes away. The choice lives in memory only, so it lasts for this visit and a reload
 * starts docked (browsers block a window opened without a click anyway).
 */

import { create } from 'zustand'
import { setFrameWindow } from '../stores/frameBatcher'
import { useSubscriptionsStore } from '../stores/subscriptions'

export const POPOUT_WINDOW_NAME = 'i3x-explorer-subscriptions'
const POPOUT_FEATURES = 'popup,width=1100,height=680'
/** How often to check for the window closed without a pagehide, which some browsers skip. */
const CLOSED_POLL_MS = 500

interface PopoutState {
  /** The pop-out window while the panel is in it. */
  popout: Window | null
  /** Where the panel is rendered in that window. */
  container: HTMLElement | null
  /** The browser refused to open the window. */
  blocked: boolean
  /** Set on docking, so the docked panel takes keyboard focus back. */
  restoreFocus: boolean
  /** Opens the window. Call from a click, or the browser blocks it. */
  popOut: () => void
  /** Closes the window, if open, and shows the panel in the frame again. */
  dock: () => void
  /** Brings the window to the front. */
  focusPopout: () => void
  dismissBlocked: () => void
  focusRestored: () => void
}

let teardown: (() => void) | null = null

/** Gives the empty window this document's styles, theme and a root to render into. */
function prepareDocument(popout: Window, source: Document): HTMLElement {
  const target = popout.document
  target.title = `Subscriptions · ${source.title || 'i3X Explorer'}`
  target.head.replaceChildren()
  const charset = target.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  target.head.appendChild(charset)
  for (const node of Array.from(source.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
    const copy = target.importNode(node, true) as HTMLElement
    // An absolute href, so the stylesheet loads whatever the empty window's base is.
    if (copy.tagName === 'LINK') {
      copy.setAttribute('href', (node as HTMLLinkElement).href)
    }
    target.head.appendChild(copy)
  }
  target.documentElement.lang = source.documentElement.lang
  target.body.className = source.body.className
  target.body.replaceChildren()
  const container = target.createElement('div')
  container.id = 'root'
  target.body.appendChild(container)
  return container
}

/** Keeps the window's theme with this document's, which the toolbar sets on <html>. */
function mirrorTheme(popout: Window, source: Document): () => void {
  const copy = () => {
    const from = source.documentElement
    const to = popout.document.documentElement
    if (from.dataset.theme) to.dataset.theme = from.dataset.theme
    else delete to.dataset.theme
    to.className = from.className
  }
  copy()
  const View = source.defaultView?.MutationObserver ?? MutationObserver
  const observer = new View(copy)
  observer.observe(source.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  return () => observer.disconnect()
}

export const useSubscriptionsPopout = create<PopoutState>((set, get) => ({
  popout: null,
  container: null,
  blocked: false,
  restoreFocus: false,

  popOut: () => {
    if (get().popout) {
      get().focusPopout()
      return
    }
    let popout: Window | null = null
    try {
      popout = window.open('', POPOUT_WINDOW_NAME, POPOUT_FEATURES)
    } catch {
      popout = null
    }
    if (!popout) {
      set({ blocked: true })
      return
    }

    const container = prepareDocument(popout, document)
    const stopTheme = mirrorTheme(popout, document)
    const opened = popout
    const onClosed = () => {
      if (get().popout === opened) get().dock()
    }
    const onFrameGone = () => {
      if (!opened.closed) opened.close()
    }
    opened.addEventListener('pagehide', onClosed)
    window.addEventListener('pagehide', onFrameGone)
    const poll = window.setInterval(() => {
      if (opened.closed) onClosed()
    }, CLOSED_POLL_MS)
    // Draw live updates on the window's frames, which keep coming while this tab is in the background.
    setFrameWindow(opened)

    teardown = () => {
      setFrameWindow(null)
      stopTheme()
      window.clearInterval(poll)
      opened.removeEventListener('pagehide', onClosed)
      window.removeEventListener('pagehide', onFrameGone)
      if (!opened.closed) opened.close()
    }

    set({ popout: opened, container, blocked: false })
    opened.focus()
  },

  dock: () => {
    if (!get().popout) return
    const done = teardown
    teardown = null
    set({ popout: null, container: null, restoreFocus: true })
    useSubscriptionsStore.getState().setSubscriptionsOpen(true)
    done?.()
  },

  focusPopout: () => {
    const { popout } = get()
    if (popout && !popout.closed) popout.focus()
  },

  dismissBlocked: () => set({ blocked: false }),
  focusRestored: () => set({ restoreFocus: false }),
}))
