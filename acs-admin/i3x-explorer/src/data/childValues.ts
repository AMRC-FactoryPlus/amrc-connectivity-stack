/*
 * ACS: the children of a container object and their current values, for the
 * Current Value panel. See FORK.md.
 *
 * i3X 1.0 reads values through `POST /objects/value`, where `maxDepth` recurses
 * through HasComponent only (1 = this element alone, N = N levels, 0 = all).
 * HasChildren is organisational: an ISA-95 level's children are independent
 * objects and never come back in its value, at any depth. So the panel does not
 * lean on `maxDepth` for either kind. It lists the children from the hierarchy
 * the Explorer already holds (the catalog's parentId children, and the
 * HasChildren and HasComponent edges of `POST /objects/related`), then reads
 * every child's own value in one standard batched request at `maxDepth: 1`.
 * Expanding a child does the same one level further down.
 */

import { useQuery } from '@tanstack/react-query'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { useExplorerStore } from '../stores/explorer'
import { requireClient } from './queries'
import { serverScope } from './queryClient'
import { getClient } from '../api/client'
import { useMemo } from 'react'

/** The relationships whose targets are part of an object's value tree. */
export const VALUE_CHILD_RELATIONSHIPS: ReadonlySet<string> = new Set(['HasChildren', 'HasComponent'])

/** How many child values one `/objects/value` request asks for. */
export const VALUE_BATCH_SIZE = 200

/** The store slices the child listing reads. */
export interface ChildSource {
  childrenByParent: Map<string, ObjectInstance[]>
  relatedObjects: Map<string, ObjectInstance[]>
  objectIndex: Map<string, ObjectInstance>
}

/**
 * The children of `parentId`, catalog order first, then any child the related
 * edges add that the catalog does not place under it. `related` is the parent's
 * `/objects/related` answer; only its HasChildren and HasComponent edges count.
 */
export function valueChildren(
  parentId: string,
  catalogChildren: readonly ObjectInstance[],
  related: readonly ObjectInstance[],
  objectIndex: Map<string, ObjectInstance>
): ObjectInstance[] {
  const byId = new Map<string, ObjectInstance>()
  for (const child of catalogChildren) {
    if (child.elementId !== parentId) byId.set(child.elementId, child)
  }
  const extra: ObjectInstance[] = []
  for (const target of related) {
    if (target.elementId === parentId || byId.has(target.elementId)) continue
    if (!target.sourceRelationship || !VALUE_CHILD_RELATIONSHIPS.has(target.sourceRelationship)) continue
    const object = objectIndex.get(target.elementId) ?? target
    byId.set(object.elementId, object)
    extra.push(object)
  }
  extra.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return [...catalogChildren.filter(c => c.elementId !== parentId), ...extra]
}

/**
 * Whether an object is a container: its value is its children's, so the
 * Current Value panel lists them and there is no History tab. True for a
 * composition, and for anything the Explorer already knows has children.
 */
export function isContainer(object: ObjectInstance, source: ChildSource): boolean {
  if (object.isComposition) return true
  if ((source.childrenByParent.get(object.elementId)?.length ?? 0) > 0) return true
  const related = source.relatedObjects.get(object.elementId)
  return !!related?.some(target =>
    target.elementId !== object.elementId &&
    !!target.sourceRelationship &&
    VALUE_CHILD_RELATIONSHIPS.has(target.sourceRelationship))
}

/** Whether the selected object is a container, from the store. */
export function useIsContainer(object: ObjectInstance): boolean {
  const childrenByParent = useExplorerStore(s => s.childrenByParent)
  const related = useExplorerStore(s => s.relatedObjects.get(object.elementId))
  return useMemo(
    () => isContainer(object, {
      childrenByParent,
      relatedObjects: related ? new Map([[object.elementId, related]]) : new Map(),
      objectIndex: new Map(),
    }),
    [object, childrenByParent, related]
  )
}

/**
 * Read the values of these elements at `maxDepth: 1`, in batches. An element the
 * server did not answer for is left out of the map.
 */
export async function readChildValues(
  client: { getValues(elementIds: string[], maxDepth?: number): Promise<LastKnownValue[]> },
  elementIds: readonly string[],
  batchSize = VALUE_BATCH_SIZE
): Promise<Map<string, LastKnownValue>> {
  const values = new Map<string, LastKnownValue>()
  for (let i = 0; i < elementIds.length; i += batchSize) {
    const batch = elementIds.slice(i, i + batchSize)
    for (const value of await client.getValues(batch, 1)) values.set(value.elementId, value)
  }
  return values
}

/**
 * The children of `parentId`. The tree has usually resolved the parent's
 * related objects already; when it has not, they are asked for here. Without
 * them the catalog children are still shown.
 */
export function useValueChildren(parentId: string) {
  const catalogChildren = useExplorerStore(s => s.childrenByParent.get(parentId))
  const cachedRelated = useExplorerStore(s => s.relatedObjects.get(parentId))
  const objectIndex = useExplorerStore(s => s.objectIndex)
  const client = getClient()

  const relatedQuery = useQuery<ObjectInstance[]>({
    queryKey: ['valueChildrenRelated', ...serverScope(), parentId],
    queryFn: async () => {
      const { related } = await requireClient().getRelatedObjectsBatch([parentId])
      return related.get(parentId) ?? []
    },
    enabled: client !== null && cachedRelated === undefined,
  })

  const related = cachedRelated ?? relatedQuery.data
  const children = useMemo(
    () => valueChildren(parentId, catalogChildren ?? [], related ?? [], objectIndex),
    [parentId, catalogChildren, related, objectIndex]
  )
  return {
    children,
    /** Still waiting for the related objects, with nothing from the catalog to show. */
    isLoading: related === undefined && relatedQuery.isFetching && children.length === 0,
  }
}

/** The current values of these children, one batched read. */
export function useChildValues(parentId: string, elementIds: readonly string[]) {
  const client = getClient()
  return useQuery<Map<string, LastKnownValue>>({
    queryKey: ['childValues', ...serverScope(), parentId, elementIds.join('\n')],
    queryFn: () => readChildValues(requireClient(), elementIds),
    enabled: client !== null && elementIds.length > 0,
  })
}
