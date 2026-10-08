/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The energy and carbon add-on. It runs in the browser on a dataset's
 * CSV and stores nothing.
 *
 * Method (the same as the Decarbonisation dashboards):
 *   - Energy comes from a cumulative register (kWh). The register is
 *     read at each half-hour boundary by linear interpolation between
 *     real readings, and the energy of a segment is the difference.
 *     Segments with a negative difference (a reset) or more than
 *     MAX_KWH_PER_HALF_HOUR are dropped as bad readings. See
 *     register_at for gaps and the window edges.
 *   - Fixed factor: kgCO2e = kWh x FIXED_FACTOR.
 *   - Grid: kgCO2e = kWh x (gCO2/kWh / 1000 + CH4_N2O), using the
 *     intensity for that half hour, held for up to INTENSITY_HOLD_MS.
 */

import Papa from 'papaparse'
import { CARBON } from './constants.js'

const HALF_HOUR = 30 * 60 * 1000

/** Parse the Data Access CSV (device,metric,timestamp,value,unit). */
export function parse_csv (text) {
    const res = Papa.parse(text, { header: true, skipEmptyLines: true })
    const rows = []
    for (const r of res.data) {
        const t = Date.parse(r.timestamp)
        if (Number.isNaN(t)) continue
        const n = Number(r.value)
        rows.push({
            device: r.device ?? '',
            metric: r.metric ?? '',
            t,
            value: (r.value ?? '').trim() === '' || Number.isNaN(n) ? r.value : n,
            unit: r.unit ?? '',
        })
    }
    return rows
}

/** Group rows into series by device and metric, sorted by time. */
export function series_of (rows) {
    const map = new Map()
    for (const r of rows) {
        const key = `${r.device}\u0000${r.metric}`
        let s = map.get(key)
        if (!s) map.set(key, s = { device: r.device, metric: r.metric, unit: r.unit, points: [] })
        if (typeof r.value === 'number') s.points.push({ t: r.t, v: r.value })
        if (!s.unit && r.unit) s.unit = r.unit
    }
    for (const s of map.values()) s.points.sort((a, b) => a.t - b.t)
    return [...map.values()]
}

const ENERGY_UNITS = { wh: 0.001, kwh: 1, mwh: 1000 }

function energy_scale (unit) {
    return ENERGY_UNITS[(unit ?? '').replace(/\s/g, '').toLowerCase()] ?? null
}

/**
 * Energy registers in a set of series. A register has an energy unit
 * (Wh, kWh, MWh) and mostly rising values. Returned best first:
 * names with "Active" and "Total" or "Delivered" rank higher, and
 * "Returned" or "Reactive" lower.
 */
export function find_energy_series (series, { devices } = {}) {
    const out = []
    for (const s of series) {
        if (devices && !devices.has(s.device)) continue
        const scale = energy_scale(s.unit)
        // A unit that is not Wh, kWh or MWh (kvarh, kVAh, J) is not
        // active energy, whatever the metric is called.
        const unitless = !(s.unit ?? '').trim()
        if (scale == null && !(unitless && /energy/i.test(s.metric))) continue
        if (s.points.length < 2) continue
        let up = 0, down = 0
        for (let i = 1; i < s.points.length; i++) {
            const d = s.points[i].v - s.points[i - 1].v
            if (d > 0) up++
            else if (d < 0) down++
        }
        if (down > up / 10 + 1) continue
        let score = 0
        if (scale != null) score += 4
        if (/active/i.test(s.metric)) score += 2
        if (/total|delivered|import/i.test(s.metric)) score += 2
        if (/returned|export|reactive|apparent/i.test(s.metric)) score -= 5
        out.push({ ...s, scale: scale ?? 1, score })
    }
    return out.sort((a, b) => b.score - a.score)
}

const POWER_UNITS = { w: 0.001, kw: 1, mw: 1000 }

/**
 * Active power series, for meters (and current clamps) that report
 * power but no energy register. A unit of W, kW or MW, or no unit and a
 * name like "Active_Power". Reactive and apparent power, and power
 * factor, are left out. Best first: totals rank above single phases.
 */
export function find_power_series (series) {
    const out = []
    for (const s of series) {
        if (s.points.length < 2) continue
        const unit = (s.unit ?? '').replace(/\s/g, '').toLowerCase()
        const scale = POWER_UNITS[unit] ?? null
        if (/reactive|apparent|factor/i.test(s.metric)) continue
        if (scale == null && !(unit === '' && /active_?power/i.test(s.metric))) continue
        let score = 0
        if (scale != null) score += 4
        if (/active/i.test(s.metric)) score += 2
        if (/total/i.test(s.metric)) score += 2
        out.push({ ...s, power_scale: scale ?? 1, score })
    }
    return out.sort((a, b) => b.score - a.score)
}

/**
 * The longest silence to bridge for a power series: five times its
 * typical reading interval, at least a minute and at most MAX_GAP_MS.
 * Power read every second that stops for a minute and a half has lost
 * data; a straight line across the gap would invent energy.
 */
export function power_gap_limit (points) {
    const dts = []
    for (let i = 1; i < points.length; i++) dts.push(points[i].t - points[i - 1].t)
    if (!dts.length) return CARBON.MAX_GAP_MS
    dts.sort((a, b) => a - b)
    const median = dts[dts.length >> 1]
    return Math.min(CARBON.MAX_GAP_MS, Math.max(60 * 1000, 5 * median))
}

/**
 * Turn a power series into a cumulative register in kWh, by the
 * trapezium rule between readings. Readings further apart than the
 * series' gap limit add nothing, and register_at will not interpolate
 * across them, so a silence is reported as missing rather than guessed.
 */
export function power_to_register (s) {
    const pts = s.points
    const max_gap = power_gap_limit(pts)
    const out = []
    // Silences longer than the limit: no energy is counted across them,
    // and the coverage leaves them out.
    const gaps = []
    let kwh = 0
    for (let i = 0; i < pts.length; i++) {
        if (i > 0) {
            const dt = pts[i].t - pts[i - 1].t
            if (dt > max_gap) gaps.push({ from: pts[i - 1].t, to: pts[i].t })
            else {
                const kw = (pts[i].v + pts[i - 1].v) / 2 * s.power_scale
                kwh += Math.max(0, kw) * dt / 3600e3
            }
        }
        out.push({ t: pts[i].t, v: kwh })
    }
    return { device: s.device, metric: s.metric, unit: s.unit, scale: 1, from_power: true, max_gap: CARBON.MAX_GAP_MS, gaps, points: out }
}

/** Grid intensity series (gCO2/kWh). */
export function find_intensity_series (series) {
    return series
        .filter(s => s.points.length && (/gco2/i.test(s.unit ?? '') || /intensity/i.test(s.metric)))
        .map(s => ({ ...s, score: (/forecast/i.test(s.metric) ? 1 : 0) + (/gco2/i.test(s.unit ?? '') ? 2 : 0) }))
        .sort((a, b) => b.score - a.score)
}

/** Linear interpolation of a sorted series at t, or null outside it. */
export function interpolate_at (points, t) {
    if (!points.length || t < points[0].t || t > points[points.length - 1].t) return null
    let lo = 0, hi = points.length - 1
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (points[mid].t <= t) lo = mid
        else hi = mid
    }
    const a = points[lo], b = points[hi]
    if (a.t === t) return a.v
    if (b.t === t) return b.v
    if (b.t === a.t) return a.v
    return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t)
}

/**
 * Read a register at t.
 *
 * Inside the series: linear interpolation, but only between readings at
 * most MAX_GAP_MS apart, so a long silence is not spread evenly over
 * hours with no data.
 *
 * Just outside it: Data Access cuts a dataset's data at the window, so
 * there is never a reading exactly at the start or end. Within one
 * reading interval (and at most MAX_EDGE_MS) of the first or last
 * reading, the value is extrapolated at the rate of the nearest two
 * readings and marked estimated.
 *
 * @returns {{v:number, estimated:boolean, extra:number}|null} where
 *   `extra` is the part of the value that was extrapolated.
 */
export function register_at (points, t, max_gap = CARBON.MAX_GAP_MS) {
    const n = points.length
    if (!n) return null
    const first = points[0], last = points[n - 1]
    if (t < first.t || t > last.t) {
        if (n < 2) return null
        const [a, b] = t < first.t ? [points[0], points[1]] : [points[n - 2], points[n - 1]]
        const step = b.t - a.t
        const dist = t < first.t ? first.t - t : t - last.t
        if (step <= 0 || step > max_gap || dist > Math.min(step, CARBON.MAX_EDGE_MS)) return null
        const rate = Math.max(0, (b.v - a.v) / step)
        return { v: t < first.t ? first.v - rate * dist : last.v + rate * dist, estimated: true, extra: rate * dist }
    }
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (points[mid].t <= t) lo = mid
        else hi = mid
    }
    const a = points[lo], b = points[hi]
    if (a.t === t) return { v: a.v, estimated: false, extra: 0 }
    if (b.t === t) return { v: b.v, estimated: false, extra: 0 }
    if (b.t - a.t > max_gap) return null
    return { v: a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t), estimated: false, extra: 0 }
}

/** The last value at or before t, if no older than hold. */
export function held_at (points, t, hold) {
    let lo = 0, hi = points.length - 1, best = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (points[mid].t <= t) { best = mid; lo = mid + 1 }
        else hi = mid - 1
    }
    if (best < 0 || t - points[best].t > hold) return null
    return points[best].v
}

/** Segment boundaries: from, each half hour inside, to. */
export function boundaries (from, to) {
    const out = [from]
    for (let b = Math.floor(from / HALF_HOUR) * HALF_HOUR + HALF_HOUR; b < to; b += HALF_HOUR) out.push(b)
    out.push(to)
    return out
}

/**
 * Work out energy and carbon for a window.
 *
 * @param {Object} opts
 * @param {Array} opts.meters     registers: { device, metric, scale, points }
 * @param {Array} [opts.intensity] points of gCO2/kWh, sorted
 * @param {number} opts.from      ms
 * @param {number} opts.to        ms
 */
export function energy_and_carbon ({ meters, intensity = null, from, to }) {
    const edges = boundaries(from, to)
    const segments = []
    let kwh = 0, kwh_no_intensity = 0, kg_grid = 0, covered_ms = 0, bad = 0, estimated_kwh = 0
    for (let i = 0; i < edges.length - 1; i++) {
        const start = edges[i], end = edges[i + 1]
        let seg_kwh = 0, ok = meters.length > 0, estimated = false, seg_extra = 0
        for (const m of meters) {
            const a = register_at(m.points, start, m.max_gap)
            const b = register_at(m.points, end, m.max_gap)
            if (a == null || b == null) { ok = false; break }
            const d = (b.v - a.v) * m.scale
            if (d < 0 || d > CARBON.MAX_KWH_PER_HALF_HOUR) { ok = false; bad++; break }
            if (a.estimated || b.estimated) estimated = true
            seg_extra += (a.extra + b.extra) * m.scale
            seg_kwh += d
        }
        // Time inside the segment that a power meter has no readings for.
        let missing_ms = 0
        if (ok) for (const m of meters) {
            let ms = 0
            for (const g of m.gaps ?? []) ms += Math.max(0, Math.min(end, g.to) - Math.max(start, g.from))
            missing_ms = Math.max(missing_ms, ms)
        }
        const seg = { start, end, covered: ok, missing_ms, estimated: ok && estimated, kwh: ok ? seg_kwh : null, intensity: null, kg_fixed: null, kg_grid: null }
        if (ok) {
            covered_ms += end - start - missing_ms
            kwh += seg_kwh
            // Only the extrapolated part, not the whole segment.
            if (estimated) estimated_kwh += Math.min(seg_kwh, seg_extra)
            seg.kg_fixed = seg_kwh * CARBON.FIXED_FACTOR
            const hh = Math.floor(start / HALF_HOUR) * HALF_HOUR
            const g = intensity ? held_at(intensity, hh, CARBON.INTENSITY_HOLD_MS) ?? held_at(intensity, start, CARBON.INTENSITY_HOLD_MS) : null
            if (g != null) {
                seg.intensity = g
                seg.kg_grid = seg_kwh * (g / 1000 + CARBON.CH4_N2O)
                kg_grid += seg.kg_grid
            }
            else kwh_no_intensity += seg_kwh
        }
        segments.push(seg)
    }
    const coverage = to > from ? covered_ms / (to - from) : 0
    const intensity_coverage = kwh > 0 ? (kwh - kwh_no_intensity) / kwh : 0
    return {
        kwh,
        kg_fixed: kwh * CARBON.FIXED_FACTOR,
        kg_grid: intensity && kwh_no_intensity < kwh ? kg_grid : null,
        kwh_no_intensity,
        // Energy extrapolated past the first or last reading at an edge.
        estimated_kwh,
        coverage,
        intensity_coverage,
        bad_segments: bad,
        confidence: confidence(coverage, intensity ? intensity_coverage : null),
        segments,
    }
}

/** High, medium or low, from how much of the window has data. */
export function confidence (coverage, intensity_coverage) {
    const c = Math.min(coverage, intensity_coverage ?? 1)
    if (c >= 0.95) return 'high'
    if (c >= 0.75) return 'medium'
    return 'low'
}

/** Group segments into half hours for the table. */
export function half_hour_rows (segments) {
    const rows = new Map()
    for (const s of segments) {
        const hh = Math.floor(s.start / HALF_HOUR) * HALF_HOUR
        let r = rows.get(hh)
        if (!r) rows.set(hh, r = { start: hh, kwh: 0, kg_fixed: 0, kg_grid: 0, intensity: null, covered: true, grid_missing: false })
        if (!s.covered) { r.covered = false; continue }
        r.kwh += s.kwh
        r.kg_fixed += s.kg_fixed
        if (s.kg_grid == null) r.grid_missing = true
        else { r.kg_grid += s.kg_grid; r.intensity = s.intensity }
    }
    return [...rows.values()]
}
