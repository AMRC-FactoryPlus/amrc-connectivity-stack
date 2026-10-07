/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Metric selection for Sub-device datasets. Plain functions, so the
 * dialog's logic can be tested without mounting it.
 */

/* Matches MAX_METRICS in acs-data-access/lib/sparkplug-subset-handler.js */
export const MAX_SUBSET_METRICS = 500

/* A Sub-device metric reference is { instance, metric }. The instance is
 * a UUID, which never contains '/', so the key splits unambiguously. */
export function metric_key (ref) {
  return `${ref.instance}/${ref.metric}`
}

export function key_to_ref (key) {
  return { instance: key.slice(0, 36), metric: key.slice(37) }
}

/** Groups a device's metrics (from DataAccess.get_device_metrics) by the
 * object (Instance_UUID) they belong to, keeping origin-map order. Each
 * group carries the object's path ('' for the device itself); each metric
 * gains its `key` and a `name`, its path within the object. */
export function group_metrics (metrics) {
  const groups = new Map()
  for (const m of metrics) {
    if (!groups.has(m.instance)) {
      const path = m.path.slice(0, Math.max(0, m.path.length - m.metric.length - 1))
      groups.set(m.instance, { instance: m.instance, path, metrics: [] })
    }
    groups.get(m.instance).metrics.push({ ...m, key: metric_key(m), name: m.metric })
  }
  return [...groups.values()]
}

/** Keeps the metrics whose full path contains `query`, ignoring case,
 * and drops groups left empty. */
export function filter_groups (groups, query) {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map(g => ({ ...g, metrics: g.metrics.filter(m => m.path.toLowerCase().includes(q)) }))
    .filter(g => g.metrics.length)
}

/** Selected keys the device no longer offers, usually after a schema
 * change. */
export function missing_keys (selected, metrics) {
  const known = new Set(metrics.map(metric_key))
  return selected.filter(k => !known.has(k))
}

/** Header checkbox state for a group: true if all its metrics are
 * selected, false if none, 'indeterminate' otherwise. */
export function group_state (group, selected_set) {
  const n = group.metrics.filter(m => selected_set.has(m.key)).length
  if (n === 0) return false
  return n === group.metrics.length ? true : 'indeterminate'
}

/** Returns `selected` with all of the group's metrics added or removed. */
export function set_group (selected, group, checked) {
  const keys = new Set(group.metrics.map(m => m.key))
  const rest = selected.filter(k => !keys.has(k))
  return checked ? [...rest, ...keys] : rest
}
