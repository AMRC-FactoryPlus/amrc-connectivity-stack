import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom' // ACS
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { SubscriptionsView } from './SubscriptionsView'
import { CloseIcon, NewWindowIcon } from '../common/icons'
import { TrendWindowControl } from '../../acs/TrendWindowControl' // ACS
import { useSubscriptionsPopout } from '../../acs/subscriptionsPopout' // ACS

const MIN_HEIGHT = 120
const MAX_HEIGHT = 600

/**
 * Global subscriptions drawer, opened from the status bar's subscription count
 * or by subscribing to an element. It sits between the main panel and the status
 * bar, so live values stay visible while you keep browsing the model.
 *
 * Collapsing this only hides it, the SSE/polling transport lives in
 * SubscriptionTransportProvider, above the views, and keeps running.
 */
export function SubscriptionsDrawer() {
  const isOpen = useSubscriptionsStore(state => state.isSubscriptionsOpen)
  const setOpen = useSubscriptionsStore(state => state.setSubscriptionsOpen)
  // ACS: while popped out, the panel is rendered into its own window instead.
  const popoutContainer = useSubscriptionsPopout(state => state.container)

  const [height, setHeight] = useState(300)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseMove = useCallback((event: MouseEvent) => {
    setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, window.innerHeight - event.clientY)))
  }, [])

  const handleMouseUp = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (!isResizing) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  if (popoutContainer) return createPortal(<PoppedOutPanel />, popoutContainer)
  if (!isOpen) return null

  return (
    <div
      className="border-t border-i3x-border bg-i3x-bg flex flex-col flex-shrink-0"
      style={{ height: `${height}px` }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize subscriptions drawer"
        onMouseDown={() => setIsResizing(true)}
        className={`h-1 cursor-ns-resize hover:bg-i3x-primary/50 transition-colors motion-reduce:transition-none flex-shrink-0 ${
          isResizing ? 'bg-i3x-primary' : ''
        }`}
      />

      {/* ACS: the header is shared with the popped-out window. */}
      <PanelHeader onClose={() => setOpen(false)} />
      <BlockedNotice />

      <div className="flex-1 min-h-0 overflow-hidden">
        <SubscriptionsView />
      </div>
    </div>
  )
}

/**
 * ACS: the panel's header: its name and count, the trend window, and either pop out and close
 * (docked) or dock (popped out).
 */
function PanelHeader({ onClose }: { onClose?: () => void }) {
  const subscriptionCount = useSubscriptionsStore(state => state.subscriptions.size)
  const poppedOut = useSubscriptionsPopout(state => state.popout !== null)
  const popOut = useSubscriptionsPopout(state => state.popOut)
  const dock = useSubscriptionsPopout(state => state.dock)
  const restoreFocus = useSubscriptionsPopout(state => state.restoreFocus)
  const focusRestored = useSubscriptionsPopout(state => state.focusRestored)
  const focusTarget = useRef<HTMLButtonElement>(null)

  // Docked again: the pop-out button takes focus back. Popped out: the Dock button has it.
  useEffect(() => {
    if (poppedOut) {
      focusTarget.current?.focus()
    } else if (restoreFocus) {
      focusTarget.current?.focus()
      focusRestored()
    }
  }, [poppedOut, restoreFocus, focusRestored])

  const iconButton =
    'px-1.5 py-0.5 text-i3x-text-muted hover:text-i3x-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary'

  return (
    <div className="px-3 py-2 flex items-center gap-2 border-b border-i3x-border flex-shrink-0">
      <span className="text-xs font-medium text-i3x-text">Subscriptions</span>
      {subscriptionCount > 0 && (
        <span className="px-1.5 py-0.5 text-xs bg-i3x-primary/20 text-i3x-primary rounded tabular-nums">
          {subscriptionCount}
        </span>
      )}
      <div className="ml-auto min-w-0 overflow-x-auto">
        <TrendWindowControl />
      </div>
      {poppedOut ? (
        <button
          ref={focusTarget}
          type="button"
          onClick={dock}
          title="Put the subscriptions panel back in the Explorer and close this window"
          className="px-2 py-0.5 text-xs rounded border border-i3x-border text-i3x-text hover:border-i3x-primary hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          Dock
        </button>
      ) : (
        <>
          <button
            ref={focusTarget}
            type="button"
            onClick={popOut}
            aria-label="Pop out subscriptions"
            title="Pop the subscriptions panel out into its own window"
            className={iconButton}
          >
            <NewWindowIcon size={13} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close subscriptions"
            title="Close subscriptions"
            className={iconButton}
          >
            <CloseIcon size={13} />
          </button>
        </>
      )}
    </div>
  )
}

/** ACS: says the browser refused to open the pop-out window, which leaves the panel docked. */
function BlockedNotice() {
  const blocked = useSubscriptionsPopout(state => state.blocked)
  const dismiss = useSubscriptionsPopout(state => state.dismissBlocked)
  if (!blocked) return null
  return (
    <div role="status" className="px-3 py-1.5 flex items-center gap-2 border-b border-i3x-border bg-i3x-warning/10 text-xs text-i3x-text flex-shrink-0">
      The browser blocked the new window, so the panel stays here. Allow pop-ups for this site to pop it out.
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ml-auto px-1.5 py-0.5 text-i3x-text-muted hover:text-i3x-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

/** ACS: the panel as its own window shows it: the full window, sharing this app's stores and stream. */
function PoppedOutPanel() {
  return (
    <div className="h-full flex flex-col bg-i3x-bg text-i3x-text">
      <PanelHeader />
      <div className="flex-1 min-h-0 overflow-hidden">
        <SubscriptionsView />
      </div>
    </div>
  )
}
