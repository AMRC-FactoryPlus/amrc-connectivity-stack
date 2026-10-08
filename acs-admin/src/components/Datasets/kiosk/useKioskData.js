/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { series_request, sum_counts, LAST_LOOKBACK, LIMITS } from '@/lib/datasets/series.js'
import { lane_range } from '@/lib/datasets/kiosk.js'
import { window_gaps } from '@/lib/datasets/gaps.js'

const POLL_MS = 20 * 1000
const LANE_EVERY = '5m'

/**
 * Data for the kiosk: arrival counts across today's lane (all the
 * equipment's devices added together), each device's newest data time,
 * polled every 20 s, and the gaps in the last saved recording.
 *
 * @param devices  getter: the equipment's device UUIDs
 * @param saved    getter: the saved summary ({ run, from, to, deviceList }) or null
 */
export function useKioskData (devices, saved) {
  const sc = useServiceClientStore()
  // { every, counts: [[start, n]] } for the lane, or null.
  const lane = shallowRef(null)
  // device -> ms, null (nothing in 30 days); missing until known.
  const lasts = ref({})
  const lastsReady = ref(false)
  // window_gaps() for the saved recording, keyed by run.
  const savedGaps = shallowRef(null)

  let gen = 0
  async function poll () {
    const list = (toValue(devices) ?? []).slice(0, LIMITS.devices)
    const my = ++gen
    if (!list.length) { lane.value = null; lasts.value = {}; lastsReady.value = false; return }
    const r = lane_range(Date.now())
    try {
      const s = await fetch_series(sc.client, series_request({
        devices: list, from: r.from, to: r.to, every: LANE_EVERY, count: true, last: LAST_LOOKBACK,
      }))
      if (my !== gen) return
      lane.value = { every: s.every, counts: sum_counts(list.map(d => s.devices[d]?.count ?? [])) }
      const got = {}
      for (const d of list) if (!s.denied.includes(d)) got[d] = s.devices[d]?.last ?? null
      lasts.value = got
      lastsReady.value = true
    }
    catch (err) {
      // Keep what we had; the next poll tries again.
      console.warn('Datasets: kiosk data did not load', err)
    }
  }

  const timer = setInterval(poll, POLL_MS)
  watch(() => (toValue(devices) ?? []).join(','), () => {
    lastsReady.value = false
    poll()
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
    gen++
    savedGen++
    clearInterval(timer)
  })

  return { lane, lasts, lastsReady, savedGaps }
}
