/*
 * ACS Admin
 * Tests for keeping the console's URL naming the Explorer's selection
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExplorerStore } from '../stores/explorer'
import type { ObjectInstance } from '../api/types'
import { locationOf, parseTab, syncHostLocation, type HostLocation } from './hostLocation'

const object = (elementId: string, parentId: string | null): ObjectInstance => ({
  elementId,
  displayName: elementId,
  typeId: 'type',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
})

const root = object('root', null)
const device = object('device', 'root')
const metric = object('device/Speed', 'device')

function loadCatalog (objects: ObjectInstance[]) {
  useExplorerStore.setState({
    objectIndex: new Map(objects.map(o => [o.elementId, o])),
    allObjects: objects,
    allObjectsLoaded: true,
  })
}

function fakeHost (start: HostLocation | null) {
  let go: ((l: HostLocation) => void) | null = null
  const host = {
    location: () => start,
    setLocation: vi.fn(),
    onLocationRequest: (g: (l: HostLocation) => void) => { go = g; return () => { go = null } },
  }
  return { host, go: (l: HostLocation) => go?.(l) }
}

describe('parseTab and locationOf', () => {
  it('takes only the detail tabs', () => {
    expect(parseTab('history')).toBe('history')
    expect(parseTab('overview')).toBe('overview')
    expect(parseTab('subtree')).toBe(null)
    expect(parseTab(undefined)).toBe(null)
  })

  it('names objects, and leaves Overview out', () => {
    const item = { type: 'object' as const, id: 'hier:device', data: device }
    expect(locationOf(item, 'overview')).toEqual({ object: 'device', tab: null })
    expect(locationOf(item, 'history')).toEqual({ object: 'device', tab: 'history' })
    expect(locationOf(null, 'history')).toEqual({ object: null, tab: null })
    expect(locationOf({ type: 'objectType', id: 'type:t', data: { elementId: 't' } as never }, 'overview'))
      .toEqual({ object: null, tab: null })
  })
})

describe('syncHostLocation', () => {
  let stop = () => {}
  beforeEach(() => { useExplorerStore.setState(useExplorerStore.getInitialState()) })
  afterEach(() => stop())

  it('tells the host about each selection and tab change', () => {
    loadCatalog([root, device, metric])
    const { host } = fakeHost(null)
    stop = syncHostLocation(host)
    useExplorerStore.getState().selectItem({ type: 'object', id: 'hier:device/Speed', data: metric })
    expect(host.setLocation).toHaveBeenLastCalledWith({ object: 'device/Speed', tab: null })
    useExplorerStore.getState().setDetailTab('history')
    expect(host.setLocation).toHaveBeenLastCalledWith({ object: 'device/Speed', tab: 'history' })
    useExplorerStore.getState().selectItem(null)
    expect(host.setLocation).toHaveBeenLastCalledWith({ object: null, tab: null })
    expect(host.setLocation).toHaveBeenCalledTimes(3)
  })

  it('opens the object the URL names once the catalog holds it', () => {
    const { host } = fakeHost({ object: 'device/Speed', tab: 'history' })
    stop = syncHostLocation(host)
    expect(useExplorerStore.getState().selectedItem).toBe(null)
    loadCatalog([root, device, metric])
    const state = useExplorerStore.getState()
    expect(state.selectedItem?.id).toBe('hier:device/Speed')
    expect(state.detailTab).toBe('history')
    expect(state.expandedNodes.has('hier:root')).toBe(true)
    expect(state.expandedNodes.has('hier:device')).toBe(true)
    // The host already has this location in its URL.
    expect(host.setLocation).not.toHaveBeenCalled()
  })

  it('lets the URL follow what is shown when the object is not there', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { host } = fakeHost({ object: 'gone', tab: null })
    stop = syncHostLocation(host)
    loadCatalog([root, device])
    expect(useExplorerStore.getState().selectedItem).toBe(null)
    expect(host.setLocation).toHaveBeenLastCalledWith({ object: null, tab: null })
    warn.mockRestore()
  })

  it('moves when the console URL changes under it', () => {
    loadCatalog([root, device, metric])
    const { host, go } = fakeHost(null)
    stop = syncHostLocation(host)
    go({ object: 'device', tab: null })
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:device')
    go({ object: null, tab: null })
    expect(useExplorerStore.getState().selectedItem).toBe(null)
    expect(host.setLocation).not.toHaveBeenCalled()
  })

  it('does nothing without a host', () => {
    expect(() => syncHostLocation(null)()).not.toThrow()
  })
})
