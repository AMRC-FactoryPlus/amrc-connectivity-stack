import { useState, useEffect, useRef } from 'react'
import type { ObjectInstance } from '../../api/types'
import { getClient } from '../../api/client'
import { useExplorerStore, type DetailTab } from '../../stores/explorer'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { useSubscriptionTransport } from '../subscriptions/SubscriptionTransport'
import { registerItem } from '../subscriptions/registerItem'
import { Breadcrumb } from './Breadcrumb'
import { objectPath } from './navigation' // ACS
import { OverviewTab } from './tabs/OverviewTab'
import { HistoryTab } from './tabs/HistoryTab'
import { BroadcastIcon, ShieldIcon, DatabaseIcon, ChartLineIcon } from '../common/icons'
import { FormattedText } from '../common/FormattedText' // ACS
import { useIsContainer } from '../../data/childValues' // ACS
import { acsHost, useHostActions } from '../../acs/host' // ACS
import { Spinner } from '../common/Spinner'
import { useObjectDetails } from '../../data/useObjectDetails'
import { errorText, useObjectValue } from '../../data/queries'
import { PerfProfiler } from '../../diagnostics/PerfProfiler'

// Subscriptions are deliberately absent: they're global state, not a property of
// whichever element happens to be selected, so they live in the bottom drawer.
// The tab itself lives in the navigation history (stores/explorer.ts): a tab is
// a page, so switching one is a navigation stop and Back returns to it.
type TabId = DetailTab

// ACS: Overview and History only. Relationships is a panel on Overview, the
// Subtree tab is gone, and a container (its value is its children's) has no
// History, so it has no tab bar at all.
const LEAF_TABS: TabId[] = ['overview', 'history']
const CONTAINER_TABS: TabId[] = ['overview']
const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview',
  history: 'History',
}

/**
 * View B, the element detail, shown whenever an object is selected.
 * Owns the current-value fetch and the subscribe action; the tabs are
 * presentational consumers of that state.
 */
export function ObjectDetailView({ object: catalogObject }: { object: ObjectInstance }) {
  // Catalog objects are light skeletons; metadata, relationships, and description come from the server.
  const { object, detailsPending, detailsError, retryDetails } = useObjectDetails(catalogObject)
  // The active tab is the history's, not local state: a deep-link (the tree's
  // "Open Relationships") sets it as it selects, switching tabs pushes a stop,
  // and Back/Forward land on the exact tab you left.
  const storedTab = useExplorerStore(s => s.detailTab)
  const setActiveTab = useExplorerStore(s => s.setDetailTab)
  // ACS: a container has no History, so a stop or link onto it lands on Overview.
  const container = useIsContainer(catalogObject)
  const tabs = container ? CONTAINER_TABS : LEAF_TABS
  const activeTab: TabId = tabs.includes(storedTab) ? storedTab : 'overview'
  const { actions: hostActions, selection: hostSelected } = useHostActions(catalogObject)

  const valueQuery = useObjectValue(catalogObject.elementId, catalogObject.isComposition)
  const value = valueQuery.data ?? null
  const isLoadingValue = valueQuery.isFetching
  const valueError = errorText(valueQuery.error, 'Failed to load value')
  const loadValue = () => void valueQuery.refetch()
  const [valueView, setValueView] = useState<'parsed' | 'raw'>('parsed')

  const [isSubscribing, setIsSubscribing] = useState(false)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  const { startStream } = useSubscriptionTransport()
  // A boolean selector: live values arriving don't re-render the detail view.
  const isSubscribed = useSubscriptionsStore(state => {
    for (const sub of state.subscriptions.values()) {
      if (sub.monitoredItems.includes(object.elementId)) return true
    }
    return false
  })

  // Clear subscribe error when the selected object changes
  useEffect(() => {
    setSubscribeError(null)
  }, [object.elementId])

  // Read subscription state through getState() inside the handler rather than a
  // hook: subscribing to the store here would re-render the whole detail view on
  // every live value that arrives.
  const handleSubscribe = async () => {
    const client = getClient()
    if (!client) return

    setIsSubscribing(true)
    setSubscribeError(null)

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
      const { maxDepth, components } = await registerItem(client, subscriptionId, object, value)
      // ACS: remember the path, so the row is named even before the catalog holds the object.
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
      const msg = err instanceof Error ? err.message : 'Subscribe failed'
      setSubscribeError(msg)
      console.error('Failed to subscribe:', err)

      // Roll back any subscription we just created so it doesn't sit empty in
      // the UI. This assumes the failure came from create/register, if
      // startStream ever becomes throwing, revisit so a healthy subscription
      // isn't deleted over a transport hiccup.
      if (newlyCreatedSubId) {
        useSubscriptionsStore.getState().removeSubscription(newlyCreatedSubId)
        try { await client.deleteSubscription(newlyCreatedSubId) } catch { /* best-effort */ }
      }
    } finally {
      setIsSubscribing(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-i3x-bg">
      <header className="bg-i3x-surface border-b border-i3x-border px-3 sm:px-5 pt-3.5">
        <Breadcrumb object={object} />

        {/* Wraps the action buttons below the title once the pane gets narrow. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1
              className="text-lg sm:text-xl font-semibold text-i3x-text truncate"
              title={object.displayName}
            >
              {object.displayName}
            </h1>
            <span className="hidden sm:block text-xs text-i3x-text-muted flex-shrink-0">
              Object Instance
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {/* ACS: the Manager UI's own actions on this object, run by the host. */}
            {hostSelected && hostActions.map(action => (
              <button
                key={action.id}
                type="button"
                onClick={() => acsHost?.runAction(action.id, hostSelected)}
                title={action.title}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-i3x-text bg-i3x-surface border border-i3x-border rounded-lg hover:bg-i3x-bg transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                {action.id === 'access' && <ShieldIcon size={14} />}
                {action.id === 'show-dataset' && <ChartLineIcon size={14} />}
                {action.id === 'dataset' && <DatabaseIcon size={14} />}
                {action.label}
              </button>
            ))}
            {isSubscribed ? (
              <button
                type="button"
                onClick={() => useSubscriptionsStore.getState().setSubscriptionsOpen(true)}
                title="Show in the subscriptions drawer"
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-i3x-success bg-i3x-success/10 border border-i3x-success/30 rounded-lg hover:bg-i3x-success/20 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                <BroadcastIcon size={13} /> Subscribed
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={isSubscribing}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-i3x-primary rounded-lg hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                {isSubscribing ? <><Spinner size={13} /> Subscribing…</> : <><BroadcastIcon size={13} /> Subscribe</>}
              </button>
            )}
          </div>
        </div>

        <ObjectDescription
          object={object}
          pending={detailsPending}
          error={errorText(detailsError, 'Failed to load object details')}
          onRetry={retryDetails}
        />

        {subscribeError && (
          <p className="text-xs text-i3x-error mt-1.5 sm:text-right" title={subscribeError}>
            {subscribeError}
          </p>
        )}

        {tabs.length > 1 ? (
          <TabList tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
        ) : (
          <div className="h-3.5" />
        )}
      </header>

      <div className="flex-1 overflow-auto p-3 sm:p-5 min-h-0">
        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
          className="focus:outline-none w-full"
        >
          {activeTab === 'overview' && (
            <PerfProfiler id="Overview tab">
              <OverviewTab
                object={object}
                catalogObject={catalogObject}
                container={container}
                value={value}
                valueFetchedAt={valueQuery.dataUpdatedAt}
                valueView={valueView}
                onValueViewChange={setValueView}
                isLoadingValue={isLoadingValue}
                valueError={valueError}
                onRefresh={loadValue}
              />
            </PerfProfiler>
          )}
          {activeTab === 'history' && (
            <PerfProfiler id="History tab">
              <HistoryTab object={catalogObject} />
            </PerfProfiler>
          )}
        </div>
      </div>
    </div>
  )
}

/** Roving-tabindex tab strip: arrows move between tabs, Home/End jump to the ends. */
function TabList({
  tabs: TAB_ORDER,
  activeTab,
  onChange,
}: {
  tabs: TabId[]
  activeTab: TabId
  onChange: (tab: TabId) => void
}) {
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const currentIndex = TAB_ORDER.indexOf(activeTab)
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TAB_ORDER.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TAB_ORDER.length - 1

    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = TAB_ORDER[nextIndex]
    onChange(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Element details"
      onKeyDown={handleKeyDown}
      className="flex gap-1 mt-3.5 overflow-x-auto"
    >
      {TAB_ORDER.map(tab => {
        const selected = tab === activeTab
        return (
          <button
            key={tab}
            ref={element => { tabRefs.current[tab] = element }}
            type="button"
            role="tab"
            id={`tab-${tab}`}
            aria-selected={selected}
            aria-controls={`panel-${tab}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary focus-visible:rounded-t ${
              selected
                ? 'text-i3x-primary border-i3x-primary font-medium'
                : 'text-i3x-text-muted border-transparent hover:text-i3x-text'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * ACS: the object's description, under its title, in place of the Description
 * card. Nothing when it has none; a quiet line while it loads or if it failed.
 */
function ObjectDescription({
  object,
  pending,
  error,
  onRetry,
}: {
  object: ObjectInstance
  pending: boolean
  error: string | null
  onRetry: () => void
}) {
  const metadata = object.metadata
  const text =
    object.description || (typeof metadata?.description === 'string' ? metadata.description : undefined)
  const system = metadata?.system
  const mimeType =
    system && typeof system === 'object' ? (system as Record<string, unknown>).descriptionMime : undefined

  if (text) {
    return (
      <div className="mt-1 max-w-3xl text-i3x-text-muted" data-testid="object-description">
        <FormattedText mimeType={mimeType} className="!text-[13px] !text-i3x-text-muted">{text}</FormattedText>
      </div>
    )
  }
  if (pending) return null
  if (error) {
    return (
      <p role="alert" className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-i3x-error">
        <span>Details could not be loaded: {error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="px-2 py-0.5 rounded border border-i3x-border text-i3x-text hover:bg-i3x-bg"
        >
          Retry
        </button>
      </p>
    )
  }
  return null
}
