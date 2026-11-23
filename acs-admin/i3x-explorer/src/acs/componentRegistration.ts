/*
 * ACS Admin
 * Registers a composition's components one by one, as well as the composition itself
 * Copyright 2026 University of Sheffield
 *
 * The app subscribes to a composition (a device, say) by registering it with maxDepth 0, and the
 * i3X 1.0 Implementation Guide (cesmii/i3X branch 1.0, spec/IMPLEMENTATION_GUIDE.md, Subscribe
 * Methods, "POST /subscriptions/register" and the maxDepth semantics it refers to) has the server
 * then collect changes to its components too. Some servers in use deliver an update only to the
 * exact elementId registered, so a composition subscribed that way receives nothing while its
 * metrics change. So each component is registered on the same subscription too, with maxDepth 1,
 * using only the standard register call. The guide says a server "MUST return success and ignore
 * the subsequent registration" of an object registered more than once, so this is safe on a
 * server that already delivers the components. Deliveries are matched by elementId, so a component
 * delivered by both registrations is the same element, and the store records a repeated delivery
 * once (`applyDeliveries`).
 *
 * The composition's own registration is kept. Stopping or deleting it unregisters only the
 * components it added that nothing else still needs: not an item the user subscribed to on its
 * own, and not a component of another running composition.
 */

import type { I3XClient } from '../api/client'
import type { BulkOutcome } from '../api/normalize'
import type { Subscription } from '../stores/subscriptions'

/** Element ids per register or unregister request. */
export const COMPONENT_CHUNK = 500

type RegisterClient = Pick<I3XClient, 'registerMonitoredItems'>
type UnregisterClient = Pick<I3XClient, 'unregisterMonitoredItems'>

async function inChunks(
  elementIds: readonly string[],
  call: (chunk: string[]) => Promise<BulkOutcome>
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { accepted: [], rejected: [] }
  for (let i = 0; i < elementIds.length; i += COMPONENT_CHUNK) {
    const result = await call(elementIds.slice(i, i + COMPONENT_CHUNK))
    outcome.accepted.push(...result.accepted)
    outcome.rejected.push(...result.rejected)
  }
  return outcome
}

/**
 * Registers a composition's components individually, with maxDepth 1, in chunks. Best effort: a
 * server that delivers components through the composition's own registration doesn't need these,
 * so a refusal is logged rather than undoing the subscription.
 */
export async function registerComponents(
  client: RegisterClient,
  subscriptionId: string,
  componentIds: readonly string[]
): Promise<BulkOutcome> {
  if (componentIds.length === 0) return { accepted: [], rejected: [] }
  try {
    const outcome = await inChunks(componentIds, chunk => client.registerMonitoredItems(subscriptionId, chunk, 1))
    if (outcome.rejected.length > 0) {
      console.warn(`Subscription ${subscriptionId} did not accept ${outcome.rejected.length} component(s) registered on their own`)
    }
    return outcome
  } catch (err) {
    console.warn(`Could not register components on subscription ${subscriptionId} on their own:`, err)
    return { accepted: [], rejected: componentIds.map(elementId => ({ elementId, message: String(err) })) }
  }
}

/** Unregisters components a composition added, in chunks. Best effort, as registering them was. */
export async function unregisterComponents(
  client: UnregisterClient,
  subscriptionId: string,
  componentIds: readonly string[]
): Promise<void> {
  if (componentIds.length === 0) return
  try {
    await inChunks(componentIds, chunk => client.unregisterMonitoredItems(subscriptionId, chunk, 1))
  } catch (err) {
    console.warn(`Could not unregister components on subscription ${subscriptionId}:`, err)
  }
}

/** The elements registered on their own account or for a composition, leaving `exceptRoot` out. */
function stillNeeded(sub: Subscription, exceptRoot: string): Set<string> {
  const needed = new Set<string>()
  for (const id of sub.monitoredItems) {
    if (id === exceptRoot || sub.stoppedItems?.includes(id)) continue
    needed.add(id)
    for (const component of sub.components?.[id] ?? []) needed.add(component)
  }
  return needed
}

/** The components `rootId` registered that nothing else in the subscription still needs. */
export function componentsToRelease(sub: Subscription, rootId: string): string[] {
  const needed = stillNeeded(sub, rootId)
  return (sub.components?.[rootId] ?? []).filter(id => id !== rootId && !needed.has(id))
}

/** True while a running composition other than the item itself registered `elementId` as its component. */
export function neededByComposition(sub: Subscription, elementId: string): boolean {
  return sub.monitoredItems.some(
    root => root !== elementId && !sub.stoppedItems?.includes(root) && (sub.components?.[root] ?? []).includes(elementId)
  )
}

/** Every component of the running compositions in a subscription, once each. */
export function runningComponents(
  sub: Pick<Subscription, 'monitoredItems' | 'components' | 'stoppedItems'>
): string[] {
  const ids = new Set<string>()
  for (const root of sub.monitoredItems) {
    if (sub.stoppedItems?.includes(root)) continue
    for (const component of sub.components?.[root] ?? []) if (component !== root) ids.add(component)
  }
  return [...ids]
}
