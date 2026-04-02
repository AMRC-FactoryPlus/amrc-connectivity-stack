/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { fetchEventSource } from '@microsoft/fetch-event-source'

export function openI3xStream (baseUrl, clientId, subscriptionId, onMessage, onClose) {
  const ctrl = new AbortController()

  fetchEventSource(`${baseUrl}/subscriptions/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    },

    onclose () {
      onClose?.()
    },

    openWhenHidden: true,
  })

  return {
    close () {
      ctrl.abort()
    },
  }
}
