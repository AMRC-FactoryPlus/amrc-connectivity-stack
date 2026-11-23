/*
 * ACS Admin
 * Keeps the console's URL naming the Explorer's selected object and tab
 * Copyright 2026 University of Sheffield
 *
 * The Manager UI writes the selected object and detail tab into its own URL
 * (/explorer?object=…&tab=history), so a link to the page opens the same
 * object on the same tab. This file is the app's half: it tells the host
 * what is selected whenever that changes, and selects what the host asks
 * for, at start-up and when the console's URL changes under the page, once
 * the catalog holds the object.
 */

import { useExplorerStore, type DetailTab, type SelectedItem } from '../stores/explorer'
import { buildAncestorChain } from '../components/main/navigation'

/** Where the Explorer is: the selected object's elementId and its tab. */
export interface HostLocation {
  object: string | null
  tab: DetailTab | null
}

export interface LocationHost {
  /** Where the console's URL says the Explorer should be now. */
  location?(): HostLocation | null
  /** The Explorer moved: the console writes this into its URL. */
  setLocation?(location: HostLocation): void
  /** Register what moves the Explorer when the console's URL changes. */
  onLocationRequest?(go: (location: HostLocation) => void): () => void
}

const TABS: DetailTab[] = ['overview', 'history']

/** A tab name from a URL, or null when it is not one of the detail tabs. */
export function parseTab(tab: unknown): DetailTab | null {
  return TABS.includes(tab as DetailTab) ? tab as DetailTab : null
}

/**
 * The location for a selection. Only objects have one; Overview, the tab a
 * new object opens on, is left out so the URL stays short.
 */
export function locationOf(item: SelectedItem | null, tab: DetailTab): HostLocation {
  if (!item || item.type !== 'object') return { object: null, tab: null }
  const object = (item.data as { elementId?: string }).elementId ?? null
  return { object, tab: object && tab !== 'overview' ? tab : null }
}

export function sameLocation(a: HostLocation | null, b: HostLocation | null): boolean {
  return (a?.object ?? null) === (b?.object ?? null) && (a?.tab ?? null) === (b?.tab ?? null)
}

/**
 * Select an object by elementId under the hierarchy, opening the tree down to
 * it. False when the catalog does not hold it.
 */
export function revealObject(elementId: string, tab: DetailTab | null): boolean {
  const { objectIndex, expandedNodes, selectItem } = useExplorerStore.getState()
  const target = objectIndex.get(elementId)
  if (!target) return false
  const expanded = new Set(expandedNodes)
  expanded.add('folder:hierarchical')
  for (const ancestor of buildAncestorChain(target, objectIndex)) expanded.add(`hier:${ancestor.elementId}`)
  useExplorerStore.setState({ expandedNodes: expanded })
  selectItem({ type: 'object', id: `hier:${target.elementId}`, data: target }, tab ?? 'overview')
  return true
}

/**
 * Keep the host's URL and the Explorer's selection in step. Returns a
 * function that stops it (for tests).
 */
export function syncHostLocation(host: LocationHost | null): () => void {
  if (!host?.setLocation) return () => {}
  const store = useExplorerStore
  // A location waiting for the catalog to hold its object.
  let wanted: HostLocation | null = null
  // What the host was last told, so it is not told twice.
  let told: HostLocation | null = null

  const tell = () => {
    if (wanted) return
    const { selectedItem, detailTab } = store.getState()
    const now = locationOf(selectedItem, detailTab)
    if (sameLocation(now, told)) return
    told = now
    host.setLocation?.(now)
  }

  const tryWanted = () => {
    if (!wanted) return
    const { object, tab } = wanted
    const { allObjectsLoaded, selectedItem, detailTab } = store.getState()
    if (!object) {
      wanted = null
      if (selectedItem) store.getState().selectItem(null)
      return
    }
    // Already there: only the tab may differ.
    if (sameLocation(locationOf(selectedItem, detailTab), { object, tab })) {
      wanted = null
      return
    }
    if (revealObject(object, tab)) {
      wanted = null
      return
    }
    // The whole catalog is in and the object is not: give up, and let the URL
    // follow whatever is shown.
    if (allObjectsLoaded) {
      console.warn('The i3X Explorer has no object %s to open.', object)
      wanted = null
      tell()
    }
  }

  const go = (location: HostLocation) => {
    const next = { object: location?.object ?? null, tab: parseTab(location?.tab) }
    if (sameLocation(next, told) && !wanted) return
    wanted = next
    told = next
    tryWanted()
  }

  const first = host.location?.()
  if (first?.object) go(first)
  else told = { object: null, tab: null }

  let last = store.getState()
  const unsubscribe = store.subscribe(state => {
    const moved = state.selectedItem !== last.selectedItem || state.detailTab !== last.detailTab
    const loaded = state.objectIndex !== last.objectIndex || state.allObjectsLoaded !== last.allObjectsLoaded
    last = state
    // A move while waiting is the user's (or the reveal's own): it wins.
    if (moved) {
      wanted = null
      tell()
    }
    else if (wanted && loaded) tryWanted()
  })
  const unregister = host.onLocationRequest?.(go) ?? (() => {})

  return () => {
    unsubscribe()
    unregister()
  }
}
