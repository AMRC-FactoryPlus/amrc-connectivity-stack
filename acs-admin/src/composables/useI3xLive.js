/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { onBeforeUnmount } from 'vue'
import { useI3xClient } from '@composables/useI3xClient.js'

const RETRY_MS = 30 * 1000

function client_id () {
  // crypto.randomUUID needs a secure context; this is only a session handle.
  const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `acs-admin-datasets-${id}`
}

/**
 * Live values from an i3X subscription, for a set of leaf elementIds
 * that can change. `onValues` gets the stream's items:
 * [{ elementId, value, quality, timestamp }].
 *
 * Call `watch(ids)` whenever the set changes; an empty set closes the
 * subscription. If i3X is missing or the stream drops, it tries again
 * every 30 s. Callers repair anything missed by refetching.
 * Closes itself when the component unmounts.
 */
export function useI3xLive (onValues) {
  const i3x = useI3xClient()
  const clientId = client_id()
  let subscriptionId = null
  let stream = null
  let registered = new Set()
  let wanted = new Set()
  let busy = Promise.resolve()
  let retry = null
  let closed = false

  async function drop () {
    stream?.close()
    stream = null
    const sub = subscriptionId
    subscriptionId = null
    registered = new Set()
    if (sub) await i3x.deleteSubscription(clientId, [sub]).catch(() => {})
  }

  function schedule () {
    if (retry || closed) return
    retry = setTimeout(() => {
      retry = null
      queue()
    }, RETRY_MS)
  }

  async function sync () {
    if (closed) return
    if (!wanted.size) { await drop(); return }
    try {
      if (!subscriptionId) {
        const res = await i3x.createSubscription(clientId, 'ACS Admin Datasets')
        subscriptionId = res.subscriptionId
        registered = new Set()
      }
      const add = [...wanted].filter(id => !registered.has(id))
      const remove = [...registered].filter(id => !wanted.has(id))
      if (remove.length) {
        await i3x.unregisterItems(clientId, subscriptionId, remove).catch(() => {})
        for (const id of remove) registered.delete(id)
      }
      if (add.length) {
        await i3x.registerItems(clientId, subscriptionId, add)
        for (const id of add) registered.add(id)
      }
      if (!stream) {
        const sub = subscriptionId
        stream = await i3x.streamSubscription(clientId, sub, items => {
          if (!closed && Array.isArray(items)) onValues(items)
        }, () => {
          // The stream ended: start again with a new subscription.
          if (subscriptionId !== sub) return
          stream = null
          subscriptionId = null
          registered = new Set()
          schedule()
        })
      }
    }
    catch (err) {
      console.warn('Datasets: live values from i3X are not available', err)
      await drop()
      schedule()
    }
  }

  function queue () {
    busy = busy.then(sync, sync)
    return busy
  }

  function watch (ids) {
    wanted = new Set((ids ?? []).filter(Boolean))
    return queue()
  }

  function close () {
    closed = true
    clearTimeout(retry)
    wanted = new Set()
    busy = busy.then(drop, drop)
  }

  onBeforeUnmount(close)

  return { watch, close }
}
