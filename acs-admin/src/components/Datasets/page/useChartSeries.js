/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import { useDocumentVisibility, useNow } from '@vueuse/core'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { useI3xLive } from '@composables/useI3xLive.js'
import {
  LIMITS, STEP_MS, SeriesCache, series_request, mean_entry, count_too_long,
  dataset_window, window_is_live, bucket_start, bucket_end, every_for_width,
  append_live_items, display_rows, live_mode, stray_mean_device, TAIL_REFRESH_MS,
} from '@/lib/datasets/series.js'

// Buckets fetched before the view, so a value that holds from earlier
// shows from the left edge.
const LEAD_BUCKETS = 60
// Wait this long after a bucket closes, so late points have landed.
const SETTLE_MS = 3 * 1000
const MIN_TAIL_MS = 10 * 1000
const LOAD_DEBOUNCE_MS = 300

/**
 * Pinned metrics over a range, for the Data tab charts and the Overview
 * sparklines. The one place the chart and live rules live:
 *
 * 1. Bucket means for the range in view, about one bucket per pixel of
 *    chart width, from POST v1/series. Finished chunks are cached per
 *    bucket size, so panning back costs nothing.
 * 2. While the view includes now, the newest buckets are refetched as
 *    each closes (at least every 5 minutes): the line keeps moving at
 *    any zoom.
 * 3. Only when buckets are 30 s or less, i3X values are drawn as they
 *    arrive (a raw tail per metric). Otherwise nothing is subscribed.
 * 4. Metrics sent on change hold their value between changes while the
 *    device is sending (display_rows).
 *
 * @param record   ref or getter: the dataset record
 * @param entries  ref or getter: pinned_entries() to chart
 * @param opts     { view, width }: `view` is a ref or getter for the
 *                 range in view ({ from, to }), or null for the
 *                 dataset's window; `width` for the chart's px width
 */
export function useChartSeries (record, entries, { view = null, width = 600 } = {}) {
  const sc = useServiceClientStore()
  const nowDate = useNow({ interval: 1000 })
  const now = computed(() => nowDate.value.getTime())
  const visibility = useDocumentVisibility()
  const hidden = () => visibility.value === 'hidden'

  const loading = ref(false)
  const error = ref(null)

  const win = computed(() => dataset_window(toValue(record), now.value))
  const windowLive = computed(() => window_is_live(win.value, now.value))

  // The range in view, at most the 400 days the service charts.
  const range = computed(() => {
    const v = toValue(view) ?? win.value
    const from = Math.max(v.from, v.to - LIMITS.mean_span)
    return { from, to: v.to, clamped: from > v.from }
  })
  const every = computed(() => every_for_width(range.value.from, range.value.to, toValue(width)))
  const step = computed(() => STEP_MS[every.value])
  const mode = computed(() => live_mode(range.value, every.value, now.value, windowLive.value))

  const stray = ref(new Set())
  const charted = computed(() => (toValue(entries) ?? []).filter(e => !stray.value.has(e.device)).slice(0, LIMITS.mean))
  const capped = computed(() => Math.max(0, (toValue(entries) ?? []).length - LIMITS.mean))
  const means = computed(() => charted.value.map(e => mean_entry(e.device, { path: e.path, type: e.type })))
  const meansKey = computed(() => JSON.stringify(means.value))
  const keys = computed(() => charted.value.map(e => e.key))
  const byElement = computed(() => new Map(charted.value.filter(e => e.elementId).map(e => [e.elementId, e])))

  /* The cache: one per bucket size, all cleared when the pins change. */
  let caches = new Map()
  let cachedFor = null
  const tick = ref(0)
  function cacheFor (e) {
    if (cachedFor !== `${toValue(record)?.uuid}|${meansKey.value}`) {
      caches = new Map()
      cachedFor = `${toValue(record)?.uuid}|${meansKey.value}`
      tails.value = { asOf: -Infinity, every: e, devices: {}, metrics: {} }
    }
    if (!caches.has(e)) caches.set(e, new SeriesCache(e))
    return caches.get(e)
  }

  // Raw live values, per metric, in the shape append_live_items takes.
  const tails = shallowRef({ asOf: -Infinity, every: '10s', devices: {}, metrics: {} })

  function request (from, to, e, extra = {}) {
    return series_request({
      dataset: toValue(record).uuid,
      from, to, every: e,
      mean: means.value,
      // Counts tell when a device sent anything, for values sent on change.
      count: !count_too_long(from, to),
      ...extra,
    })
  }

  let gen = 0
  async function load () {
    const rec = toValue(record)
    const my = ++gen
    if (!rec?.uuid || !means.value.length) { error.value = null; return }
    const e = every.value
    const cache = cacheFor(e)
    const s = STEP_MS[e]
    const from = range.value.from - LEAD_BUCKETS * s
    const n = Date.now()
    const need = cache.missing(from, Math.min(range.value.to, n + s), n)
    if (!need) { plan(); return }
    loading.value = true
    try {
      for (const p of cache.pieces(need.from, need.to)) {
        const ans = await fetch_series(sc.client, request(p.from, p.to, e))
        if (my !== gen) return
        cache.put(p.from, p.to, ans, { keys: keys.value, counted: !count_too_long(p.from, p.to) })
        trimTails(cache.asOf)
        tick.value++
      }
      error.value = null
    }
    catch (err) {
      if (my !== gen) return
      // A pinned device left the dataset: chart the rest.
      const d = stray_mean_device(err)
      if (d && !stray.value.has(d)) {
        stray.value = new Set([...stray.value, d])
        return
      }
      console.error('Datasets: series request failed', err)
      error.value = err?.message ?? 'The data did not load.'
    }
    finally {
      if (my === gen) loading.value = false
    }
    if (my === gen) plan()
  }

  /* The newest buckets, while the view includes now. */
  let timer = null
  function plan () {
    clearTimeout(timer)
    if (!mode.value.live || !means.value.length) return
    const n = Date.now()
    const close = bucket_end(bucket_start(n, every.value), every.value) + SETTLE_MS
    const wait = Math.max(MIN_TAIL_MS, Math.min(TAIL_REFRESH_MS, close - n))
    timer = setTimeout(refreshTail, wait)
  }

  async function refreshTail () {
    clearTimeout(timer)
    if (hidden() || !mode.value.live) return
    const my = gen
    const e = every.value
    const cache = cacheFor(e)
    const n = Date.now()
    const cur = bucket_start(n, e)
    const from = bucket_start(cur - 1, e), to = bucket_end(cur, e)
    try {
      const ans = await fetch_series(sc.client, request(from, to, e))
      if (my !== gen || cache !== caches.get(e)) return
      cache.put(from, to, ans, { keys: keys.value, final: false, counted: true })
      trimTails(cache.asOf)
      tick.value++
    }
    catch (err) {
      console.warn('Datasets: refreshing the newest buckets failed', err)
    }
    if (my === gen) plan()
  }

  /* Raw values the buckets now count are dropped from the tails. */
  function trimTails (asOf) {
    const t = tails.value
    if (!(asOf > t.asOf)) return
    const metrics = {}
    for (const [k, m] of Object.entries(t.metrics)) metrics[k] = { ...m, tail: (m.tail ?? []).filter(r => r[0] > asOf) }
    tails.value = { ...t, asOf, metrics }
  }

  /* i3X, only while streaming. */
  const i3x = useI3xLive(items => {
    if (!mode.value.stream) return
    const next = append_live_items({ ...tails.value, every: every.value }, items, id => byElement.value.get(id))
    if (next.metrics !== tails.value.metrics) tails.value = { ...tails.value, metrics: next.metrics }
  })
  let watching = false
  function ensureLive () {
    const ids = mode.value.stream ? [...byElement.value.keys()] : []
    if (!ids.length && !watching) return
    watching = ids.length > 0
    i3x.watch(ids)
    if (!ids.length) tails.value = { ...tails.value, metrics: {} }
  }

  let debounce = null
  function schedule () {
    clearTimeout(debounce)
    debounce = setTimeout(load, LOAD_DEBOUNCE_MS)
  }
  // Moves within one bucket do not load again.
  watch(
    [() => toValue(record)?.uuid, meansKey, every,
      () => Math.floor(range.value.from / step.value), () => Math.floor(range.value.to / step.value)],
    schedule,
    { immediate: true },
  )
  watch(() => mode.value.live, live => { if (live) refreshTail(); else clearTimeout(timer) })
  watch([() => mode.value.stream, () => [...byElement.value.keys()].sort().join(',')], ensureLive, { immediate: true })
  watch(visibility, v => { if (v === 'visible' && mode.value.live) refreshTail() })

  onBeforeUnmount(() => {
    gen++
    clearTimeout(timer)
    clearTimeout(debounce)
  })

  /* What the charts draw. */
  const series = computed(() => {
    void tick.value
    const e = every.value
    const cache = caches.get(e)
    if (!cache || cachedFor !== `${toValue(record)?.uuid}|${meansKey.value}`) return null
    const s = cache.view(range.value.from - LEAD_BUCKETS * step.value, range.value.to, keys.value)
    for (const [k, m] of Object.entries(s.metrics)) {
      const t = tails.value.metrics[k]?.tail
      if (t?.length) s.metrics[k] = { ...m, tail: t }
    }
    return s
  })

  /** { rows, step } for one pinned metric. */
  function display (key) {
    const s = series.value
    const m = s?.metrics[key]
    if (!m) return { rows: [], step: false }
    const cache = caches.get(s.every)
    const n = now.value
    // The device's newest data: its newest bucket, raw value or mean.
    let newest = cache?.newest(m.device) ?? null
    for (const x of Object.values(s.metrics)) {
      if (x.device !== m.device) continue
      const t = x.tail?.at(-1)?.[0]
      if (t != null && (newest == null || t > newest)) newest = t
      const p = x.points.at(-1)?.[0]
      if (p != null && (newest == null || bucket_end(p, s.every) > newest)) newest = bucket_end(p, s.every)
    }
    const until = Math.min(n, range.value.to, newest ?? -Infinity)
    const counted = cache?.has_counts(range.value.from - LEAD_BUCKETS * step.value, Math.min(range.value.to, n))
    const active = counted
      ? t => cache.active(m.device, t)
      : t => newest != null && t < newest
    return display_rows(m, s.every, { active, until })
  }

  return {
    series,
    display,
    loading,
    error,
    range,
    every,
    window: win,
    now,
    live: computed(() => mode.value.live),
    stream: computed(() => mode.value.stream),
    hint: computed(() => mode.value.hint),
    capped,
    meanNote: computed(() => range.value.clamped ? 'Charts show at most 400 days at once.' : null),
    reload: load,
  }
}
