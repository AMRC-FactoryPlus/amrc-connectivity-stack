/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { fetchEventSource } from '@microsoft/fetch-event-source'

/**
 * Open an SSE stream against i3x's /v1/subscriptions/stream endpoint.
 *
 * `headers` should include any auth headers the caller wants on the
 * request (e.g. `Authorization: Bearer <token>` resolved via the
 * service-client). fetchEventSource reuses the same headers across
 * reconnects, so if the token expires mid-stream the reconnect will
 * fail — callers handling long-lived streams should plan a refresh.
 *
 * Without `onFail`, a failed connection is retried every second, as
 * fetchEventSource does by default. With it, the first failure stops
 * the stream and calls `onFail(err)`, so the caller decides when to
 * try again.
 */
export function openI3xStream (baseUrl, headers, clientId, subscriptionId, onMessage, onClose, { onFail } = {}) {
  const ctrl = new AbortController()

  fetchEventSource(`${baseUrl}/subscriptions/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ clientId, subscriptionId }),
    signal: ctrl.signal,

    onmessage (ev) {
      try {
        const items = JSON.parse(ev.data)
        onMessage(items)
      } catch (e) {
        console.warn('Failed to parse SSE data:', e)
      }
    },

    onerror (err) {
      console.error('SSE stream error:', err)
      // Throwing stops fetchEventSource retrying.
      if (onFail) throw err
    },

    onclose () {
      onClose?.()
    },

    openWhenHidden: true,
  }).catch(err => {
    if (!ctrl.signal.aborted) onFail?.(err)
  })

  return {
    close () {
      ctrl.abort()
    },
  }
}
