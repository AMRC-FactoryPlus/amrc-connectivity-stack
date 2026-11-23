/*
 * ACS Admin
 * How a subscriptions row names its element
 * Copyright 2026 University of Sheffield
 *
 * A monitored item shows its full path from the top of the hierarchy. A component listed under an
 * expanded composition shows its path below that composition, usually just its own name
 * ("Spindle speed", or "Axis X / Position" when nested), because the composition's row above it
 * already says where it is. The full path stays in the tooltip.
 */

import { PATH_SEPARATOR } from '../components/main/navigation'

export interface RowLabel {
  /** The leading segments, joined; the only part that may be trimmed, from its left. Empty for none. */
  lead: string
  /** The element's own name. Never trimmed. */
  leaf: string
  /** The element's full path, for the tooltip and the accessible name. */
  full: string
}

/**
 * The segments a row shows: the full path for a monitored item, or the part of a component's
 * path below its composition. When the component's path doesn't start with the composition's
 * (the catalog places it elsewhere, or a path is still loading), the full path is shown.
 */
export function relativeSegments(path: string[], rootPath: string[] | undefined): string[] {
  if (!rootPath || rootPath.length === 0 || path.length <= rootPath.length) return path
  for (let i = 0; i < rootPath.length; i++) {
    if (path[i] !== rootPath[i]) return path
  }
  return path.slice(rootPath.length)
}

/** Splits a row's segments into the trimmable lead and the leaf that always shows in full. */
export function rowLabel(path: string[], rootPath?: string[]): RowLabel {
  const shown = relativeSegments(path, rootPath)
  return {
    lead: shown.slice(0, -1).join(PATH_SEPARATOR),
    leaf: shown[shown.length - 1] ?? '',
    full: path.join(PATH_SEPARATOR),
  }
}
