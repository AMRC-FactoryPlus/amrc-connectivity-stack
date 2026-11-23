import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ObjectInstance, LastKnownValue } from '../../../api/types'
import { isLiveFeed, useSubscriptionsStore } from '../../../stores/subscriptions'
import { composeCurrentValue } from '../../subscriptions/composedValue'
import { RefreshIcon } from '../../common/icons'
import { Spinner } from '../../common/Spinner'
import { CardCodeSample } from '../../details/CodeSamplePanel'
import { buildObjectRequestTabs } from '../../details/requestTabs'
import { ValueDisplay, formatComponentValue } from '../../details/ValueDisplay'
import { StatusFacets } from '../../details/ElementStatus' // ACS
import { queryClient } from '../../../data/queryClient' // ACS
import { LiveBadge } from '../../subscriptions/LiveBadge'
import { Card, Field, SegmentedControl } from '../primitives'
import { ChildValues } from '../ChildValues' // ACS
import { RelationshipsTab } from './RelationshipsTab' // ACS

interface OverviewTabProps {
  object: ObjectInstance
  /**
   * ACS: the catalog's copy of the object, which does not change when the full
   * details arrive, so the relationship walk is not redone then.
   */
  catalogObject?: ObjectInstance
  /** ACS: a container's value is its children's, so they are listed. */
  container?: boolean
  value: LastKnownValue | null
  /** When `value` was fetched (ms since epoch); a newer subscription update replaces it. */
  valueFetchedAt: number
  valueView: 'parsed' | 'raw'
  onValueViewChange: (view: 'parsed' | 'raw') => void
  isLoadingValue: boolean
  valueError: string | null
  onRefresh: () => void
}

export function OverviewTab({
  object,
  catalogObject,
  container = false,
  value,
  valueFetchedAt,
  valueView,
  onValueViewChange,
  isLoadingValue,
  valueError,
  onRefresh,
}: OverviewTabProps) {
  const sourceTypeId =
    object.metadata?.sourceTypeId != null ? String(object.metadata.sourceTypeId) : null

  const requestTabs = useMemo(
    () => buildObjectRequestTabs(object),
    [object]
  )

  // Only this element's and its components' entries: other elements' updates don't re-render the tab.
  const componentIds = useMemo(() => Object.keys(value?.components ?? {}), [value])
  const liveReadings = useSubscriptionsStore(
    useShallow(state => [object.elementId, ...componentIds].map(id => state.liveValues.get(id)))
  )
  const live = liveReadings[0]
  const liveFeed = useSubscriptionsStore(state => isLiveFeed(state.subscriptions, object.elementId))
  const composed = useMemo(() => {
    const byId = new Map([object.elementId, ...componentIds].map((id, i) => [id, liveReadings[i]]))
    return composeCurrentValue(value, object, id => byId.get(id), valueFetchedAt)
  }, [value, object, componentIds, liveReadings, valueFetchedAt])
  const shownValue = composed.value
  // ACS: a container's own value, shown above its children when it has one.
  const ownValue = shownValue?.value ?? null
  // ACS: Refresh reads a container's children again too.
  const refresh = () => {
    onRefresh()
    if (container) {
      void queryClient.invalidateQueries({ queryKey: ['childValues'] })
      void queryClient.invalidateQueries({ queryKey: ['valueChildrenRelated'] })
    }
  }
  const flashKey = composed.overlaid.reduce((latest, entry) => Math.max(latest, entry.changedAt), 0)

  return (
    <div className="space-y-4">
      <Card
        title="Current Value"
        actions={
          <>
            {live && liveFeed && (
              <LiveBadge
                receivedAt={live.receivedAt}
                updateCount={live.updateCount}
                repeatCount={live.repeatCount}
                freshAt={live.freshAt}
              />
            )}
            {!container && (
              <SegmentedControl
                label="Value format"
                value={valueView}
                onChange={onValueViewChange}
                options={[
                  { value: 'parsed', label: 'Parsed' },
                  { value: 'raw', label: 'Raw' },
                ]}
              />
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={isLoadingValue}
              className="flex items-center gap-1 text-xs text-i3x-primary hover:text-i3x-primary/80 disabled:opacity-50 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              {isLoadingValue ? <><Spinner size={11} /> Loading…</> : <><RefreshIcon size={11} /> Refresh</>}
            </button>
            <CardCodeSample
              tabs={requestTabs}
              initialTabId="value"
              title={object.displayName}
              subtitle="Object Instance"
            />
          </>
        }
      >
        {container ? (
          // ACS: a container's value is its children, read one level at a time.
          <div className="space-y-3">
            {ownValue !== null && (
              <p className="flex flex-wrap items-baseline gap-3 text-[13px]">
                <span className="font-mono text-i3x-text break-all">{formatComponentValue(ownValue)}</span>
                {shownValue?.quality && <StatusFacets code={shownValue.quality} variant="dot" />}
              </p>
            )}
            <ChildValues parentId={object.elementId} />
          </div>
        ) : valueError && !composed.rootIsLive ? (
          <div className="px-3 py-2 bg-i3x-error/10 border border-i3x-error/20 rounded-lg text-sm text-i3x-error">
            {valueError}
          </div>
        ) : shownValue ? (
          <div className="relative">
            <ValueDisplay value={shownValue} view={valueView} />
            {/* Re-keyed on each change, so the flash replays over the value. */}
            {flashKey > 0 && (
              <span
                key={flashKey}
                aria-hidden="true"
                className="value-updated pointer-events-none absolute inset-0 rounded-lg"
              />
            )}
          </div>
        ) : (
          <div className="px-3 py-2 bg-i3x-bg border border-i3x-border rounded-lg text-sm text-i3x-text-muted">
            {isLoadingValue ? (
              <span className="flex items-center gap-2">
                <Spinner size={13} />
                Loading value…
              </span>
            ) : (
              'No value available'
            )}
          </div>
        )}
      </Card>

      {/* ACS: Relationships is a panel here, under Current Value, on every
          object. It needs a height to lay its list and map out in. */}
      <div className="h-[36rem]">
        <RelationshipsTab object={catalogObject ?? object} />
      </div>

      <Card
        title="Identity"
        actions={
          <CardCodeSample
            tabs={requestTabs}
            initialTabId="overview"
            title={object.displayName}
            subtitle="Object Instance"
          />
        }
      >
        <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <Field label="Element ID" value={object.elementId} />
          <Field label="Type ID" value={object.typeId} />
          <Field label="Parent ID" value={object.parentId} />
          <Field label="Namespace URI" value={object.namespaceUri} />
          <Field label="Source Type ID" value={sourceTypeId} />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3.5 text-[13px] text-i3x-text-muted">
          <span>
            Composition:{' '}
            <b className="font-medium text-i3x-text">{object.isComposition ? 'Yes' : 'No'}</b>
          </span>
          <span>
            Extended:{' '}
            <b className="font-medium text-i3x-text">{object.isExtended ? 'Yes' : 'No'}</b>
          </span>
        </div>
      </Card>
    </div>
  )
}
