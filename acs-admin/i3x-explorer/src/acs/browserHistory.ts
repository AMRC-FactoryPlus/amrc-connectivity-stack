// ACS: the browser's Back and Forward move through the Explorer's history.
//
// The Explorer keeps its own stack of stops (stores/explorer.ts, history and
// historyIndex) for its toolbar arrows. Each new stop is also pushed onto the
// browser's session history, which a same-origin frame shares with the page
// around it, so the browser's Back and Forward reach the Explorer's stops
// before the Manager UI's own pages. A popstate moves the Explorer to the
// stop the entry names; the toolbar arrows move the browser with them, so the
// two stacks stay in step.

import { useExplorerStore } from '../stores/explorer'

interface HistoryState { i3x: number }

const stopOf = (state: unknown): number | null => {
  const index = (state as HistoryState | null)?.i3x
  return typeof index === 'number' ? index : null
}

/**
 * Keep the browser's history and the Explorer's in step. Returns a function
 * that stops it (for tests).
 *
 * @param win the window whose history to use, the frame's own by default
 */
export function syncBrowserHistory (win: Window = window): () => void {
  const store = useExplorerStore
  // Set while we move the store for a popstate, so the store change that
  // follows is not echoed back to the browser.
  let applyingPop = false
  // Set while we move the browser for a toolbar arrow, so the popstate that
  // follows is not applied a second time.
  let expectedPops = 0

  win.history.replaceState({ ...(win.history.state ?? {}), i3x: store.getState().historyIndex }, '')

  let last = { history: store.getState().history, index: store.getState().historyIndex }

  const unsubscribe = store.subscribe(state => {
    const { history, historyIndex: index } = state
    if (history === last.history && index === last.index) return
    const pushed = history !== last.history && index === history.length - 1 && index >= last.index
    const delta = index - last.index
    last = { history, index }
    if (applyingPop) return
    if (pushed) {
      win.history.pushState({ i3x: index }, '')
    } else if (delta !== 0) {
      // The toolbar's own Back or Forward: move the browser the same way.
      expectedPops++
      win.history.go(delta)
    }
  })

  const onPopState = (event: PopStateEvent) => {
    if (expectedPops > 0) {
      expectedPops--
      return
    }
    const target = stopOf(event.state)
    if (target === null) return
    const { history, historyIndex, goBack, goForward } = store.getState()
    // The stack holds at most 50 stops, so an old entry can point past it.
    const clamped = Math.max(0, Math.min(target, history.length - 1))
    applyingPop = true
    try {
      for (let i = historyIndex; i > clamped; i--) goBack()
      for (let i = historyIndex; i < clamped; i++) goForward()
    } finally {
      applyingPop = false
    }
  }
  win.addEventListener('popstate', onPopState)

  return () => {
    unsubscribe()
    win.removeEventListener('popstate', onPopState)
  }
}
