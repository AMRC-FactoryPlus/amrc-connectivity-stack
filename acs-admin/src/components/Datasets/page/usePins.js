/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, reactive, toValue, watch } from 'vue'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { series_key, split_key } from '@/lib/datasets/series.js'
import { pinned_entries, stale_pins } from './page-logic.js'

export { pinned_entries, stale_pins }

/*
 * Pinned metrics per dataset, kept in this browser. Pins are series
 * keys (device UUID and full metric name). They change the Data tab,
 * the Overview sparklines and the pinned-only download, never the
 * dataset.
 */

const STORE_KEY = 'acs-admin.datasets.pins'

function load () {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  }
  catch { return {} }
}

// Shared by every page that shows pins, so the tabs agree.
const all = reactive(load())

function save () {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all)) }
  catch { /* storage blocked: pins last until the page closes */ }
}

/** Pins for one dataset. `uuid` is a ref or getter. */
export function usePins (uuid) {
  const keys = computed(() => {
    const v = all[toValue(uuid)]
    return Array.isArray(v) ? v.filter(k => typeof k === 'string' && split_key(k)) : []
  })

  function set (list) {
    const id = toValue(uuid)
    if (!id) return
    if (list.length) all[id] = list
    else delete all[id]
    save()
  }

  return {
    keys,
    has: key => keys.value.includes(key),
    toggle (device, path) {
      const k = series_key(device, path)
      set(keys.value.includes(k) ? keys.value.filter(x => x !== k) : [...keys.value, k])
    },
    unpin (key) { set(keys.value.filter(x => x !== key)) },
    /** Drop these keys without a word: used for pins that went stale. */
    forget (list) {
      const drop = new Set(list)
      if (keys.value.some(k => drop.has(k))) set(keys.value.filter(k => !drop.has(k)))
    },
    clear () { set([]) },
  }
}

/**
 * Pins and chart entries for a dataset page tab. Entries leave out
 * pins for devices the dataset no longer covers, so one stale pin
 * cannot make the whole request fail. Once the dataset's devices are
 * fully known, those pins are forgotten.
 *
 * @param record   ref or getter: the dataset record
 * @param resolved ref or getter: ds.devicesOf() for it
 */
export function useDatasetPins (record, resolved) {
  const ds = useDatasetsStore()
  const pins = usePins(() => toValue(record)?.uuid)
  // The dataset's devices, or null when the structure is hidden.
  const devices = computed(() => toValue(record)?.structure ? (toValue(resolved)?.devices ?? []) : null)
  const entries = computed(() => pinned_entries(pins.keys.value, ds.deviceByUuid, devices.value))

  watch(() => [pins.keys.value, devices.value, ds.ready, toValue(resolved)?.unknown?.length ?? 0], () => {
    // Forget only when every part of the dataset is known.
    if (!devices.value?.length || !ds.ready || toValue(resolved)?.unknown?.length) return
    const stale = stale_pins(pins.keys.value, devices.value)
    if (stale.length) pins.forget(stale)
  }, { immediate: true })

  return { pins, entries }
}
