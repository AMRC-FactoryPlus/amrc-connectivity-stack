/*
 * ACS Admin
 * The seam between the vendored i3X Explorer and the Manager UI that frames it
 * Copyright 2026 University of Sheffield
 *
 * This file is ACS's own, not upstream's. The Manager UI shows this app in a
 * same-origin iframe and, before it creates the frame, puts a host object on
 * its own window as `__acsI3xExplorerHost`. The app finds it through
 * `window.parent`. With a host, the app:
 *
 *   - connects at start-up to the i3X service the host names, with no
 *     connection dialog;
 *   - sends the Manager UI's own Bearer token for that service, asking the
 *     host for a new one when the service refuses it;
 *   - takes the Manager UI's theme as its starting theme;
 *   - asks the host which of its own actions (Manage access, Build dataset)
 *     the selected object has, shows them beside Subscribe, and tells the host
 *     to run one when it is clicked.
 *
 * Without a host (the files opened on their own) the app is upstream's web
 * build, unchanged.
 */

import { useEffect, useState } from 'react'
import type { AuthProvider } from '../api/authProvider'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore, type SelectedItem } from '../stores/explorer'
import type { ObjectInstance } from '../api/types'
import { useSearchDialog } from './searchDialog'

export type HostTheme = 'light' | 'dark'

/** An object as the host sees it: what it needs to act on the selection. */
export interface HostObject {
  elementId: string
  displayName: string
  typeId: string
  parentId: string | null
}

/** The selected object, with its ancestors from the top of the tree down. */
export interface HostSelection {
  object: HostObject
  ancestors: HostObject[]
}

/** One of the host's own actions on the selection, offered as a button. */
export interface HostAction {
  /** What to pass back to `runAction`, e.g. "access" or "dataset". */
  id: string
  /** The button's text, e.g. "Manage access". */
  label: string
  /** The button's tooltip. */
  title?: string
}

export interface AcsExplorerHost {
  /** The i3X base URL, including the version path, e.g. https://i3x.example/v1. */
  serviceUrl(): Promise<string>
  /** A Bearer token for the service; `bad` is one the service refused. */
  token(bad?: string): Promise<string>
  /** The Manager UI's theme now. */
  theme(): HostTheme
  /** Open the Explorer page of the Manager UI in a new browser window. */
  openNewWindow(): void
  /** The host's actions on this object, none when it offers nothing. */
  actions(selection: HostSelection): Promise<HostAction[]>
  /** Run one of the actions `actions` gave for this object. */
  runAction(id: string, selection: HostSelection): void
  /** Register what opens search, for ⌘K pressed outside the frame. */
  onSearchRequest?(open: () => void): () => void
  /** Esc the app did not use itself, e.g. to leave the console's full screen. */
  escape?(): void
}

const HOST_KEY = '__acsI3xExplorerHost'

function findHost(): AcsExplorerHost | null {
  try {
    if (window.parent === window) return null
    const host = (window.parent as unknown as Record<string, unknown>)[HOST_KEY]
    return host && typeof host === 'object' ? host as AcsExplorerHost : null
  } catch {
    // A parent on another origin: not the Manager UI.
    return null
  }
}

/** The Manager UI framing this app, or null when it runs on its own. */
export const acsHost: AcsExplorerHost | null = findHost()

/**
 * Sends the host's token. The token carries no lifetime, so it is kept until
 * the service refuses it; then the host is asked for a new one and the
 * request is retried once.
 */
export class HostTokenProvider implements AuthProvider {
  private token: string | null = null
  private pending: Promise<string> | null = null

  constructor(private readonly host: Pick<AcsExplorerHost, 'token'>) {}

  async getHeaders(): Promise<Record<string, string>> {
    const token = this.token ?? await this.renew()
    return { Authorization: `Bearer ${token}` }
  }

  async handleUnauthorized(sent: Record<string, string>): Promise<boolean> {
    const authorization = sent.Authorization
    const refused = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
    if (this.token !== null && this.token !== refused) return true
    try {
      return (await this.renew(refused)) !== refused
    } catch {
      return false
    }
  }

  private renew(bad?: string): Promise<string> {
    if (!this.pending) {
      this.pending = this.host.token(bad)
        .then(token => {
          this.token = token
          return token
        })
        .finally(() => {
          this.pending = null
        })
    }
    return this.pending
  }
}

/** The auth provider for a hosted connection, or undefined to use upstream's own. */
export function hostAuthProvider(): AuthProvider | undefined {
  return acsHost ? new HostTokenProvider(acsHost) : undefined
}

function hostObject(object: ObjectInstance): HostObject {
  return {
    elementId: object.elementId,
    displayName: object.displayName,
    typeId: object.typeId,
    parentId: object.parentId ?? null,
  }
}

/** The selection as the host sees it, walking parents through the catalog. */
export function hostSelection(
  item: SelectedItem | null,
  objectIndex: Map<string, ObjectInstance>
): HostSelection | null {
  if (!item || item.type !== 'object') return null
  const object = item.data as ObjectInstance
  const ancestors: HostObject[] = []
  const seen = new Set([object.elementId])
  for (let id = object.parentId; id && !seen.has(id); ) {
    seen.add(id)
    const parent = objectIndex.get(id)
    if (!parent) break
    ancestors.unshift(hostObject(parent))
    id = parent.parentId
  }
  return { object: hostObject(object), ancestors }
}

/**
 * Point the connection at the host's service. Run before the first render;
 * the connection store hydrates from storage first, so this wins over a
 * server remembered from an earlier visit.
 */
export async function configureForHost(): Promise<void> {
  if (!acsHost) return
  const serverUrl = await acsHost.serviceUrl()
  const apply = () => {
    const store = useConnectionStore.getState()
    store.setServerUrl(serverUrl)
    store.setServerAuth(null)
    store.setCredentials(null)
  }
  if (useConnectionStore.persist.hasHydrated()) apply()
  else await new Promise<void>(resolve => {
    const unsubscribe = useConnectionStore.persist.onFinishHydration(() => {
      unsubscribe()
      apply()
      resolve()
    })
  })
}

/** Connect to the host's service. */
export function startHosted(connect: () => Promise<void>): void {
  if (!acsHost) return
  void connect()
  // ⌘K pressed anywhere in the Manager UI opens this app's search.
  acsHost.onSearchRequest?.(() => {
    window.focus()
    useSearchDialog.getState().openSearch('')
  })
  // Esc that nothing in the app used goes to the console, which toggles its
  // full screen. Whether a dialog or menu was open is noted before the app
  // handles the key (capture phase), as closing one removes it at once.
  // The app's overlays (search, dialogs, menus, an expanded card) all sit on
  // a full-window fixed layer; Esc in a text box is the box's to use too.
  let appOwnsEscape = false
  const OVERLAY = '[role="dialog"], [role="menu"], [role="listbox"], .fixed.inset-0'
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    const active = document.activeElement
    const typing = active instanceof HTMLElement &&
      (active.matches('input, textarea, select') || active.isContentEditable)
    appOwnsEscape = typing || !!document.querySelector(OVERLAY)
  }, true)
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || appOwnsEscape) return
    acsHost?.escape?.()
  })
}

/**
 * The host's actions on an object, asked again whenever the object or what the
 * catalog knows of its ancestors changes. Empty without a host, while the host
 * is answering, and when the host fails to answer.
 */
export function useHostActions(
  object: ObjectInstance,
  host: Pick<AcsExplorerHost, 'actions'> | null = acsHost
): { actions: HostAction[]; selection: HostSelection | null } {
  const objectIndex = useExplorerStore(state => state.objectIndex)
  const selection = hostSelection({ type: 'object', id: object.elementId, data: object }, objectIndex)
  // The catalog fills in after connect, so the same object can gain ancestors.
  const key = selection ? JSON.stringify(selection) : null
  const [answer, setAnswer] = useState<{ key: string | null; actions: HostAction[] }>({ key: null, actions: [] })

  useEffect(() => {
    if (!host || !selection) return
    let current = true
    host.actions(selection).then(
      actions => { if (current) setAnswer({ key, actions: Array.isArray(actions) ? actions : [] }) },
      err => {
        console.error('The host could not say what actions this object has:', err)
        if (current) setAnswer({ key, actions: [] })
      }
    )
    return () => { current = false }
    // The key stands for the selection: a new object each render, the same content.
  }, [host, key])

  return { actions: answer.key === key ? answer.actions : [], selection }
}
