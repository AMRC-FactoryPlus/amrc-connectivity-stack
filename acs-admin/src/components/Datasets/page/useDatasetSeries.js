/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import { useDocumentVisibility, useNow } from '@vueuse/core'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { useI3xLive } from '@composables/useI3xLive.js'
import {
  LIMITS, STEP_MS, COVERAGE_NOTE, series_request, mean_entry, count_too_long,
  dataset_window, window_is_live, bucket_start, bucket_end, mean_window,
  append_live_items, tail_window, replace_tail, coverage_every, coverage_not_ready,
  stray_mean_device, every_for_width,
} from '@/lib/datasets/series.js'

const MAX_TAIL_MS = 5 * 60 * 1000
const MIN_TAIL_MS = 30 * 1000
// Wait this long after a bucket closes, so late points have landed.
const SETTLE_MS = 3 * 1000
const RELOAD_DEBOUNCE_MS = 300
// A chart width that changes the bucket size loads again after this.
const RESIZE_DEBOUNCE_MS = 500
// A window with no end moves its "now" forward this often.
const ANCHOR_MS = 15 * 60 * 1000
// Long-range strips for a live window are fetched again this often.
const LONG_COUNT_MS = 10 * 60 * 1000
// Buckets for a long-range strip: enough for gaps, cheap to read.
const LONG_COUNT_BUCKETS = 1000

/**
 * One dataset's data over its window, for the Data tab charts, the
 * Overview sparklines and the devices table strips. The one place the
 * live rules (design 2.7) live, so charts and sparklines cannot drift:
 *
 * 1. Load history from POST v1/series (mean and n per bucket), with
 *    about one bucket per pixel of chart width.
 * 2. While the window holds now, keep i3X values newer than asOf as a
 *    raw tail per metric, drawn at full resolution after the buckets.
 * 3. When a bucket closes, and at least every 5 minutes, refetch the
 *    newest two buckets and replace them. Raw values the refetched
 *    buckets now count are dropped from the tail.
 *
 * Charts cover at most the most recent 400 days of the window. Strips
 * for windows over 14 days come from the coverage summary in a request
 * of their own, so the charts load even while the summary is being
 * built. Nothing polls while the page is hidden.
 *
 * @param record   ref or getter: the dataset record
 * @param entries  ref or getter: pinned_entries() to chart
 * @param opts     { width, count, last }: `width` is a ref or getter
 *                 for the chart's width in px, which sets the bucket size
 */
export function useDatasetSeries (record, entries, { width = 600, count = false, last = false } = {}) {
  const sc = useServiceClientStore()
  // Ticks every second, so a live axis reaches now as values arrive.
  const nowDate = useNow({ interval: 1000 })
  const visibility = useDocumentVisibility()
  const hidden = () => visibility.value === 'hidden'

  const series = shallowRef(null)
  const loading = ref(false)
  const error = ref(null)
  // Why the strip is missing, when there is a reason to say.
  const countNote = ref(null)
  // Counts from the coverage summary, for windows over 14 days.
  const longCounts = shallowRef(null)

  // "Now" for a window with no end. It moves forward now and then, so
  // a page left open keeps showing the most recent day; live data
  // extends the axis in between.
  const anchor = ref(Date.now())
  const win = computed(() => dataset_window(toValue(record), anchor.value))
  const live = computed(() => window_is_live(win.value, nowDate.value.getTime()))
  // The end of the time axis: a window with no end grows with now.
  const axisTo = computed(() => win.value.open ? Math.max(win.value.to, nowDate.value.getTime()) : win.value.to)

  // Devices the service said are not in the dataset: left out of `mean`.
  const stray = ref(new Set())
  const charted = computed(() => (toValue(entries) ?? []).filter(e => !stray.value.has(e.device)).slice(0, LIMITS.mean))
  const capped = computed(() => Math.max(0, (toValue(entries) ?? []).length - LIMITS.mean))
  const means = computed(() => charted.value.map(e => mean_entry(e.device, { path: e.path, type: e.type })))
  const byElement = computed(() => new Map(charted.value.filter(e => e.elementId).map(e => [e.elementId, e])))

  const longWindow = computed(() => count_too_long(win.value.from, win.value.to))
  // Counts ride along with the charts only for windows up to 14 days.
  const wantCount = computed(() => count && !longWindow.value)
  // Charts cover at most the last 400 days of the window.
  const chartSpan = computed(() => means.value.length
    ? mean_window(win.value.from, win.value.to)
    : { from: win.value.from, to: win.value.to, clamped: false })
  // About one bucket per pixel of chart width.
  const every = computed(() => every_for_width(chartSpan.value.from, win.value.to, toValue(width)))
  const meanNote = computed(() => chartSpan.value.clamped
    ? 'Charts show the most recent 400 days of this window.'
    : null)

  let gen = 0
  let timer = null

  // A window with no end reaches to now when it loads.
  const reqTo = () => win.value.open ? Math.max(win.value.to, Date.now()) : win.value.to

  function body (extra) {
    const rec = toValue(record)
    return series_request({
      dataset: rec.uuid,
      from: chartSpan.value.from,
      to: reqTo(),
      every: every.value,
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
    if (!longWindow.value) {
      longCounts.value = null
      countNote.value = null
    }
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
      // A pinned device left the dataset: chart the rest. Changing
      // `means` loads again.
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
    if (my === gen && count && longWindow.value) loadLongCounts()
  }

  /* Strips for a window over 14 days, from the coverage summary. */
  let longGen = 0
  let longAt = 0
  async function loadLongCounts () {
    const rec = toValue(record)
    if (!rec?.uuid || !count || !longWindow.value) return
    const my = ++longGen
    const from = win.value.from, to = reqTo()
    const every = coverage_every(from, to, { max: LONG_COUNT_BUCKETS })
    longAt = Date.now()
    try {
      const s = await fetch_series(sc.client, series_request({ dataset: rec.uuid, from, to, every, count: true }))
      if (my !== longGen) return
      longCounts.value = s
      countNote.value = null
    }
    catch (err) {
      if (my !== longGen) return
      longCounts.value = null
      if (coverage_not_ready(err)) countNote.value = COVERAGE_NOTE
      else {
        console.warn('Datasets: long-range strips did not load', err)
        countNote.value = err?.message ?? 'The data strips did not load.'
      }
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
    clearTimeout(timer)
    const s = series.value
    if (!s) return
    // Hidden: the visibility watch below starts again when it is seen.
    if (hidden()) return
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
        last: last ? '1d' : null,
      }))
      if (my !== gen || !series.value) return
      series.value = replace_tail({ ...series.value, to }, tail)
    }
    catch (err) {
      // The next refresh tries again; live values keep coming.
      console.warn('Datasets: refreshing the newest buckets failed', err)
    }
    if (my !== gen) return
    plan()
    if (count && longWindow.value && live.value && Date.now() - longAt > LONG_COUNT_MS) loadLongCounts()
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
    const next = append_live_items(s, items, id => byElement.value.get(id))
    if (next !== s) series.value = next
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
  // A new chart width that changes the bucket size loads again, once
  // the resizing has settled.
  watch(every, (e, old) => {
    if (e === old || !toValue(record)?.uuid) return
    clearTimeout(debounce)
    debounce = setTimeout(load, RESIZE_DEBOUNCE_MS)
  })
  watch(live, () => { ensureLive(); plan() })
  watch(() => [...byElement.value.keys()].sort().join(','), ensureLive)
  watch(series, (s, old) => { if (s && !old) ensureLive() })
  // Back in view: repair what was missed while hidden.
  watch(visibility, v => { if (v === 'visible' && series.value && live.value) refreshTail() })

  const anchorTimer = setInterval(() => {
    if (hidden()) return
    const w = win.value
    if (w.windowless || w.open) anchor.value = Date.now()
  }, ANCHOR_MS)

  onBeforeUnmount(() => {
    gen++
    longGen++
    clearTimeout(timer)
    clearTimeout(debounce)
    clearInterval(anchorTimer)
  })

  /* What a strip shows: counts with their windows, from the main
   * answer or, for long windows, from the coverage summary. Null when
   * there are none. */
  const strips = computed(() => {
    if (!count) return null
    const s = longWindow.value ? longCounts.value : series.value
    return s?.every ? s : null
  })

  return {
    series,
    strips,
    loading,
    error,
    countNote,
    meanNote,
    window: win,
    axisTo,
    now: computed(() => nowDate.value.getTime()),
    live,
    capped,
    reload: load,
    stepMs: computed(() => STEP_MS[series.value?.every] ?? null),
  }
}
