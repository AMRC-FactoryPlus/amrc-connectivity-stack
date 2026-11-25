/*
 * ACS Admin
 * The trends of a composition's components, side by side
 * Copyright 2026 University of Sheffield
 *
 * Opening a composition's row in the subscriptions panel shows a graph for each of its components
 * that has numeric readings, laid out in a grid with as many columns as fit the panel and
 * wrapping onto more rows. A single graph spans the full width.
 */

import { useExplorerStore } from '../stores/explorer'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { objectPathSegments, PATH_SEPARATOR } from '../components/main/navigation'
import { TrendView } from '../components/subscriptions/TrendView'
import { rowLabel } from './rowLabel'
import { ElementEngUnit } from './EngUnitText'

/** More graphs than this are left to the component rows, each of which opens to its own trend. */
export const MAX_COMPONENT_TRENDS = 24

/**
 * The layout for `count` graphs: one alone spans the full width; several sit side by side, as
 * many columns of at least 28rem as fit, wrapping onto more rows.
 */
export function trendGridClass(count: number): string {
  return count > 1
    ? 'grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(28rem,100%),1fr))]'
    : 'grid gap-3 grid-cols-1'
}

export function ComponentTrends({ rootId, componentIds }: { rootId: string; componentIds: readonly string[] }) {
  // Joined into a string, so the selector's result is stable while the set of trends is.
  const withTrends = useSubscriptionsStore(state =>
    componentIds.filter(id => state.trendData.has(id)).join('\n')
  )
  const objectIndex = useExplorerStore(state => state.objectIndex)
  const ids = withTrends ? withTrends.split('\n') : []

  if (ids.length === 0) {
    return <p className="mb-2 text-[11px] text-i3x-text-muted">No numeric readings from its components yet.</p>
  }

  const shown = ids.slice(0, MAX_COMPONENT_TRENDS)
  const rootPath = objectPathSegments(rootId, objectIndex)

  return (
    <div className="mb-2">
      <div data-trend-grid="" className={trendGridClass(shown.length)}>
        {shown.map(id => {
          const path = objectPathSegments(id, objectIndex)
          const label = path ? rowLabel(path, rootPath) : { lead: '', leaf: id, full: id }
          return (
            <figure key={id} className="m-0 min-w-0">
              <figcaption className="flex min-w-0 mb-1 text-[11px]" title={`${label.full}\n${id}`}>
                {label.lead && (
                  <span dir="rtl" className="truncate min-w-[1.5em] text-left text-i3x-text-muted">
                    <bdi>{label.lead}</bdi>
                  </span>
                )}
                {label.lead && <span aria-hidden="true" className="flex-shrink-0 whitespace-pre text-i3x-text-muted">{PATH_SEPARATOR}</span>}
                <span className="flex-shrink-0 whitespace-nowrap text-i3x-text">{label.leaf}</span>
                <ElementEngUnit elementId={id} className="flex-shrink-0 ml-1.5 whitespace-nowrap" />
              </figcaption>
              <TrendView elementId={id} />
            </figure>
          )
        })}
      </div>
      {ids.length > shown.length && (
        <p className="mt-1 text-[11px] text-i3x-text-muted">
          {ids.length - shown.length} more component trends not shown here. Open a component's row for its trend.
        </p>
      )}
    </div>
  )
}
