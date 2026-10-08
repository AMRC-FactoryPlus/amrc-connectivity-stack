/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Pure functions for the list's selection actions and the Compare
 * page. Compare shows one raw metric at a time across runs, each run
 * aligned to its own start. Tested in test/datasets-compare.test.js.
 */

import { series_of } from './energy.js'
import { resolve_devices } from './model.js'

/* ------------------------------------------------------------------
 * What the selection allows
 * ------------------------------------------------------------------ */

/** A run with both ends of its window, so it can be aligned. */
export function is_finished_run (r) {
    return r?.kind === 'run' && !!r.from && !!r.to
}

/** The ticked records that Compare uses. */
export function comparable (records) {
    return records.filter(is_finished_run)
}

/** Why Compare is not available, or null when it is. */
export function compare_problem (records) {
    if (comparable(records).length < 2) return 'Tick at least two runs that have a start and an end.'
    return null
}

/** Why the ticked records cannot become a process or part, or null. */
export function group_problem (records) {
    if (!records.length) return 'Tick at least one run.'
    if (records.some(r => r?.kind !== 'run')) return 'Only runs can be saved as a process or part.'
    return null
}

/* ------------------------------------------------------------------
 * Repeated rows in a group
 * ------------------------------------------------------------------ */

function bounds (r) {
    const f = r?.from ? Date.parse(r.from) : -Infinity
    const t = r?.to ? Date.parse(r.to) : Infinity
    return [Number.isNaN(f) ? -Infinity : f, Number.isNaN(t) ? Infinity : t]
}

/** Do two datasets' windows overlap? A missing end is open. */
export function windows_overlap (a, b) {
    const [af, at] = bounds(a)
    const [bf, bt] = bounds(b)
    // Back-to-back windows (one ends as the next starts) do not overlap.
    return af < bt && bf < at
}

/**
 * True when two items of a group reach the same device and their
 * windows overlap. The group's CSV then holds those rows twice.
 */
export function repeats_rows (items, byUuid) {
    const reach = new Map()
    for (const id of items) {
        for (const d of resolve_devices(id, byUuid).device_datasets) {
            if (!reach.has(d)) reach.set(d, [])
            reach.get(d).push(id)
        }
    }
    for (const ids of reach.values()) {
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                if (windows_overlap(byUuid[ids[i]], byUuid[ids[j]])) return true
            }
        }
    }
    return false
}

/* ------------------------------------------------------------------
 * Metrics
 * ------------------------------------------------------------------ */

export function metric_key (device, metric) {
    return `${device}\u0000${metric}`
}

/**
 * Series per metric from parsed CSV rows, keyed by metric_key. Each:
 * { device, metric, unit, points, rows }. `rows` counts every row, so
 * a metric with rows but no numeric points is not numeric.
 */
export function metric_series (rows) {
    const count = new Map()
    for (const r of rows) {
        const k = metric_key(r.device, r.metric)
        count.set(k, (count.get(k) ?? 0) + 1)
    }
    const out = new Map()
    for (const s of series_of(rows)) {
        const k = metric_key(s.device, s.metric)
        out.set(k, { ...s, rows: count.get(k) ?? 0 })
    }
    return out
}

export function is_numeric (series) {
    return !!series && series.points.length > 0
}

/** Metric keys that every run has, sorted by device then metric. */
export function common_metrics (maps) {
    if (!maps.length) return []
    const [first, ...rest] = maps
    return [...first.keys()]
        .filter(k => rest.every(m => m.has(k)))
        .sort((a, b) => a.localeCompare(b))
}

/* ------------------------------------------------------------------
 * Chart data
 * ------------------------------------------------------------------ */

/** Points as [ms since start, value] pairs, dropping any before start. */
export function align (points, start) {
    const out = []
    for (const p of points) {
        const x = p.t - start
        if (x >= 0) out.push([x, p.v])
    }
    return out
}

/**
 * Keep the shape of a long line with at most `max` points: split it
 * into max/2 buckets and keep each bucket's lowest and highest point,
 * in time order. Shorter lines come back as they are.
 */
export function downsample (pairs, max = 2000) {
    if (pairs.length <= max) return pairs
    const buckets = Math.max(1, Math.floor(max / 2))
    const size = Math.ceil(pairs.length / buckets)
    const out = []
    for (let s = 0; s < pairs.length; s += size) {
        const e = Math.min(s + size, pairs.length)
        let lo = s, hi = s
        for (let i = s + 1; i < e; i++) {
            if (pairs[i][1] < pairs[lo][1]) lo = i
            if (pairs[i][1] > pairs[hi][1]) hi = i
        }
        if (lo === hi) out.push(pairs[lo])
        else if (lo < hi) out.push(pairs[lo], pairs[hi])
        else out.push(pairs[hi], pairs[lo])
    }
    // Keep the true first and last points so the line spans the run.
    if (out[0] !== pairs[0]) out.unshift(pairs[0])
    if (out[out.length - 1] !== pairs[pairs.length - 1]) out.push(pairs[pairs.length - 1])
    return out
}

/** Elapsed time as h:mm, e.g. "0:05" or "27:10". */
export function fmt_hmm (ms) {
    const m = Math.max(0, Math.floor(ms / 60000))
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

/* ------------------------------------------------------------------
 * Line styles
 * ------------------------------------------------------------------ */

// Slate shades and dash patterns, so runs differ without colour.
export const LINE_STYLES = [
    { color: '#0f172a', type: 'solid',  dash: null },
    { color: '#64748b', type: [6, 3],   dash: '6 3' },
    { color: '#94a3b8', type: [2, 2],   dash: '2 2' },
    { color: '#334155', type: [10, 3, 2, 3], dash: '10 3 2 3' },
]

/** The style of the i-th run. Past four, styles repeat lighter. */
export function line_style (i) {
    const base = LINE_STYLES[i % LINE_STYLES.length]
    const round = Math.floor(i / LINE_STYLES.length)
    return { ...base, opacity: Math.max(0.35, 1 - round * 0.3) }
}
