/*
 * ACS Admin
 * A metric's engineering unit, from its i3X object metadata
 * Copyright 2026 University of Sheffield
 *
 * i3X 1.0 reports a unit as `metadata.engUnit`, a UNECE Recommendation 20
 * code such as "KWH". ACS's server also gives `metadata.system.Eng_Unit`, the
 * string the metric is configured with ("kWh"), which is what people know the
 * unit by, so that is what the Explorer shows, with the code in the tooltip.
 * A server that sends only the code gets the code shown.
 *
 * The catalog and the related-object batches are listed without metadata, so
 * rows that show many metrics look their units up here: every lookup made in
 * the same tick goes to the server as one `POST /objects/list`, and each
 * answer is cached per element (see `useEngUnit`).
 */

import { useQuery } from '@tanstack/react-query'
import { getClient } from '../api/client'
import type { ObjectInstance } from '../api/types'
import { isCatalogSkeleton } from '../data/catalogInstaller'
import { requireClient } from '../data/queries'
import { queryClient, serverScope } from '../data/queryClient'
import { useExplorerStore } from '../stores/explorer'

export interface EngUnit {
  /** What the Explorer shows: the configured string, else the UNECE code. */
  symbol: string
  /** The UNECE Recommendation 20 code, when the server gives one. */
  code?: string
}

/** How long a unit is used before it is read again; a catalog refresh reads them sooner. */
export const ENG_UNIT_STALE_MS = 5 * 60_000

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** The unit in an object's metadata; null when it has none. */
export function engUnitOf(metadata: Record<string, unknown> | undefined): EngUnit | null {
  if (!metadata) return null
  const code = text(metadata.engUnit)
  const system = metadata.system
  const configured =
    system && typeof system === 'object' ? text((system as Record<string, unknown>).Eng_Unit) : undefined
  const symbol = configured ?? code
  if (!symbol) return null
  return code ? { symbol, code } : { symbol }
}

/** The tooltip for a unit. */
export function engUnitTitle(unit: EngUnit): string {
  if (!unit.code) return `${unit.symbol}: no UNECE code (not in the engineering unit vocabulary)`
  if (unit.code === unit.symbol) return `UNECE code ${unit.code}`
  return `${unit.symbol}: UNECE code ${unit.code}`
}

/** Whether an object already carries its metadata, so its unit needs no lookup. */
function hasMetadata(object: ObjectInstance | undefined): object is ObjectInstance {
  return object !== undefined && object.metadata !== undefined && !isCatalogSkeleton(object)
}

type FetchObjects = (elementIds: string[]) => Promise<{ objects: ObjectInstance[] }>

interface Waiter {
  resolve: (unit: EngUnit | null) => void
  reject: (error: unknown) => void
}

/**
 * A unit lookup that batches: the ids asked for in one tick are fetched
 * together. An id the server does not answer for has no unit.
 */
export function createEngUnitLoader(fetchObjects: FetchObjects) {
  let queued = new Map<string, Waiter[]>()
  let scheduled = false

  const flush = async () => {
    const batch = queued
    queued = new Map()
    scheduled = false
    try {
      const { objects } = await fetchObjects([...batch.keys()])
      const units = new Map(objects.map(object => [object.elementId, engUnitOf(object.metadata)]))
      for (const [elementId, waiters] of batch) {
        for (const waiter of waiters) waiter.resolve(units.get(elementId) ?? null)
      }
    } catch (error) {
      for (const waiters of batch.values()) {
        for (const waiter of waiters) waiter.reject(error)
      }
    }
  }

  return (elementId: string): Promise<EngUnit | null> =>
    new Promise((resolve, reject) => {
      const waiters = queued.get(elementId)
      if (waiters) waiters.push({ resolve, reject })
      else queued.set(elementId, [{ resolve, reject }])
      if (!scheduled) {
        scheduled = true
        setTimeout(() => void flush(), 0)
      }
    })
}

const loadEngUnit = createEngUnitLoader(elementIds => requireClient().getObjectDetails(elementIds))

/**
 * The unit of an element, or null while it loads, when it has none, or when
 * `enabled` is false. An object held with its metadata answers at once. The
 * shared query client is named, so the subscriptions panel needs no provider.
 */
export function useEngUnit(elementId: string, enabled = true): EngUnit | null {
  const client = getClient()
  const held = useExplorerStore(state => state.objectIndex.get(elementId))
  const known = hasMetadata(held)
  const query = useQuery<EngUnit | null>({
    queryKey: ['engUnit', ...serverScope(), elementId],
    queryFn: () => loadEngUnit(elementId),
    enabled: enabled && !known && client !== null,
    staleTime: ENG_UNIT_STALE_MS,
  }, queryClient)
  if (!enabled) return null
  return known ? engUnitOf(held.metadata) : query.data ?? null
}
