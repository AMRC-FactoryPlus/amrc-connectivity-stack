/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { getCurrentInstance, onBeforeUnmount, shallowRef } from 'vue'
import { useI3xClient, register_outcome } from '@composables/useI3xClient.js'

export const RETRY_MS = 30 * 1000

function client_id () {
  // crypto.randomUUID needs a secure context; this is only a session handle.
  const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `acs-admin-datasets-${id}`
}

/**
 * Live values from an i3X subscription, for a set of leaf elementIds
 * that can change. `onValues` gets the stream's items as they come,
 * quality included: [{ elementId, value, quality, timestamp }].
 *
 * Call `watch(ids)` whenever the set changes; an empty set closes the
 * subscription. Each id registers on its own: an id i3X does not show
 * this principal is parked, and the rest still stream. Parked ids are
 * tried again every 30 s, which picks up new grants. If i3X is missing
 * or the stream drops, it tries again every 30 s. Callers repair
 * anything missed by refetching. Closes itself when the component
 * unmounts.
 *
 * `subscribed` is the Set of ids that are streaming. `status` is:
 * - 'off': nothing to watch
 * - 'live': at least one id is streaming
 * - 'denied': no id registered, and i3X answered 404 for every one.
 *   i3X gives 404 both for no access and for an object it does not
 *   serve; every device with a placement is served, so this means the
 *   principal has no i3X access to them.
 * - 'unavailable': i3X failed, or the stream is down
 *
 * @param onValues  called with each batch of stream items
 * @param opts      { client }: an i3X client, for tests. Defaults to
 *                  useI3xClient().
 */
export function useI3xLive (onValues, { client = null } = {}) {
  const i3x = client ?? useI3xClient()
  const clientId = client_id()
  let subscriptionId = null
  let stream = null
  let registered = new Set()
  let wanted = new Set()
  // Ids that did not register, with why: 'missing' (404) or 'failed'.
  let parked = new Map()
  let busy = Promise.resolve()
  let retry = null
  let closed = false

  const subscribed = shallowRef(new Set())
  const status = shallowRef('off')

  function publish () {
    subscribed.value = new Set(registered)
  }

  async function drop () {
    stream?.close()
    stream = null
    const sub = subscriptionId
    subscriptionId = null
    registered = new Set()
    publish()
    if (sub) await i3x.deleteSubscription(clientId, [sub]).catch(() => {})
  }

  function schedule () {
    if (retry || closed) return
    retry = setTimeout(() => {
      retry = null
      queue(true)
    }, RETRY_MS)
  }

  // Why nothing streams: denied only when every parked id was a 404.
  function idle_status () {
    if (!parked.size) return 'unavailable'
    return [...parked.values()].every(why => why === 'missing') ? 'denied' : 'unavailable'
  }

  async function sync (again) {
    if (closed) return
    for (const id of [...parked.keys()]) if (!wanted.has(id)) parked.delete(id)
    if (!wanted.size) {
      parked = new Map()
      await drop()
      status.value = 'off'
      return
    }
    try {
      if (!subscriptionId) {
        const res = await i3x.createSubscription(clientId, 'ACS Admin Datasets')
        subscriptionId = res.subscriptionId
        registered = new Set()
      }
      const remove = [...registered].filter(id => !wanted.has(id))
      if (remove.length) {
        await i3x.unregisterEach(clientId, subscriptionId, remove).catch(() => {})
        for (const id of remove) registered.delete(id)
      }
      // Parked ids wait for the timer, so a page that re-renders does
      // not ask i3X about them every time.
      const add = [...wanted].filter(id => !registered.has(id) && (again || !parked.has(id)))
      if (add.length) {
        const results = await i3x.registerEach(clientId, subscriptionId, add)
        const { ok, missing, failed } = register_outcome(results, add)
        for (const id of ok) { registered.add(id); parked.delete(id) }
        for (const id of missing) parked.set(id, 'missing')
        for (const id of failed) parked.set(id, 'failed')
      }
      publish()

      if (!registered.size) {
        // Nothing to stream. Give the subscription back; the timer
        // starts a new one for the parked ids.
        await drop()
        status.value = idle_status()
        schedule()
        return
      }
      if (parked.size) schedule()

      if (!stream) {
        const sub = subscriptionId
        // The stream ended or failed: start again with a new
        // subscription in 30 s, not every second.
        const ended = () => {
          if (subscriptionId !== sub) return
          stream?.close()
          stream = null
          subscriptionId = null
          registered = new Set()
          publish()
          if (!closed) status.value = 'unavailable'
          i3x.deleteSubscription(clientId, [sub]).catch(() => {})
          schedule()
        }
        stream = await i3x.streamSubscription(clientId, sub, items => {
          if (!closed && Array.isArray(items)) onValues(items)
        }, ended, { onFail: ended })
      }
      if (!closed) status.value = 'live'
    }
    catch (err) {
      console.warn('Datasets: live values from i3X are not available', err)
      await drop()
      if (!closed) status.value = 'unavailable'
      schedule()
    }
  }

  function queue (again = false) {
    const run = () => sync(again)
    busy = busy.then(run, run)
    return busy
  }

  function watch (ids) {
    wanted = new Set((ids ?? []).filter(Boolean))
    return queue()
  }

  function close () {
    closed = true
    clearTimeout(retry)
    retry = null
    wanted = new Set()
    parked = new Map()
    status.value = 'off'
    busy = busy.then(drop, drop)
    return busy
  }

  if (getCurrentInstance()) onBeforeUnmount(close)

  return { watch, close, subscribed, status }
}
