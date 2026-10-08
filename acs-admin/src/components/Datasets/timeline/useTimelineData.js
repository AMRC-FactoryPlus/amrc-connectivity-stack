/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, onBeforeUnmount, ref, toValue, watch } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import {
  LIMITS, LAST_LOOKBACK, STEP_MS, COVERAGE_NOTE, StripCache, series_request, chunk,
  bucket_start, bucket_end, bucket_cells, sum_counts, strip_every, coverage_not_ready,
} from '@/lib/datasets/series.js'
import { t_of } from '@/lib/datasets/timeline.js'

// At Hours zoom (120 px an hour) a 5 minute bucket is a 10 px cell.
const HOURS_EVERY = '5m'
// Buckets per request, under the service's 2,000.
const MAX_BUCKETS = 1900
const DEBOUNCE_MS = 250
const POLL_MS = 60 * 1000
// The newest buckets at long zooms change slowly.
const LONG_TAIL_MS = 10 * 60 * 1000
// After "the coverage summary is not ready", ask again this much later.
const COVERAGE_RETRY_MS = 10 * 60 * 1000
// "Quiet since" is costly over 30 days, so refresh it now and then.
const LAST_MAX_AGE_MS = 3 * 60 * 1000

/**
 * Data for the timeline's device lanes: arrival strips and every
 * lane's newest data time.
 *
 * Strips are fetched for the lanes and stretch of track in view, after
 * scrolling stops. Hours zoom counts 5 minute buckets from raw data.
 * Days, Weeks and Years count 1 h, 6 h, 1 d or 1 w buckets, which the
 * coverage summary answers, coarser when the view would need more than
 * 1,900 buckets. Long requests are split so none goes over the limit.
 * Finished chunks are cached per step, so scrolling back costs nothing;
 * the newest two buckets are polled. Nothing polls while the page is
 * hidden.
 *
 * @param p.zoom      ref: the zoom id
 * @param p.range     ref: track_range()
 * @param p.xWindow   ref: visible_x() of the track
 * @param p.rows      ref: the rows in view
 * @param p.eqDevices ref: equipment uuid -> [{ device }]
 */
export function useTimelineData ({ zoom, range, xWindow, rows, eqDevices }) {
  const sc = useServiceClientStore()
  const visibility = useDocumentVisibility()
  const caches = new Map()
  const cacheFor = every => {
    if (!caches.has(every)) caches.set(every, new StripCache({ every }))
    return caches.get(every)
  }
  // Bumped when a cache changes, so cells recompute.
  const tick = ref(0)
  const lasts = ref({})
  const lastAt = new Map()
  const error = ref(null)
  // Until when long-range strips wait for the coverage summary.
  const noCoverageUntil = ref(0)

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

  // The strip step for this zoom and span.
  const every = computed(() => strip_every(toValue(zoom), span.value.from, span.value.to, MAX_BUCKETS))

  // Strips are off while long-range data waits for the coverage summary.
  const waiting = computed(() => !hours.value && noCoverageUntil.value > 0)
  const stripNote = computed(() => waiting.value ? COVERAGE_NOTE : null)

  async function request (list, body) {
    const out = []
    for (const part of chunk(list, LIMITS.devices)) {
      out.push([part, await fetch_series(sc.client, series_request({ ...body, devices: part }))])
    }
    return out
  }

  /* Run a count request. A "coverage summary not ready" answer turns
   * long-range strips off for a while, quietly, and returns false. */
  async function counts (cache, list, from, to) {
    try {
      for (const [part, s] of await request(list, { from, to, every: cache.every, count: true })) {
        cache.put(part, from, to, s)
      }
    }
    catch (err) {
      if (!coverage_not_ready(err)) throw err
      noCoverageUntil.value = Date.now() + COVERAGE_RETRY_MS
      return false
    }
    tick.value++
    return true
  }

  /* Fetch what a cache lacks for these devices over [from, to), in
   * pieces of at most MAX_BUCKETS. */
  async function fill (cache, list, from, to) {
    if (!list.length) return
    const now = Date.now()
    if (!hours.value && noCoverageUntil.value > now) return
    const step = STEP_MS[cache.every]
    const need = cache.missing(list, from, Math.min(to, now + step), now)
    if (!need) return
    for (const p of cache.pieces(need.from, need.to, MAX_BUCKETS)) {
      if (!await counts(cache, need.devices, p.from, p.to)) return
    }
  }

  function loadStrips () {
    return fill(cacheFor(every.value), devices.value, span.value.from, span.value.to)
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
  const tailAt = new Map()
  async function pollTail () {
    const now = Date.now()
    const e = every.value
    if (waiting.value || !devices.value.length) return
    if (now < span.value.from || now > span.value.to + STEP_MS[e]) return
    if (!hours.value && now - (tailAt.get(e) ?? 0) < LONG_TAIL_MS) return
    const cur = bucket_start(now, e)
    tailAt.set(e, now)
    await counts(cacheFor(e), devices.value, bucket_start(cur - 1, e), bucket_end(cur, e))
  }

  let busy = false
  let again = false
  // The selection whose counts are wanted, loaded with the strips.
  let selRange = null

  /* Run each step on its own, so one failing does not skip the rest.
   * The first failure is shown. */
  async function run (steps) {
    if (busy) { again = true; return }
    busy = true
    let failed = null
    for (const step of steps) {
      try { await step() }
      catch (err) {
        console.warn('Datasets: timeline data failed', err)
        failed ??= err
      }
    }
    error.value = failed ? (failed.message ?? 'The data did not load.') : null
    busy = false
    if (again) { again = false; schedule() }
  }

  let debounce = null
  function schedule () {
    clearTimeout(debounce)
    debounce = setTimeout(() => run([loadStrips, loadSelection, () => loadLasts()]), DEBOUNCE_MS)
  }

  watch([devices, span, every], schedule, { immediate: true })

  // Ask the coverage summary again after a while.
  let coverageTimer = null
  watch(noCoverageUntil, until => {
    clearTimeout(coverageTimer)
    if (until) coverageTimer = setTimeout(() => { noCoverageUntil.value = 0; schedule() }, Math.max(0, until - Date.now()))
  })

  function poll () {
    if (visibility.value === 'hidden') return
    // The tail, chunks that have ended since they were fetched, and old "quiet since".
    run([pollTail, loadStrips, loadSelection, () => loadLasts()])
  }
  const pollTimer = setInterval(poll, POLL_MS)
  watch(visibility, v => { if (v === 'visible') poll() })

  onBeforeUnmount(() => {
    clearTimeout(debounce)
    clearTimeout(coverageTimer)
    clearInterval(pollTimer)
  })

  /** Cells for a device lane, or null when strips are off. */
  function deviceCells (device) {
    void tick.value
    if (waiting.value) return null
    const e = every.value
    const cache = cacheFor(e)
    const r = toValue(range), w = toValue(xWindow)
    return bucket_cells(cache.get(device, span.value.from - STEP_MS[e], span.value.to), {
      range: r, every: e, x0: w.x0, x1: w.x1, max: cache.max(device),
    })
  }

  /** Cells for a collapsed equipment row: its devices added together. */
  function equipmentCells (uuid) {
    void tick.value
    if (waiting.value) return null
    const e = every.value
    const cache = cacheFor(e)
    const r = toValue(range), w = toValue(xWindow)
    const lists = (toValue(eqDevices)[uuid] ?? []).map(x => cache.get(x.device, span.value.from - STEP_MS[e], span.value.to))
    return bucket_cells(sum_counts(lists), { range: r, every: e, x0: w.x0, x1: w.x1 })
  }

  /** Load counts for these devices over [from, to), at Hours zoom. */
  function ensure (list, from, to) {
    selRange = list?.length ? { list, from, to } : null
    if (hours.value && selRange) schedule()
  }

  /* Counts for the selection, at Hours zoom: split into pieces like
   * the strips, so a long selection never asks for too many buckets. */
  async function loadSelection () {
    if (!selRange || !hours.value) return
    await fill(cacheFor(HOURS_EVERY), selRange.list, selRange.from, selRange.to)
  }

  /**
   * Counts for these devices over [from, to), as { device: rows } plus
   * the bucket size, or null at other zooms or while any are missing.
   */
  function countsFor (list, from, to) {
    void tick.value
    if (!hours.value || !list.length) return null
    const cache = cacheFor(HOURS_EVERY)
    const step = STEP_MS[HOURS_EVERY]
    const now = Date.now()
    if (cache.missing(list, from, Math.min(to, now + step), now)) return null
    return { every: HOURS_EVERY, counts: Object.fromEntries(list.map(d => [d, cache.get(d, from - step, to)])) }
  }

  /** A device's newest data time: ms, null for none in 30 days, undefined if not known. */
  function lastOf (device) {
    return lasts.value[device]
  }

  // Whether lanes show strips now.
  const strips = computed(() => !waiting.value)

  return { hours, strips, stripNote, deviceCells, equipmentCells, lastOf, ensure, countsFor, error }
}
