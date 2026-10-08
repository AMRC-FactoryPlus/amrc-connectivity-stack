/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { computed, reactive, toValue } from 'vue'
import { i3x_leaf_id, metric_label, series_key, split_key, chartable } from '@/lib/datasets/series.js'

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
    clear () { set([]) },
  }
}

/**
 * What a chart or sparkline needs for each pin, from the device list:
 * { key, device, path, type, unit, label, deviceName, elementId }.
 * Pins for metrics that can no longer be charted are left out.
 */
export function pinned_entries (keys, deviceByUuid) {
  const out = []
  for (const key of keys) {
    const { device, metric: path } = split_key(key)
    const dev = deviceByUuid[device]
    const m = dev?.metrics?.find(x => x.path === path)
    if (m && !chartable(m.type)) continue
    out.push({
      key,
      device,
      path,
      type: m?.type ?? null,
      unit: m?.unit ?? null,
      label: metric_label(m?.name ?? path.split('/').pop()),
      deviceName: dev?.name ?? device.slice(0, 8),
      elementId: dev?.originMap ? i3x_leaf_id(dev.originMap, device, path) : null,
    })
  }
  return out
}
