/*
 * ACS: subscribing to an ISA-95 level. See FORK.md.
 *
 * i3X 1.0 `maxDepth` recurses through HasComponent only, never through
 * HasChildren, and an ISA-95 level is organisational: it has no value of its
 * own and its devices are not its components. A registration on a level
 * therefore delivers nothing at any depth, and its row would wait forever. So
 * the Explorer subscribes to the devices under the level instead, each at its
 * whole-tree depth, the same as subscribing to each device by hand. A metric
 * that sits directly in a level or folder, outside any device, is subscribed on
 * its own.
 */

import type { ObjectInstance } from '../api/types'
import { isContainer, valueChildren, type ChildSource } from '../data/childValues'

/** Above this many devices, subscribing to a level asks first. */
export const LEVEL_CONFIRM_DEVICES = 25

/** The type id the ACS i3X service gives every ISA-95 level. */
export const ISA95_LEVEL_TYPE = 'isa95-level'

/**
 * Whether subscribing to the object means subscribing to the devices under it:
 * true for an ISA-95 level, known by its type even when it is empty, and for
 * any other object that is not a composition but that the Explorer knows has
 * children. A metric has no children, so it is false.
 */
export function isLevel(
  object: Pick<ObjectInstance, 'elementId' | 'isComposition'> & { typeId?: string },
  source: ChildSource
): boolean {
  if (object.isComposition) return false
  const typeId = object.typeId ?? source.objectIndex.get(object.elementId)?.typeId
  if (typeId === ISA95_LEVEL_TYPE) return true
  return isContainer(object as ObjectInstance, source)
}

/**
 * What to subscribe to for a level: the first composition (device) on each
 * branch going down, and any metric found outside a device. Found from the
 * hierarchy the Explorer holds (the catalog's parentId children and any
 * HasChildren or HasComponent edges it has read). The walk does not go into a
 * composition, because subscribing to it already covers its components, and an
 * empty level adds nothing. Tree order, each object once.
 */
export function targetsUnder(rootId: string, source: ChildSource): ObjectInstance[] {
  const targets: ObjectInstance[] = []
  const seen = new Set<string>([rootId])
  const walk = (parentId: string) => {
    const children = valueChildren(
      parentId,
      source.childrenByParent.get(parentId) ?? [],
      source.relatedObjects.get(parentId) ?? [],
      source.objectIndex,
    )
    for (const child of children) {
      if (seen.has(child.elementId)) continue
      seen.add(child.elementId)
      if (child.isComposition) targets.push(child)
      else if (isLevel(child, source)) walk(child.elementId)
      else targets.push(child)
    }
  }
  walk(rootId)
  return targets
}

/** How the targets are counted in messages: "3 devices", or "3 items" when some are loose metrics. */
export function countLabel(targets: readonly Pick<ObjectInstance, 'isComposition'>[]): string {
  const noun = targets.every(t => t.isComposition) ? 'device' : 'item'
  return `${targets.length} ${noun}${targets.length === 1 ? '' : 's'}`
}

/** The question asked before subscribing to many at once. */
export function confirmMessage(levelName: string, targets: readonly Pick<ObjectInstance, 'isComposition'>[]): string {
  return `${levelName} has ${countLabel(targets)} under it. Subscribing to it subscribes to every one of them, ` +
    'which can be a lot of live data. Subscribe to all of them?'
}
