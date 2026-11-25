// ACS: subscribing to an element, shared by the detail view's header and the
// per-row Subscribe buttons, so both behave the same. Upstream had this inline
// in ObjectDetailView's handleSubscribe; it moved here unchanged apart from
// running one subscribe at a time, so quick clicks on several rows add to one
// subscription instead of each creating its own. Subscribing to an ISA-95 level
// subscribes to the devices under it (levelSubscribe.ts).

import { useCallback } from 'react'
import { create } from 'zustand'
import { getClient } from '../api/client'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { useExplorerStore } from '../stores/explorer'
import { registerItem } from '../components/subscriptions/registerItem'
import { useOptionalSubscriptionTransport } from '../components/subscriptions/SubscriptionTransport'
import { objectPath } from '../components/main/navigation'
import { confirmMessage, countLabel, isLevel, LEVEL_CONFIRM_DEVICES, targetsUnder } from './levelSubscribe'
import { askLevelConfirm } from './levelConfirm'

type SubscribeTarget = Pick<ObjectInstance, 'elementId' | 'displayName' | 'isComposition'>

/** True when any subscription lists the element as one of its items. */
export function isElementSubscribed(
  state: { subscriptions: Map<string, { monitoredItems: string[] }> },
  elementId: string
): boolean {
  for (const sub of state.subscriptions.values()) {
    if (sub.monitoredItems.includes(elementId)) return true
  }
  return false
}

/**
 * Whether the element is subscribed. A boolean selector, so live values arriving
 * don't re-render the caller; it re-renders only when this answer changes.
 */
export function useIsSubscribed(elementId: string): boolean {
  return useSubscriptionsStore(state => isElementSubscribed(state, elementId))
}

interface SubscribeStatus {
  /** Elements with a subscribe queued or running. */
  pending: ReadonlySet<string>
  /** The last failure per element, until it is tried again or cleared. */
  errors: ReadonlyMap<string, string>
}

export const useSubscribeStatus = create<SubscribeStatus>(() => ({
  pending: new Set(),
  errors: new Map(),
}))

function setPending(elementId: string, on: boolean) {
  useSubscribeStatus.setState(state => {
    const pending = new Set(state.pending)
    if (on) pending.add(elementId)
    else pending.delete(elementId)
    return { pending }
  })
}

function setError(elementId: string, message: string | null) {
  useSubscribeStatus.setState(state => {
    if (message === null && !state.errors.has(elementId)) return state
    const errors = new Map(state.errors)
    if (message === null) errors.delete(elementId)
    else errors.set(elementId, message)
    return { errors }
  })
}

/** Forgets an element's last subscribe failure. */
export function clearSubscribeError(elementId: string) {
  setError(elementId, null)
}

// Subscribes run one after another. The first click on an Explorer with no
// subscription creates one; a second click made while that is in flight waits
// for it and then registers on the same subscription, and finds the stream
// already started.
let queue: Promise<unknown> = Promise.resolve()

export type StartStream = (subscriptionId: string) => Promise<void>

/**
 * Subscribes to an element: creates a subscription if none is active, registers
 * the element at its composition depth, starts the stream unless it is already
 * running, and opens the subscriptions drawer. A subscription created here is
 * deleted again if registering fails. Resolves true on success and false on
 * failure, with the failure kept in `useSubscribeStatus` for the element.
 *
 * `value` is the element's last read value when the caller has one. A
 * composition's component ids come from it; without one, registerItem reads the
 * value itself with a standard value request.
 */
export function subscribeElement(
  object: SubscribeTarget,
  value: LastKnownValue | null | undefined,
  startStream: StartStream | null
): Promise<boolean> {
  setPending(object.elementId, true)
  setError(object.elementId, null)
  const run = queue.then(() => subscribeNow(object, value, startStream))
  queue = run.catch(() => undefined)
  return run.then(
    () => true,
    err => {
      const message = err instanceof Error ? err.message : 'Subscribe failed'
      setError(object.elementId, message)
      console.error('Failed to subscribe:', err)
      return false
    },
  ).finally(() => setPending(object.elementId, false))
}

async function subscribeNow(
  object: SubscribeTarget,
  value: LastKnownValue | null | undefined,
  startStream: StartStream | null
): Promise<void> {
  if (!getClient()) throw new Error('Not connected to a server')
  if (!startStream) throw new Error('Subscriptions are not available here')

  // An ISA-95 level has no value and its devices are not its components, so a
  // registration on it would deliver nothing. Subscribe to its devices instead.
  const explorer = useExplorerStore.getState()
  if (isLevel(object, explorer)) {
    await subscribeLevel(object, targetsUnder(object.elementId, explorer), startStream)
    return
  }
  await subscribeOne(object, value, startStream)
}

/**
 * Subscribes to each device under a level (and any metric outside a device),
 * one after another, asking first when there are many. Those already subscribed
 * are left as they are. One that fails does not stop the rest; the failures are
 * reported together.
 */
async function subscribeLevel(
  level: SubscribeTarget,
  targets: ObjectInstance[],
  startStream: StartStream
): Promise<void> {
  if (targets.length === 0) {
    throw new Error(`${level.displayName} has no devices under it to subscribe to`)
  }
  if (targets.length > LEVEL_CONFIRM_DEVICES &&
      !await askLevelConfirm(`Subscribe to ${level.displayName}?`, confirmMessage(level.displayName, targets))) {
    return
  }

  const failed: string[] = []
  for (const target of targets) {
    try {
      await subscribeOne(target, null, startStream)
    } catch (err) {
      const name = objectPath(target.elementId, useExplorerStore.getState().objectIndex) ?? target.displayName
      failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failed.length > 0) {
    const total = countLabel(targets).replace(/^\d+ /, '')
    throw new Error(
      `Subscribed to ${targets.length - failed.length} of ${targets.length} ${total} under ${level.displayName}. ` +
      `Failed: ${failed.join('; ')}`
    )
  }
}

async function subscribeOne(
  object: SubscribeTarget,
  value: LastKnownValue | null | undefined,
  startStream: StartStream
): Promise<void> {
  const client = getClient()
  if (!client) throw new Error('Not connected to a server')

  // Already listed: nothing to register, show it.
  if (isElementSubscribed(useSubscriptionsStore.getState(), object.elementId)) {
    useSubscriptionsStore.getState().setSubscriptionsOpen(true)
    return
  }

  // Track any subscription we create so we can roll it back if register fails
  let newlyCreatedSubId: string | null = null

  try {
    let subscriptionId = useSubscriptionsStore.getState().activeSubscriptionId

    // Create subscription if none exists
    if (!subscriptionId) {
      const response = await client.createSubscription()
      subscriptionId = response.subscriptionId
      newlyCreatedSubId = subscriptionId

      useSubscriptionsStore.getState().addSubscription({
        id: subscriptionId,
        createdAt: new Date().toISOString(),
        monitoredItems: [],
        isStreaming: false
      })
    }

    // Register this object. If this throws, the catch block cleans up.
    // A composition object is monitored with its whole component tree, the same depth Current Value reads.
    const { maxDepth, components } = await registerItem(client, subscriptionId, object, value ?? null)
    // Remember the path, so the row is named even before the catalog holds the object.
    const name = objectPath(object.elementId, useExplorerStore.getState().objectIndex) ?? object.displayName
    useSubscriptionsStore.getState().addMonitoredItem(subscriptionId, object.elementId, { maxDepth, components, name })
    // Start the transport unless it's already live, without this the drawer
    // opens on "Waiting…" until Start Stream is clicked manually. Guarded
    // because startStream is not idempotent (it tears down and reopens the
    // transport); a live stream carries newly registered items as-is.
    const sub = useSubscriptionsStore.getState().subscriptions.get(subscriptionId)
    if (!sub?.isStreaming) {
      await startStream(subscriptionId)
    }
    // Reveal the global drawer so the new monitored item is visible immediately.
    useSubscriptionsStore.getState().setSubscriptionsOpen(true)
  } catch (err) {
    // Roll back any subscription we just created so it doesn't sit empty in
    // the UI. This assumes the failure came from create/register, if
    // startStream ever becomes throwing, revisit so a healthy subscription
    // isn't deleted over a transport hiccup.
    if (newlyCreatedSubId) {
      useSubscriptionsStore.getState().removeSubscription(newlyCreatedSubId)
      try { await client.deleteSubscription(newlyCreatedSubId) } catch { /* best-effort */ }
    }
    throw err
  }
}

/** Opens the subscriptions drawer, where a subscribed element's row is. */
export function showSubscriptions() {
  useSubscriptionsStore.getState().setSubscriptionsOpen(true)
}

export interface UseSubscribe {
  /** Subscribes to the element; resolves true on success. */
  subscribe: (object: SubscribeTarget, value?: LastKnownValue | null) => Promise<boolean>
  /** True while a subscribe for the element is queued or running. */
  subscribing: (elementId: string) => boolean
  /** The last subscribe failure for an element, or null. */
  error: (elementId: string) => string | null
}

/**
 * The subscribe action for a component. `subscribing` and `error` read the
 * shared status, so a row and the header agree about an element.
 */
export function useSubscribe(): UseSubscribe {
  const subscribe = useSubscribeAction()
  const status = useSubscribeStatus()
  return {
    subscribe,
    subscribing: elementId => status.pending.has(elementId),
    error: elementId => status.errors.get(elementId) ?? null,
  }
}

/**
 * The subscribe action alone, without the shared status, so a list of rows
 * doesn't re-render whenever any one of them subscribes.
 */
export function useSubscribeAction(): UseSubscribe['subscribe'] {
  const transport = useOptionalSubscriptionTransport()
  const startStream = transport?.startStream ?? null
  return useCallback(
    (object: SubscribeTarget, value?: LastKnownValue | null) => subscribeElement(object, value, startStream),
    [startStream],
  )
}

/** One element's subscribe state, re-rendering only when it changes. */
export function useElementSubscribeState(elementId: string): { pending: boolean; error: string | null } {
  const pending = useSubscribeStatus(state => state.pending.has(elementId))
  const error = useSubscribeStatus(state => state.errors.get(elementId) ?? null)
  return { pending, error }
}

/** For tests: forget queued work and status. */
export function resetSubscribeState() {
  queue = Promise.resolve()
  useSubscribeStatus.setState({ pending: new Set(), errors: new Map() })
}
