/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Gaps, coverage and data rate, worked out from the arrival counts
 * that POST v1/series returns (sparse [bucket start, n] rows per
 * device). Used by the timeline selection card, the dataset page, the
 * builder preview, the device picker and the kiosk.
 *
 * Nothing here talks to a service. Tested in test/datasets-gaps.test.js.
 */

import { STEP_MS, bucket_start, bucket_end, bucket_total } from './series.js'
import { fmt_clock, fmt_duration } from './model.js'

/**
 * The buckets that cover [from, min(to, now)): their start times, in
 * order. Buckets that start at or after `now` have no data yet and are
 * left out.
 */
export function bucket_grid (from, to, every, now = Infinity) {
    const out = []
    if (!STEP_MS[every]) return out
    const end = Math.min(to, now)
    for (let t = bucket_start(from, every); t < end; t = bucket_end(t, every)) out.push(t)
    return out
}

function median (list) {
    if (!list.length) return null
    const s = list.slice().sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * How many buckets normally pass from one bucket with data to the
 * next, for a device: the median spacing of its non-empty buckets. A
 * device that sends every few seconds has a spacing of 1; one that
 * sends every 15 minutes, counted in 5 minute buckets, has 3.
 * `filled` are the indexes of non-empty buckets, in order.
 */
export function normal_spacing (filled) {
    if (filled.length < 2) return 1
    const diffs = []
    for (let i = 1; i < filled.length; i++) diffs.push(filled[i] - filled[i - 1])
    return Math.max(1, median(diffs))
}

/* How much of [a, b) falls inside the spans. */
function overlap (a, b, spans) {
    let n = 0
    for (const [x, y] of spans) n += Math.max(0, Math.min(b, y) - Math.max(a, x))
    return n
}

/**
 * One device's gaps over a window. A gap is a run of empty buckets
 * longer than the device's normal spacing, and at least 2 buckets
 * long. Runs before the first data and after the last count too.
 *
 * `windows` ([[from, to]], optional) are the times the device belongs
 * to the dataset. Buckets wholly outside them are neither data nor
 * gap: they are left out of the grid, and a gap never runs across them.
 *
 * Returns {
 *   grid,     bucket starts in the window (up to now, inside windows)
 *   empty,    Set of grid indexes inside a gap
 *   emptyAt,  Set of bucket starts inside a gap
 *   gaps,     [{ from, to, i0, i1 }] with i1 exclusive
 *   points,   points counted in the window
 *   spacing,  normal spacing in buckets
 *   sending,  ms of the window, inside windows and before now, in
 *             buckets not in a gap. Partial first and last buckets
 *             count only the part that has elapsed.
 * }
 */
export function device_gaps (counts, { from, to, every, now = Infinity, windows = null }) {
    const end = Math.min(to, now)
    const spans = (windows ?? [[from, to]])
        .map(([a, b]) => [Math.max(a, from), Math.min(b, end)])
        .filter(([a, b]) => a < b)
    const grid = bucket_grid(from, to, every, now)
        .filter(t => spans.some(([a, b]) => t < b && bucket_end(t, every) > a))
    const index = new Map(grid.map((t, i) => [t, i]))
    const has = new Array(grid.length).fill(false)
    let points = 0
    for (const [t, n] of counts ?? []) {
        if (!(n > 0)) continue
        const i = index.get(t) ?? index.get(bucket_start(t, every))
        if (i == null) continue
        has[i] = true
        points += n
    }
    const filled = []
    has.forEach((h, i) => { if (h) filled.push(i) })
    const spacing = normal_spacing(filled)

    // A run of empty buckets ends where the grid skips time outside the windows.
    const joined = i => i > 0 && bucket_end(grid[i - 1], every) === grid[i]

    const gaps = []
    const empty = new Set()
    let i = 0
    while (i < grid.length) {
        if (has[i]) { i++; continue }
        let j = i + 1
        while (j < grid.length && !has[j] && joined(j)) j++
        const k = j - i
        if (k >= 2 && k > spacing) {
            gaps.push({ from: grid[i], to: bucket_end(grid[j - 1], every), i0: i, i1: j })
            for (let x = i; x < j; x++) empty.add(x)
        }
        i = j
    }

    let sending = 0
    grid.forEach((t, x) => { if (!empty.has(x)) sending += overlap(t, bucket_end(t, every), spans) })

    return { grid, empty, emptyAt: new Set([...empty].map(x => grid[x])), gaps, points, spacing, sending }
}

/**
 * Gaps across several devices over one window.
 *
 * A stretch where most devices (more than half of those inside their
 * windows then, and at least two) are in a gap at the same time counts
 * as one gap for all of them, not one per device. The part of a device
 * gap inside such a stretch is folded into it; what is left outside
 * still counts when it is long enough to be a gap on its own.
 *
 * `counts` is { [device]: rows }. Every device in it is counted, with
 * missing or empty rows meaning no data. `windows` is an optional
 * { [device]: [[from, to]] }, as a dataset answer gives them.
 *
 * Returns {
 *   total,     gaps to report: shared stretches plus the rest
 *   shared,    [{ from, to }] stretches most devices missed
 *   devices,   { [device]: device_gaps() result }
 *   own,       { [device]: gaps, or parts of gaps, outside the shared stretches }
 *   coverage,  share of device buckets not in a gap (0 to 1), or null
 *              when the window has not started
 * }
 */
export function window_gaps (counts, { from, to, every, now = Infinity, windows = null }) {
    const ids = Object.keys(counts ?? {})
    const devices = {}
    for (const id of ids) devices[id] = device_gaps(counts[id], { from, to, every, now, windows: windows?.[id] ?? null })
    const grid = bucket_grid(from, to, every, now)
    const inGrid = Object.fromEntries(ids.map(id => [id, new Set(devices[id].grid)]))

    // Stretches most devices missed.
    const shared = []
    let start = null
    for (let i = 0; i <= grid.length; i++) {
        let most = false
        if (i < grid.length) {
            const t = grid[i]
            const active = ids.filter(id => inGrid[id].has(t))
            const missing = active.filter(id => devices[id].emptyAt.has(t)).length
            most = active.length >= 2 && missing * 2 > active.length
        }
        if (most && start == null) start = i
        if (!most && start != null) {
            shared.push({ from: grid[start], to: bucket_end(grid[i - 1], every), i0: start, i1: i })
            start = null
        }
    }

    // A device's gaps less the shared stretches. What is left of a
    // longer outage still counts, if it would count as a gap on its own.
    const own = {}
    let total = shared.length
    for (const id of ids) {
        const counts_as_gap = (a, b) => {
            const k = bucket_total(a, b, every)
            return k >= 2 && k > devices[id].spacing
        }
        own[id] = devices[id].gaps.flatMap(g => {
            let pieces = [{ from: g.from, to: g.to }]
            for (const sh of shared) {
                pieces = pieces.flatMap(p => {
                    if (sh.to <= p.from || sh.from >= p.to) return [p]
                    const out = []
                    if (sh.from > p.from) out.push({ from: p.from, to: sh.from })
                    if (sh.to < p.to) out.push({ from: sh.to, to: p.to })
                    return out
                })
            }
            if (pieces.length === 1 && pieces[0].from === g.from && pieces[0].to === g.to) return [g]
            return pieces.filter(p => counts_as_gap(p.from, p.to))
        })
        total += own[id].length
    }

    let cells = 0, covered = 0
    for (const id of ids) {
        cells += devices[id].grid.length
        covered += devices[id].grid.length - devices[id].empty.size
    }
    return { total, shared, devices, own, coverage: cells ? covered / cells : null }
}

/* ------------------------------------------------------------------
 * Words
 * ------------------------------------------------------------------ */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "No gaps in this window" or "3 gaps in this window", with a colour. */
export function selection_gap_line (total) {
    return total
        ? { text: `${plural(total, 'gap')} in this window`, dot: 'bg-amber-500', cls: 'text-amber-700' }
        : { text: 'No gaps in this window', dot: 'bg-green-500', cls: 'text-slate-500' }
}

/** Minutes for a gap note: "4 min", "1h 20m". */
function gap_length (g) {
    const ms = g.to - g.from
    return ms < 60 * 60e3 ? `${Math.max(1, Math.round(ms / 60e3))} min` : fmt_duration(ms)
}

/**
 * The note under a device strip: "1 gap, 4 min at 10:21", or
 * "3 gaps, longest 12 min at 10:21". Empty when there are none.
 */
export function gap_note (gaps) {
    if (!gaps?.length) return ''
    if (gaps.length === 1) return `1 gap, ${gap_length(gaps[0])} at ${fmt_clock(gaps[0].from)}`
    const longest = gaps.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
    return `${gaps.length} gaps, longest ${gap_length(longest)} at ${fmt_clock(longest.from)}`
}

/** Coverage as "99.2%", or "–" when not known. */
export function fmt_coverage (ratio) {
    if (ratio == null) return '–'
    const pct = ratio * 100
    if (pct >= 99.95) return '100%'
    return `${pct.toFixed(1)}%`
}

/**
 * The sub-line under Coverage: "Complete", "2 gaps on Spindle",
 * "1 gap across most devices" or "5 gaps across 3 devices".
 * `nameOf(device)` gives a device name.
 */
export function coverage_sub (result, nameOf = d => d) {
    if (!result || result.coverage == null) return { text: '', cls: 'text-slate-500' }
    if (!result.total) return { text: 'Complete', cls: 'text-slate-500' }
    const hit = Object.entries(result.own).filter(([, g]) => g.length)
    let text
    if (!hit.length) text = `${plural(result.total, 'gap')} across most devices`
    else if (hit.length === 1 && !result.shared.length) text = `${plural(result.total, 'gap')} on ${nameOf(hit[0][0])}`
    else {
        const n = Object.values(result.devices).filter(d => d.gaps.length).length
        text = `${plural(result.total, 'gap')} across ${plural(n, 'device')}`
    }
    return { text, cls: 'text-amber-700' }
}

/**
 * Kiosk summary of a saved recording's gaps: "No gaps",
 * "1 gap, 4 min at 10:21 on Spindle" or "3 gaps, longest ...".
 */
export function recording_gap_note (result, nameOf = d => d) {
    if (!result || result.coverage == null) return null
    if (!result.total) return { text: 'No gaps', gap: false }
    const all = [
        ...result.shared.map(g => ({ ...g, who: 'most devices' })),
        ...Object.entries(result.own).flatMap(([id, gs]) => gs.map(g => ({ ...g, who: nameOf(id) }))),
    ]
    if (all.length === 1) return { text: `${gap_note(all)} on ${all[0].who}`, gap: true }
    return { text: gap_note(all), gap: true }
}

/* ------------------------------------------------------------------
 * Data rate
 * ------------------------------------------------------------------ */

/**
 * Points per second for a whole device: the points in the window over
 * the time it was sending (buckets outside gaps). Counts are per
 * device, not per metric, so this is the device's total rate. A
 * partial first or last bucket counts only the time that has elapsed
 * in it, so a steady rate reads the same at any moment. Null when
 * there is too little to tell. `g` is a device_gaps() result.
 */
export function data_rate (g, every) {
    if (!g?.points) return null
    const step = STEP_MS[every]
    if (!step) return null
    const sending = g.sending ?? (g.grid.length - g.empty.size) * step
    if (!(sending > 0)) return null
    return g.points / (sending / 1000)
}

function nice (v) {
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10
    return String(r)
}

const pts = v => `${nice(v)} ${nice(v) === '1' ? 'point' : 'points'}`

/**
 * "6 points/s" from 60 a minute up, "360 points/min", "6 points/h",
 * "Under 1 point/h", or "" for none.
 */
export function fmt_rate (pps) {
    if (!(pps > 0)) return ''
    if (pps * 60 >= 59.5) return `${pts(pps)}/s`
    if (pps * 60 >= 0.95) return `${pts(pps * 60)}/min`
    if (pps * 3600 >= 0.95) return `${pts(pps * 3600)}/h`
    return 'Under 1 point/h'
}
