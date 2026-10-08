/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { series_request, sum_counts, LAST_LOOKBACK, LIMITS } from '@/lib/datasets/series.js'
import { lane_range } from '@/lib/datasets/kiosk.js'
import { window_gaps } from '@/lib/datasets/gaps.js'

const LANE_POLL_MS = 20 * 1000
const LAST_POLL_MS = 60 * 1000
// After the first answer, "quiet since" looks back only this far. A
// device with nothing newer keeps the time it had.
const SHORT_LOOKBACK = '1h'
const LANE_EVERY = '5m'

/**
 * Data for the kiosk: arrival counts across today's lane (all the
 * equipment's devices added together, polled every 20 s), each
 * device's newest data time (polled every 60 s, with a short lookback
 * after the first answer) and the gaps in the last saved recording.
 * Nothing polls while the page is hidden.
 *
 * @param devices  getter: the equipment's device UUIDs
 * @param saved    getter: the saved summary ({ run, from, to, deviceList }) or null
 */
export function useKioskData (devices, saved) {
  const sc = useServiceClientStore()
  const visibility = useDocumentVisibility()
  // { every, counts: [[start, n]] } for the lane, or null.
  const lane = shallowRef(null)
  // device -> ms, null (nothing in 30 days); missing until known.
  const lasts = ref({})
  const lastsReady = ref(false)
  // window_gaps() for the saved recording, keyed by run.
  const savedGaps = shallowRef(null)

  const list = () => (toValue(devices) ?? []).slice(0, LIMITS.devices)

  let laneGen = 0
  async function pollLane () {
    const l = list()
    const my = ++laneGen
    if (!l.length) { lane.value = null; return }
    const r = lane_range(Date.now())
    try {
      const s = await fetch_series(sc.client, series_request({
        devices: l, from: r.from, to: r.to, every: LANE_EVERY, count: true,
      }))
      if (my !== laneGen) return
      lane.value = { every: s.every, counts: sum_counts(l.map(d => s.devices[d]?.count ?? [])) }
    }
    catch (err) {
      // Keep what we had; the next poll tries again.
      console.warn('Datasets: kiosk lane did not load', err)
    }
  }

  let lastGen = 0
  async function pollLasts () {
    const l = list()
    const my = ++lastGen
    if (!l.length) { lasts.value = {}; lastsReady.value = false; return }
    const known = lastsReady.value && l.every(d => d in lasts.value)
    const hour = Math.ceil(Date.now() / 3600e3) * 3600e3
    try {
      const s = await fetch_series(sc.client, series_request({
        devices: l, from: hour - 3600e3, to: hour, every: '1h', last: known ? SHORT_LOOKBACK : LAST_LOOKBACK,
      }))
      if (my !== lastGen) return
      const got = {}
      for (const d of l) {
        if (s.denied.includes(d)) continue
        const t = s.devices[d]?.last ?? null
        got[d] = t == null && known ? (lasts.value[d] ?? null) : t
      }
      lasts.value = got
      lastsReady.value = true
    }
    catch (err) {
      console.warn('Datasets: kiosk quiet since did not load', err)
    }
  }

  const hidden = () => visibility.value === 'hidden'
  const laneTimer = setInterval(() => { if (!hidden()) pollLane() }, LANE_POLL_MS)
  const lastTimer = setInterval(() => { if (!hidden()) pollLasts() }, LAST_POLL_MS)
  watch(visibility, v => { if (v === 'visible') { pollLane(); pollLasts() } })
  watch(() => (toValue(devices) ?? []).join(','), () => {
    lastsReady.value = false
    lasts.value = {}
    pollLane()
    pollLasts()
  }, { immediate: true })

  let savedGen = 0
  watch(() => toValue(saved)?.run ?? null, async () => {
    const s = toValue(saved)
    const my = ++savedGen
    savedGaps.value = null
    const list = s?.deviceList ?? []
    const from = Date.parse(s?.from), to = Date.parse(s?.to)
    if (!s?.run || !list.length || !(from < to)) return
    try {
      const res = await fetch_series(sc.client, series_request({ devices: list, from, to, points: 120, count: true }))
      if (my !== savedGen) return
      const counts = {}
      for (const d of list) if (!res.denied.includes(d)) counts[d] = res.devices[d]?.count ?? []
      savedGaps.value = window_gaps(counts, { from, to, every: res.every, now: res.asOf })
    }
    catch (err) {
      console.warn('Datasets: gaps in the saved recording did not load', err)
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    laneGen++
    lastGen++
    savedGen++
    clearInterval(laneTimer)
    clearInterval(lastTimer)
  })

  return { lane, lasts, lastsReady, savedGaps }
}
