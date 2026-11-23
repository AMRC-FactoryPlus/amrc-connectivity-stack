// ACS: a compact Subscribe button for a row of objects (the Current value
// table and the relationship list), so a child can be subscribed to without
// opening it. Hidden until the row is hovered or the button has focus; always
// shown, in the success colour, once the element is subscribed, and clicking
// it then opens the subscriptions drawer. See FORK.md.

import { useEffect } from 'react'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { BroadcastIcon } from '../components/common/icons'
import { Spinner } from '../components/common/Spinner'
import {
  clearSubscribeError,
  showSubscriptions,
  useElementSubscribeState,
  useIsSubscribed,
  useSubscribeAction,
} from './useSubscribe'

/** How long a failure stays on the button before it goes back to normal. */
export const ROW_ERROR_MS = 6000

const BASE = 'grid place-items-center rounded-md transition-opacity motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary'

/**
 * The row it sits in needs the `group` class: the button shows on the row's
 * hover. On a screen with no hover (touch) it always shows.
 */
export function RowSubscribeButton({
  object,
  value,
  className = 'w-5 h-5',
}: {
  object: Pick<ObjectInstance, 'elementId' | 'displayName' | 'isComposition'>
  value?: LastKnownValue | null
  className?: string
}) {
  const subscribed = useIsSubscribed(object.elementId)
  const { pending, error } = useElementSubscribeState(object.elementId)
  const subscribe = useSubscribeAction()

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => clearSubscribeError(object.elementId), ROW_ERROR_MS)
    return () => clearTimeout(timer)
  }, [error, object.elementId])

  if (subscribed) {
    return (
      <button
        type="button"
        onClick={event => {
          event.stopPropagation()
          showSubscriptions()
        }}
        aria-label={`${object.displayName} is subscribed: show in subscriptions`}
        title="Subscribed: show in subscriptions"
        className={`${className} ${BASE} text-i3x-success bg-i3x-success/10 hover:bg-i3x-success/20`}
      >
        <BroadcastIcon size={12} />
      </button>
    )
  }

  const shown = pending || error
  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation()
        if (!pending) void subscribe(object, value)
      }}
      aria-label={error ? `Subscribe to ${object.displayName} failed: ${error}` : `Subscribe to ${object.displayName}`}
      aria-busy={pending || undefined}
      title={error ? `Subscribe failed: ${error}` : pending ? 'Subscribing…' : 'Subscribe'}
      className={`${className} ${BASE} ${
        error
          ? 'text-i3x-error bg-i3x-error/10'
          : 'text-i3x-text-muted hover:bg-i3x-surface hover:text-i3x-primary'
      } ${shown ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100'}`}
    >
      {pending ? <Spinner size={11} /> : <BroadcastIcon size={12} />}
    </button>
  )
}
