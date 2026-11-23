/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * ⌘K / Ctrl+K on any page of the console opens the i3X Explorer's search.
 * The Explorer's frame may load after the key is pressed, so a request
 * waits for it to register.
 */

import { describe, it, expect, vi } from 'vitest'
import { is_search_shortcut, on_explorer_search, request_explorer_search } from '../src/lib/explorer-search.js'
import { mk_host } from '../src/lib/i3x-explorer-host.js'

describe('the search shortcut', () => {
  it('is ⌘K or Ctrl+K with no other modifier', () => {
    expect(is_search_shortcut({ metaKey: true, key: 'k' })).toBe(true)
    expect(is_search_shortcut({ ctrlKey: true, key: 'K' })).toBe(true)
    expect(is_search_shortcut({ metaKey: true, shiftKey: true, key: 'k' })).toBe(false)
    expect(is_search_shortcut({ key: 'k' })).toBe(false)
    expect(is_search_shortcut({ metaKey: true, key: 'b' })).toBe(false)
  })

  it('opens search at once when the Explorer is ready', () => {
    const open = vi.fn()
    const stop = on_explorer_search(open)
    request_explorer_search()
    expect(open).toHaveBeenCalledTimes(1)
    stop()
  })

  it('waits for the Explorer when it is not loaded yet', () => {
    request_explorer_search()
    const open = vi.fn()
    const stop = on_explorer_search(open)
    expect(open).toHaveBeenCalledTimes(1)
    request_explorer_search()
    expect(open).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops after the Explorer unregisters', () => {
    const open = vi.fn()
    on_explorer_search(open)()
    request_explorer_search()
    expect(open).not.toHaveBeenCalled()
    on_explorer_search(() => {})() // clear the pending request
  })

  it('reaches the frame through the host', () => {
    const on_search = vi.fn(() => () => {})
    const host = mk_host({ client: {}, theme: () => 'light', on_search })
    const open = () => {}
    host.onSearchRequest(open)
    expect(on_search).toHaveBeenCalledWith(open)
  })
})
