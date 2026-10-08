/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, onBeforeUnmount, ref, toValue, watch } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import {
  LIMITS, LAST_LOOKBACK, STEP_MS, StripCache, series_request, chunk, bucket_start,
  bucket_cells, sum_counts,
} from '@/lib/datasets/series.js'
import { t_of } from '@/lib/datasets/timeline.js'

// At Hours zoom (120 px an hour) a 5 minute bucket is a 10 px cell.
const EVERY = '5m'
const STEP = STEP_MS[EVERY]
const DEBOUNCE_MS = 250
const POLL_MS = 60 * 1000
// "Quiet since" is costly over 30 days, so refresh it now and then.
const LAST_MAX_AGE_MS = 3 * 60 * 1000

/**
 * Data for the timeline's device lanes: arrival strips at Hours zoom
 * and every lane's newest data time.
 *
 * Strips are fetched for the lanes and stretch of track in view, after
 * scrolling stops. Finished hours are cached, so scrolling back costs
 * nothing; the newest two buckets are polled once a minute. Other
 * zooms show no strips until the coverage summary exists.
 *
 * @param p.zoom      ref: the zoom id
 * @param p.range     ref: track_range()
 * @param p.xWindow   ref: visible_x() of the track
 * @param p.rows      ref: the rows in view
 * @param p.eqDevices ref: equipment uuid -> [{ device }]
 */
export function useTimelineData ({ zoom, range, xWindow, rows, eqDevices }) {
  const sc = useServiceClientStore()
  const cache = new StripCache({ every: EVERY })
  // Bumped when the cache changes, so cells recompute.
  const tick = ref(0)
  const lasts = ref({})
  const lastAt = new Map()
  const error = ref(null)

  const hours = computed(() => toValue(zoom) === 'hours')

  // Devices with a lane in view, and those under collapsed equipment.
  const devices = computed(() => {
    const out = new Set()
    for (const r of toValue(rows)) {
      if (r.kind === 'device') out.add(r.device)
      else if (r.kind === 'equipment' && !r.open) {
        for (const x of toValue(eqDevices)[r.uuid] ?? []) out.add(x.device)
      }
    }
    return [...out].sort()
  })

  // The stretch of time in view, with the buffer either side.
  const span = computed(() => {
    const r = toValue(range), w = toValue(xWindow)
    return { from: t_of(Math.max(0, w.x0), r), to: t_of(Math.min(r.width, w.x1), r) }
  })

  async function request (list, body) {
    const out = []
    for (const part of chunk(list, LIMITS.devices)) {
      out.push([part, await fetch_series(sc.client, series_request({ ...body, devices: part }))])
    }
    return out
  }

  let busy = false
  let again = false

  async function loadStrips () {
    if (!hours.value) return
    const now = Date.now()
    const need = cache.missing(devices.value, span.value.from, Math.min(span.value.to, now + STEP), now)
    if (!need) return
    for (const [part, s] of await request(need.devices, { from: need.from, to: need.to, every: EVERY, count: true })) {
      cache.put(part, need.from, need.to, s)
    }
    tick.value++
  }

  async function loadLasts (force = false) {
    const now = Date.now()
    const stale = devices.value.filter(d => force || !lastAt.has(d) || now - lastAt.get(d) > LAST_MAX_AGE_MS)
    if (!stale.length) return
    for (const d of stale) lastAt.set(d, now)
    const to = bucket_start(now, '1h') + STEP_MS['1h']
    const got = {}
    try {
      for (const [part, s] of await request(stale, { from: to - STEP_MS['1h'], to, every: '1h', last: LAST_LOOKBACK })) {
        for (const d of part) got[d] = s.devices[d]?.last ?? (s.denied.includes(d) ? undefined : null)
      }
    }
    catch (err) {
      for (const d of stale) lastAt.delete(d)
      throw err
    }
    lasts.value = { ...lasts.value, ...got }
  }

  // The newest two buckets, for the lanes in view, when now is in view.
  async function pollTail () {
    const now = Date.now()
    if (!hours.value || now < span.value.from || now > span.value.to + STEP) return
    const from = bucket_start(now, EVERY) - STEP
    const to = from + 3 * STEP
    for (const [part, s] of await request(devices.value, { from, to, every: EVERY, count: true })) {
      cache.put(part, from, to, s)
    }
    tick.value++
  }

  async function run (fn) {
    if (busy) { again = true; return }
    busy = true
    try {
      await fn()
      error.value = null
    }
    catch (err) {
      console.warn('Datasets: timeline data failed', err)
      error.value = err?.message ?? 'The data did not load.'
    }
    finally {
      busy = false
      if (again) { again = false; schedule() }
    }
  }

  let debounce = null
  function schedule () {
    clearTimeout(debounce)
    debounce = setTimeout(() => run(async () => {
      await loadStrips()
      await loadLasts()
    }), DEBOUNCE_MS)
  }

  watch([devices, span, hours], schedule, { immediate: true })

  const poll = setInterval(() => run(async () => {
    await pollTail()
    // Hours that have ended since they were fetched, and old "quiet since".
    await loadStrips()
    await loadLasts()
  }), POLL_MS)

  onBeforeUnmount(() => {
    clearTimeout(debounce)
    clearInterval(poll)
  })

  /** Cells for a device lane, or null when strips are off. */
  function deviceCells (device) {
    void tick.value
    if (!hours.value) return null
    const r = toValue(range), w = toValue(xWindow)
    return bucket_cells(cache.get(device, span.value.from - STEP, span.value.to), {
      range: r, every: EVERY, x0: w.x0, x1: w.x1, max: cache.max(device),
    })
  }

  /** Cells for a collapsed equipment row: its devices added together. */
  function equipmentCells (uuid) {
    void tick.value
    if (!hours.value) return null
    const r = toValue(range), w = toValue(xWindow)
    const lists = (toValue(eqDevices)[uuid] ?? []).map(x => cache.get(x.device, span.value.from - STEP, span.value.to))
    return bucket_cells(sum_counts(lists), { range: r, every: EVERY, x0: w.x0, x1: w.x1 })
  }

  /** A device's newest data time: ms, null for none in 30 days, undefined if not known. */
  function lastOf (device) {
    return lasts.value[device]
  }

  return { hours, deviceCells, equipmentCells, lastOf, error }
}
