/*
 * ACS: a container's current value as its children, one level at a time, as
 * the Manager UI's own Explorer showed it. See FORK.md and data/childValues.ts.
 */

import { useState } from 'react'
import type { LastKnownValue, ObjectInstance } from '../../api/types'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { useChildValues, useValueChildren, isContainer } from '../../data/childValues'
import { useExplorerStore } from '../../stores/explorer'
import { Chevron } from '../common/Chevron'
import { Spinner } from '../common/Spinner'
import { StatusFacets } from '../details/ElementStatus'
import { formatComponentValue, formatComponentValueShort } from '../details/ValueDisplay'
import { useElementNavigation } from './navigation'
import { RowSubscribeButton } from '../../acs/RowSubscribeButton'

/** Rows shown per level before "Show more". */
export const CHILD_ROWS_PAGE = 50

/** How far each level is indented, in pixels. */
const INDENT = 16

/**
 * The children of a container with their values. Each child that is a container
 * itself opens in place to show its own children; clicking a name opens that
 * element.
 */
export function ChildValues({ parentId }: { parentId: string }) {
  return (
    // ACS: the columns keep a readable minimum width and the table scrolls
    // sideways in a narrow pane, rather than wrapping names a letter a line.
    // It also scrolls inside the card, with its header row pinned, so the
    // card's title, Refresh and More stay in view on a long container.
    // Values sit right, in bold, beside the quality and time. The last, narrow
    // column is each row's Subscribe button.
    <div className="border border-i3x-border rounded-lg overflow-auto max-h-[min(60vh,40rem)]">
      <div role="table" aria-label="Current values" className="min-w-[26rem] text-[13px]">
        <div role="row" className="sticky top-0 z-10 grid grid-cols-[minmax(9rem,1fr)_minmax(6rem,max-content)_auto_auto_1.25rem] gap-3 px-3 py-1.5 bg-i3x-bg text-[11px] font-medium text-i3x-text-muted">
          <span role="columnheader">Name</span>
          <span role="columnheader" className="text-right">Value</span>
          <span role="columnheader">Quality</span>
          <span role="columnheader" className="w-[5.5rem]">Time</span>
          <span role="columnheader"><span className="sr-only">Subscribe</span></span>
        </div>
        <ChildLevel parentId={parentId} depth={0} />
      </div>
    </div>
  )
}

function ChildLevel({ parentId, depth }: { parentId: string; depth: number }) {
  const { children, isLoading } = useValueChildren(parentId)
  const [limit, setLimit] = useState(CHILD_ROWS_PAGE)
  const shown = children.slice(0, limit)
  const values = useChildValues(parentId, shown.map(child => child.elementId))
  const remaining = children.length - shown.length

  const note = (text: string, error = false) => (
    <div
      role="row"
      className={`px-3 py-1.5 border-t border-i3x-border text-xs ${error ? 'text-i3x-error' : 'text-i3x-text-muted'}`}
      style={{ paddingLeft: 12 + depth * INDENT + 18 }}
    >
      <span role="cell">{text}</span>
    </div>
  )

  if (isLoading) return note('Loading…')
  if (children.length === 0) return note('Nothing under this element.')

  return (
    <>
      {shown.map(child => (
        <ChildRow
          key={child.elementId}
          object={child}
          depth={depth}
          value={values.data?.get(child.elementId) ?? null}
          valueFetchedAt={values.dataUpdatedAt}
          valuesPending={values.isPending}
        />
      ))}
      {values.error && note(values.error instanceof Error ? values.error.message : 'Failed to load values', true)}
      {remaining > 0 && (
        <div role="row" className="border-t border-i3x-border px-3 py-1.5" style={{ paddingLeft: 12 + depth * INDENT + 18 }}>
          <button
            role="cell"
            type="button"
            onClick={() => setLimit(current => current + CHILD_ROWS_PAGE)}
            className="text-[11px] text-i3x-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            Show {Math.min(CHILD_ROWS_PAGE, remaining)} more · {remaining.toLocaleString()} remaining
          </button>
        </div>
      )}
    </>
  )
}

function ChildRow({
  object,
  depth,
  value,
  valueFetchedAt,
  valuesPending,
}: {
  object: ObjectInstance
  depth: number
  value: LastKnownValue | null
  valueFetchedAt: number
  valuesPending: boolean
}) {
  const [open, setOpen] = useState(false)
  const { selectObject } = useElementNavigation()
  const container = useExplorerStore(state => isContainer(object, state))
  // A subscription's update for this child, when it is newer than the read.
  const live = useSubscriptionsStore(state => state.liveValues.get(object.elementId))
  const useLive = !!live && live.receivedAt >= valueFetchedAt
  const shown = useLive
    ? { value: live.value, quality: live.quality ?? undefined, timestamp: live.timestamp ?? undefined }
    : value
  const hasValue = shown != null && shown.value !== null && shown.value !== undefined

  return (
    <>
      <div
        role="row"
        className="grid grid-cols-[minmax(9rem,1fr)_minmax(6rem,max-content)_auto_auto_1.25rem] items-baseline gap-3 px-3 py-1.5 border-t border-i3x-border hover:bg-i3x-bg group"
      >
        <div role="cell" className="flex items-baseline gap-1.5 min-w-0" style={{ paddingLeft: depth * INDENT }}>
          {container ? (
            <button
              type="button"
              onClick={() => setOpen(current => !current)}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${object.displayName}`}
              className="w-3 h-4 grid place-items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              <Chevron open={open} />
            </button>
          ) : (
            <span aria-hidden="true" className="w-3 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => selectObject(object)}
            title={object.elementId}
            className={`min-w-0 text-left break-words text-i3x-text hover:text-i3x-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${container ? 'font-medium' : ''}`}
          >
            {object.displayName}
          </button>
        </div>
        <div role="cell" className="min-w-0 max-w-[24rem] text-right font-mono font-semibold text-[12px] text-i3x-text break-words tabular-nums">
          {hasValue ? (
            <span title={formatComponentValue(shown.value)}>{formatComponentValueShort(shown.value)}</span>
          ) : valuesPending && !useLive ? (
            <Spinner size={11} />
          ) : container ? null : shown ? (
            <span className="text-i3x-text-muted font-sans font-normal text-xs">No value</span>
          ) : (
            <span className="text-i3x-text-muted font-sans font-normal text-xs" title="The server did not report a value">Not reported</span>
          )}
        </div>
        <div role="cell">
          {shown?.quality && <StatusFacets code={shown.quality} variant="dot" />}
        </div>
        <div role="cell" className="w-[5.5rem] text-[11px] text-i3x-text-muted whitespace-nowrap tabular-nums">
          {shown?.timestamp && (
            <span title={new Date(shown.timestamp).toLocaleString()}>
              {new Date(shown.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        {/* Centred, so the 20px button sits inside the text line and the row keeps its height. */}
        <div role="cell" className="self-center -my-0.5">
          <RowSubscribeButton object={object} value={value} />
        </div>
      </div>
      {open && <ChildLevel parentId={object.elementId} depth={depth + 1} />}
    </>
  )
}
