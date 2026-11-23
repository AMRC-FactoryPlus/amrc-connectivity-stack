// @vitest-environment jsdom
// ACS: the browser's Back and Forward move through the Explorer's stops.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExplorerStore } from '../stores/explorer'
import { syncBrowserHistory } from './browserHistory'

const stop = (id: string) => ({ item: { type: 'object', id } as never, tab: 'overview' as const, page: null })

describe('syncBrowserHistory', () => {
  let stopSync: () => void
  let pushState: ReturnType<typeof vi.spyOn>
  let go: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    useExplorerStore.setState(useExplorerStore.getInitialState())
    pushState = vi.spyOn(window.history, 'pushState')
    go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    stopSync = syncBrowserHistory(window)
  })

  afterEach(() => {
    stopSync()
    vi.restoreAllMocks()
  })

  const push = (id: string) => {
    const { history, historyIndex } = useExplorerStore.getState()
    const next = [...history.slice(0, historyIndex + 1), stop(id)]
    useExplorerStore.setState({ history: next, historyIndex: next.length - 1 })
  }

  it('adds a browser history entry for each new stop', () => {
    push('a')
    push('b')
    expect(pushState).toHaveBeenCalledTimes(2)
    expect(pushState).toHaveBeenLastCalledWith({ i3x: 2 }, '')
  })

  it('moves the Explorer when the browser goes back', () => {
    push('a')
    push('b')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { i3x: 1 } }))
    expect(useExplorerStore.getState().historyIndex).toBe(1)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { i3x: 2 } }))
    expect(useExplorerStore.getState().historyIndex).toBe(2)
    // Moving for the browser is not echoed back to it.
    expect(go).not.toHaveBeenCalled()
  })

  it('moves the browser when the toolbar goes back, without applying it twice', () => {
    push('a')
    push('b')
    useExplorerStore.getState().goBack()
    expect(go).toHaveBeenCalledWith(-1)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { i3x: 1 } }))
    expect(useExplorerStore.getState().historyIndex).toBe(1)
  })

  it('ignores entries that are not the Explorer\'s', () => {
    push('a')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { other: true } }))
    expect(useExplorerStore.getState().historyIndex).toBe(1)
  })
})
