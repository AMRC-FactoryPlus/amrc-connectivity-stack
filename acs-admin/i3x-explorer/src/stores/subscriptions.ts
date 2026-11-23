import { create } from 'zustand'
import { diffValues, toFiniteNumber, type ValueChange } from '../api/structuredValue'
import { useExplorerStore } from './explorer' // ACS
import { TrendBuffer, type TrendPoint, type TrendSeries } from '../acs/trendBuffer' // ACS
import { holdDecimals } from '../acs/heldDecimals' // ACS
import { sameJson } from './sameJson' // ACS

export type { TrendPoint, TrendSeries } // ACS

export interface LiveValue {
  elementId: string
  displayName: string
  value: unknown
  timestamp: string | null
  quality: string | null
  /** When the latest update arrived (ms since epoch), whether or not the value changed. */
  receivedAt: number
  /** When the value last differed from the one before it; the first update counts as a change. */
  changedAt: number
  /** Updates received for this element. */
  updateCount: number
  /** What differed at the last change, each with its previous value; empty on the first update. */
  changes: ValueChange[]
  /**
   * Consecutive deliveries that repeated the previous reading exactly: same value, quality, and
   * source timestamp. A server re-sending one reading is alive but has no new data.
   */
  repeatCount: number
  /** When the latest delivery that was not a repeat arrived (ms since epoch). */
  freshAt: number
  /** ACS: the most decimal places a numeric value has shown, so it keeps its width (src/acs/heldDecimals.ts). */
  decimals?: number
}

export type LiveValueUpdate = Omit<
  LiveValue,
  'receivedAt' | 'changedAt' | 'updateCount' | 'changes' | 'repeatCount' | 'freshAt' | 'decimals'
>

// ACS: a trend keeps every reading since subscribing, up to an hour or 50,000 readings, in a
// compact buffer (src/acs/trendBuffer.ts), instead of the last 60 as an array of objects.

/** ACS: an element's trend readings, oldest first, or undefined when it has none. */
export function trendPointsOf(state: Pick<SubscriptionsState, 'trendData'>, elementId: string): TrendPoint[] | undefined {
  return state.trendData.get(elementId)?.buffer.toArray()
}

export interface Subscription {
  id: string
  createdAt: string
  monitoredItems: string[] // elementIds
  isStreaming: boolean
  /** The maxDepth each monitored item was registered with; absent means 1. */
  monitoredDepth?: Record<string, number>
  /** The composition components the server collects under each monitored item. */
  components?: Record<string, string[]>
  /** Items unregistered on the server but kept in the list, with their last value, to start again. */
  stoppedItems?: string[]
  /** ACS: each item's path when it was subscribed, shown until the catalog holds the item. */
  names?: Record<string, string>
}

/** Registration depth for a monitored item: 0 is the whole composition tree, 1 the item alone. */
export function monitoredDepthOf(sub: Subscription, elementId: string): number {
  return sub.monitoredDepth?.[elementId] ?? 1
}

/** Every element a subscription lists: its items and their components, stopped or not. */
export function listedElementIds(sub: Subscription): string[] {
  return sub.monitoredItems.flatMap(id => [id, ...(sub.components?.[id] ?? [])])
}

/** The elements the server is collecting for a subscription: its running items and their components. */
export function collectedElementIds(sub: Subscription): string[] {
  return sub.monitoredItems
    .filter(id => !sub.stoppedItems?.includes(id))
    .flatMap(id => [id, ...(sub.components?.[id] ?? [])])
}

/** True while a running transport delivers this element. */
export function isLiveFeed(subscriptions: ReadonlyMap<string, Subscription>, elementId: string): boolean {
  for (const sub of subscriptions.values()) {
    if (sub.isStreaming && collectedElementIds(sub).includes(elementId)) return true
  }
  return false
}

/**
 * The deliveries a subscription's transport may record: none once the subscription is gone or
 * stopped, and only for elements it still collects. A delivery already in flight when an item was
 * stopped or deleted is dropped rather than bringing its value back.
 */
export function admittedDeliveries<T extends { elementId: string }>(sub: Subscription | undefined, items: T[]): T[] {
  if (!sub?.isStreaming) return []
  const collected = new Set(collectedElementIds(sub))
  return items.filter(item => collected.has(item.elementId))
}

/** One subscription's delivery, as a transport received it. */
export interface Delivery {
  subscriptionId: string
  items: Array<{ elementId: string; value: unknown; quality: string | null; timestamp: string | null }>
}

/**
 * ACS: records buffered deliveries in one store write. Admission is checked now, at flush time, so
 * an update buffered just before its item was stopped or deleted is still dropped.
 */
export function applyDeliveries(deliveries: Delivery[]): void {
  const { subscriptions, updateLiveValues } = useSubscriptionsStore.getState()
  const { objectIndex } = useExplorerStore.getState()
  const values: LiveValueUpdate[] = []
  // ACS: one update delivered twice in a batch, as when a component is registered both through its
  // composition and on its own, is recorded once. Matched by element, source time and value; a
  // reading without a source time can't be told from a new one, so it is kept.
  const seen = new Map<string, unknown[]>()
  for (const { subscriptionId, items } of deliveries) {
    for (const item of admittedDeliveries(subscriptions.get(subscriptionId), items)) {
      if (item.timestamp) {
        const key = `${item.elementId}\u0000${item.timestamp}`
        const earlier = seen.get(key)
        if (earlier?.some(value => sameJson(value, item.value))) continue
        if (earlier) earlier.push(item.value)
        else seen.set(key, [item.value])
      }
      values.push({
        elementId: item.elementId,
        // The element's own name once the catalog holds it, not its id.
        displayName: objectIndex.get(item.elementId)?.displayName || item.elementId,
        value: item.value,
        timestamp: item.timestamp,
        quality: item.quality,
      })
    }
  }
  updateLiveValues(values)
}

/** Items grouped by registration depth, for one register call per depth. */
export function groupByDepth(sub: Pick<Subscription, 'monitoredDepth'>, elementIds: string[]): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const elementId of elementIds) {
    const depth = sub.monitoredDepth?.[elementId] ?? 1
    const group = groups.get(depth)
    if (group) group.push(elementId)
    else groups.set(depth, [elementId])
  }
  return groups
}

/** A source timestamp in ms, or undefined when absent or unparseable. */
function sourceTimeMs(timestamp: string | null | undefined): number | undefined {
  const ms = timestamp ? Date.parse(timestamp) : NaN
  return Number.isNaN(ms) ? undefined : ms
}

/** True when both readings carry a source time and `next` was taken before `current`. */
export function isOlderReading(
  next: string | null | undefined,
  current: string | null | undefined
): boolean {
  const a = sourceTimeMs(next)
  const b = sourceTimeMs(current)
  return a !== undefined && b !== undefined && a < b
}

/**
 * Whether a live reading should replace one read over HTTP: by source time when both have one,
 * otherwise by which arrived last.
 */
export function liveSupersedes(
  live: Pick<LiveValue, 'timestamp' | 'receivedAt'>,
  fetched: { timestamp?: string | null } | undefined,
  fetchedAt: number
): boolean {
  if (!fetched) return true
  const liveMs = sourceTimeMs(live.timestamp)
  const fetchedMs = sourceTimeMs(fetched.timestamp)
  if (liveMs !== undefined && fetchedMs !== undefined) return liveMs >= fetchedMs
  return live.receivedAt > fetchedAt
}

/** Live values and trends without the given elements, except those a subscription still lists. */
function withoutUnlisted(
  subscriptions: ReadonlyMap<string, Subscription>,
  candidates: string[],
  liveValues: Map<string, LiveValue>,
  trendData: Map<string, TrendSeries>
): { liveValues: Map<string, LiveValue>; trendData: Map<string, TrendSeries> } {
  const listed = new Set(Array.from(subscriptions.values()).flatMap(listedElementIds))
  const dropped = candidates.filter(id => !listed.has(id) && (liveValues.has(id) || trendData.has(id)))
  if (dropped.length === 0) return { liveValues, trendData }
  const nextValues = new Map(liveValues)
  const nextTrend = new Map(trendData)
  for (const id of dropped) {
    nextValues.delete(id)
    nextTrend.delete(id)
  }
  return { liveValues: nextValues, trendData: nextTrend }
}

interface SubscriptionsState {
  subscriptions: Map<string, Subscription>
  liveValues: Map<string, LiveValue>
  trendData: Map<string, TrendSeries> // keyed by elementId; ACS: a buffer, not an array
  activeSubscriptionId: string | null
  // Subscriptions are global, not scoped to the selected element, so they live in
  // a drawer above the status bar rather than in the element's tabs.
  isSubscriptionsOpen: boolean

  addSubscription: (sub: Subscription) => void
  /** Drops the subscription and, unless `keepValues`, the values no other subscription lists. */
  removeSubscription: (id: string, options?: { keepValues?: boolean }) => void
  setActiveSubscription: (id: string | null) => void
  addMonitoredItem: (
    subscriptionId: string,
    elementId: string,
    options?: { maxDepth?: number; components?: string[]; name?: string }
  ) => void
  removeMonitoredItem: (subscriptionId: string, elementId: string) => void
  setItemStopped: (subscriptionId: string, elementId: string, stopped: boolean) => void
  updateLiveValue: (value: LiveValueUpdate) => void
  /** Applies a delivered batch in one store write. */
  updateLiveValues: (values: LiveValueUpdate[]) => void
  setStreaming: (subscriptionId: string, streaming: boolean) => void
  setSubscriptionsOpen: (open: boolean) => void
  clearAll: () => void
}

export const useSubscriptionsStore = create<SubscriptionsState>((set, get) => ({
  subscriptions: new Map(),
  liveValues: new Map(),
  trendData: new Map(),
  activeSubscriptionId: null,
  isSubscriptionsOpen: false,

  addSubscription: (sub) => {
    const { subscriptions } = get()
    const updated = new Map(subscriptions)
    updated.set(sub.id, sub)
    set({ subscriptions: updated, activeSubscriptionId: sub.id })
  },

  removeSubscription: (id, options) => {
    const { subscriptions, activeSubscriptionId, liveValues, trendData } = get()
    const removed = subscriptions.get(id)
    const updated = new Map(subscriptions)
    updated.delete(id)
    set({
      subscriptions: updated,
      activeSubscriptionId: activeSubscriptionId === id ? null : activeSubscriptionId,
      ...(removed && !options?.keepValues
        ? withoutUnlisted(updated, listedElementIds(removed), liveValues, trendData)
        : {}),
    })
  },

  setActiveSubscription: (id) => set({ activeSubscriptionId: id }),

  addMonitoredItem: (subscriptionId, elementId, options) => {
    const { subscriptions } = get()
    const sub = subscriptions.get(subscriptionId)
    if (!sub) return
    const updated = new Map(subscriptions)
    updated.set(subscriptionId, {
      ...sub,
      monitoredItems: sub.monitoredItems.includes(elementId)
        ? sub.monitoredItems
        : [...sub.monitoredItems, elementId],
      monitoredDepth: { ...sub.monitoredDepth, [elementId]: options?.maxDepth ?? 1 },
      components: options?.components?.length
        ? { ...sub.components, [elementId]: options.components }
        : sub.components,
      stoppedItems: sub.stoppedItems?.filter(id => id !== elementId),
      names: options?.name ? { ...sub.names, [elementId]: options.name } : sub.names,
    })
    set({ subscriptions: updated })
  },

  removeMonitoredItem: (subscriptionId, elementId) => {
    const { subscriptions, liveValues, trendData } = get()
    const sub = subscriptions.get(subscriptionId)
    if (!sub) return
    const { [elementId]: _depth, ...monitoredDepth } = sub.monitoredDepth ?? {}
    const { [elementId]: removedComponents = [], ...components } = sub.components ?? {}
    const { [elementId]: _name, ...names } = sub.names ?? {}
    const updatedSubs = new Map(subscriptions)
    updatedSubs.set(subscriptionId, {
      ...sub,
      monitoredItems: sub.monitoredItems.filter(id => id !== elementId),
      monitoredDepth,
      components,
      stoppedItems: sub.stoppedItems?.filter(id => id !== elementId),
      names,
    })
    set({
      subscriptions: updatedSubs,
      ...withoutUnlisted(updatedSubs, [elementId, ...removedComponents], liveValues, trendData),
    })
  },

  setItemStopped: (subscriptionId, elementId, stopped) => {
    const { subscriptions } = get()
    const sub = subscriptions.get(subscriptionId)
    if (!sub || !sub.monitoredItems.includes(elementId)) return
    const others = (sub.stoppedItems ?? []).filter(id => id !== elementId)
    const updated = new Map(subscriptions)
    updated.set(subscriptionId, { ...sub, stoppedItems: stopped ? [...others, elementId] : others })
    set({ subscriptions: updated })
  },

  updateLiveValue: (value) => get().updateLiveValues([value]),

  updateLiveValues: (values) => {
    if (values.length === 0) return
    const { liveValues, trendData } = get()
    const updatedLive = new Map(liveValues)
    // ACS: readings are appended to each element's buffer in place, and the store holds a new
    // series per element touched, once per batch, so only that element's graphs re-render.
    const touched = new Map<string, TrendBuffer>()
    const now = Date.now()
    for (const value of values) {
      const previous = updatedLive.get(value.elementId)
      // A delayed sample older than the shown reading counts as delivery activity, not a new value.
      if (previous && isOlderReading(value.timestamp, previous.timestamp)) {
        updatedLive.set(value.elementId, { ...previous, receivedAt: now, updateCount: previous.updateCount + 1 })
        continue
      }
      const changes = previous ? diffValues(previous.value, value.value) : []
      const changed = !previous || changes.length > 0
      const repeat =
        !changed &&
        previous.quality === value.quality &&
        previous.timestamp === value.timestamp
      updatedLive.set(value.elementId, {
        ...value,
        receivedAt: now,
        changedAt: changed ? now : previous.changedAt,
        updateCount: (previous?.updateCount ?? 0) + 1,
        changes: changed ? changes : previous.changes,
        repeatCount: repeat ? previous.repeatCount + 1 : 0,
        freshAt: repeat ? previous.freshAt : now,
        decimals: holdDecimals(previous?.decimals, value.value), // ACS
      })

      // A repeat is the same reading again, not a new point in time.
      const numericValue = toFiniteNumber(value.value)
      if (!repeat && numericValue !== undefined) {
        let buffer = touched.get(value.elementId)
        if (!buffer) {
          buffer = trendData.get(value.elementId)?.buffer ?? new TrendBuffer()
          touched.set(value.elementId, buffer)
        }
        // ACS: plot a reading at its source time; updates delivered together would otherwise share
        // one arrival time and stack up at one x position.
        buffer.push(sourceTimeMs(value.timestamp) ?? now, numericValue, now)
      }
    }
    if (touched.size === 0) {
      set({ liveValues: updatedLive })
      return
    }
    const updatedTrend = new Map(trendData)
    for (const [elementId, buffer] of touched) {
      updatedTrend.set(elementId, { buffer, revision: buffer.revision })
    }
    set({ liveValues: updatedLive, trendData: updatedTrend })
  },

  setStreaming: (subscriptionId, streaming) => {
    const { subscriptions } = get()
    const sub = subscriptions.get(subscriptionId)
    if (sub) {
      const updated = new Map(subscriptions)
      updated.set(subscriptionId, { ...sub, isStreaming: streaming })
      set({ subscriptions: updated })
    }
  },

  setSubscriptionsOpen: (open) => set({ isSubscriptionsOpen: open }),

  clearAll: () => set({
    subscriptions: new Map(),
    liveValues: new Map(),
    trendData: new Map(),
    activeSubscriptionId: null
  })
}))
