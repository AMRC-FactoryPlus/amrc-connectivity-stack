/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import { useNow } from '@vueuse/core'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { useI3xLive } from '@composables/useI3xLive.js'
import {
  LIMITS, STEP_MS, series_request, mean_entry, count_too_long,
  dataset_window, window_is_live, bucket_start, bucket_end,
  fold_live, tail_window, replace_tail, series_key,
} from '@/lib/datasets/series.js'

const MAX_TAIL_MS = 5 * 60 * 1000
const MIN_TAIL_MS = 30 * 1000
// Wait this long after a bucket closes, so late points have landed.
const SETTLE_MS = 3 * 1000
const RELOAD_DEBOUNCE_MS = 300

/**
 * One dataset's data over its window, for the Data tab charts, the
 * Overview sparklines and the devices table strips. The one place the
 * live rules (design 2.7) live, so charts and sparklines cannot drift:
 *
 * 1. Load history from POST v1/series (mean and n per bucket).
 * 2. While the window holds now, fold i3X values newer than asOf into
 *    the newest bucket, opening buckets as needed.
 * 3. When a bucket closes, and at least every 5 minutes, refetch the
 *    newest two buckets and replace them.
 *
 * @param record   ref or getter: the dataset record
 * @param entries  ref or getter: pinned_entries() to chart
 * @param opts     { points, count, last }
 */
export function useDatasetSeries (record, entries, { points = 300, count = false, last = false } = {}) {
  const sc = useServiceClientStore()
  const nowDate = useNow({ interval: 30 * 1000 })

  const series = shallowRef(null)
  const loading = ref(false)
  const error = ref(null)
  // Why the strip is missing, when the window is too long for counts.
  const countNote = ref(null)

  // "Now" for a window with no end is fixed when the page opens, so
  // store updates do not move it; live data then extends it.
  const anchor = Date.now()
  const win = computed(() => dataset_window(toValue(record), anchor))
  const live = computed(() => window_is_live(win.value, nowDate.value.getTime()))
  // The end of the time axis: a window with no end grows with now.
  const axisTo = computed(() => win.value.open ? Math.max(win.value.to, nowDate.value.getTime()) : win.value.to)

  const charted = computed(() => (toValue(entries) ?? []).slice(0, LIMITS.mean))
  const capped = computed(() => Math.max(0, (toValue(entries) ?? []).length - LIMITS.mean))
  const means = computed(() => charted.value.map(e => mean_entry(e.device, { path: e.path, type: e.type })))
  const byElement = computed(() => new Map(charted.value.filter(e => e.elementId).map(e => [e.elementId, e])))

  const wantCount = computed(() => count && !count_too_long(win.value.from, win.value.to))

  let gen = 0
  let timer = null

  function body (extra) {
    const rec = toValue(record)
    return series_request({
      dataset: rec.uuid,
      from: win.value.from,
      // A window with no end reaches to now when it loads.
      to: win.value.open ? Math.max(win.value.to, Date.now()) : win.value.to,
      points,
      count: wantCount.value,
      mean: means.value,
      last: last ? '30d' : null,
      ...extra,
    })
  }

  async function load () {
    const rec = toValue(record)
    clearTimeout(timer)
    const my = ++gen
    if (!rec?.uuid || (!means.value.length && !count && !last)) {
      series.value = null
      error.value = null
      return
    }
    countNote.value = count && !wantCount.value
      ? 'No data strip: windows longer than 14 days need a newer Data Access.'
      : null
    loading.value = true
    try {
      const s = await fetch_series(sc.client, body())
      if (my !== gen) return
      series.value = s
      error.value = null
      plan()
    }
    catch (err) {
      if (my !== gen) return
      console.error('Datasets: series request failed', err)
      error.value = err?.message ?? 'The data did not load.'
    }
    finally {
      if (my === gen) loading.value = false
    }
  }

  // Next tail refresh: when the newest bucket closes, and at least
  // every 5 minutes.
  function plan () {
    clearTimeout(timer)
    const s = series.value
    if (!s?.every || !live.value) return
    const now = Date.now()
    const close = bucket_end(bucket_start(now, s.every), s.every) + SETTLE_MS
    const wait = Math.max(MIN_TAIL_MS, Math.min(MAX_TAIL_MS, close - now))
    timer = setTimeout(refreshTail, wait)
  }

  async function refreshTail () {
    const s = series.value
    if (!s) return
    const my = gen
    const now = Date.now()
    // An ongoing window moves its end along with now.
    const to = win.value.open ? Math.max(s.to, bucket_end(bucket_start(now, s.every), s.every)) : s.to
    const t = tail_window({ ...s, to }, now)
    try {
      const tail = await fetch_series(sc.client, body({
        from: t.from,
        to,
        every: s.every,
        points: null,
        last: last ? '1d' : null,
      }))
      if (my !== gen || !series.value) return
      series.value = replace_tail({ ...series.value, to }, tail)
    }
    catch (err) {
      // The next refresh tries again; live values keep coming.
      console.warn('Datasets: refreshing the newest buckets failed', err)
    }
    if (my === gen) plan()
  }

  /* Live values from i3X. Nothing opens until there are IDs to watch. */
  const i3x = useI3xLive(items => onValues(items))
  let watching = false
  function ensureLive () {
    const ids = live.value ? [...byElement.value.keys()] : []
    if (!ids.length && !watching) return
    watching = ids.length > 0
    i3x.watch(ids)
  }

  function onValues (items) {
    const s = series.value
    if (!s?.every) return
    let changed = false
    const metrics = { ...s.metrics }
    for (const item of items) {
      const e = byElement.value.get(item?.elementId)
      if (!e) continue
      const key = series_key(e.device, e.path)
      const m = metrics[key] ?? { device: e.device, metric: e.path, type: null, unit: e.unit, points: [] }
      const pts = fold_live(m.points, Date.parse(item.timestamp), item.value, s.every, s.asOf)
      if (pts === m.points) continue
      metrics[key] = { ...m, points: pts }
      changed = true
    }
    if (changed) series.value = { ...s, metrics }
  }

  let debounce = null
  // Separate sources, so each compares by value and a store update
  // that changes nothing here does not reload.
  watch(
    [() => toValue(record)?.uuid, () => win.value.from, () => win.value.to, () => JSON.stringify(means.value)],
    () => {
      clearTimeout(debounce)
      debounce = setTimeout(load, RELOAD_DEBOUNCE_MS)
    },
    { immediate: true },
  )
  watch(live, () => { ensureLive(); plan() })
  watch(() => [...byElement.value.keys()].sort().join(','), ensureLive)
  watch(series, (s, old) => { if (s && !old) ensureLive() })

  onBeforeUnmount(() => {
    gen++
    clearTimeout(timer)
    clearTimeout(debounce)
  })

  return {
    series,
    loading,
    error,
    countNote,
    window: win,
    axisTo,
    live,
    capped,
    reload: load,
    stepMs: computed(() => STEP_MS[series.value?.every] ?? null),
  }
}
