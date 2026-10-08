/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The time range the Data tab charts and the Overview sparklines show,
 * and how the controls move it. The Data tab uses the main timeline's
 * zooms: a zoom sets how many hours one chart width shows, at the same
 * pixels per hour as the timeline. The Overview picks a fixed span.
 *
 * Nothing here talks to a service. Tested in test/datasets-chart-view.test.js.
 */

import { ZOOMS, centre_label, london_date_key, fmt_clock, fmt_day } from './model.js'

const MIN = 60 * 1000
const HOUR = 60 * MIN

/** The shortest span a chart shows. */
export const MIN_SPAN = 2 * MIN

/**
 * The Data tab's zooms: the timeline's, with Seconds and Minutes before
 * Hours. At 1,000 px a typical chart shows about 5 minutes (Seconds) or
 * an hour (Minutes), in buckets of 30 s or less, so values stream live.
 * Data Access's smallest bucket is 10 s; at Seconds the raw live values
 * draw over the buckets.
 */
export const CHART_ZOOMS = {
    seconds: { label: 'Seconds', px_per_hour: 12000 },
    minutes: { label: 'Minutes', px_per_hour: 1000 },
    ...ZOOMS,
}

/** How many ms one chart width shows at a zoom. */
export function zoom_span (zoom, width) {
    const z = CHART_ZOOMS[zoom] ?? ZOOMS.hours
    return Math.max(MIN_SPAN, (Math.max(200, width || 0) / z.px_per_hour) * HOUR)
}

/** The zoom whose span is closest to `span` at this width. */
export function nearest_zoom (span, width, zooms = CHART_ZOOMS) {
    let best = null, gap = Infinity
    for (const id of Object.keys(zooms)) {
        const d = Math.abs(Math.log(zoom_span(id, width) / span))
        if (d < gap) { gap = d; best = id }
    }
    return best
}

/**
 * Keep a view from running past `max_to` (now, or the end of a window
 * that ends later). A view no longer than the space keeps its span.
 */
export function clamp_view (v, max_to) {
    if (!Number.isFinite(max_to) || v.to <= max_to) return v
    const shift = v.to - max_to
    return { from: v.from - shift, to: max_to }
}

/**
 * The view at a zoom. While the dataset takes live data (`live`: no
 * window, or a window that includes now), any zoom change ends the view
 * at now. A finished window zooms around the centre, kept inside the
 * window (`window`: { from, to }) when it fits.
 */
export function zoom_view (v, zoom, width, max_to, now = Date.now(), { live = false, window = null } = {}) {
    const span = zoom_span(zoom, width)
    if (live) return { from: now - span, to: now }
    const c = (v.from + v.to) / 2
    let out = clamp_view({ from: c - span / 2, to: c + span / 2 }, max_to)
    if (window && span <= window.to - window.from) {
        if (out.from < window.from) out = { from: window.from, to: window.from + span }
        if (out.to > window.to) out = { from: window.to - span, to: window.to }
    }
    return out
}

/**
 * Whether a view ends at now, within one bucket (`step`) or 1% of its
 * span, so a live view that has just moved on still counts.
 */
export function at_now (v, now, step = 0) {
    return Math.abs(v.to - now) <= Math.max(step, (v.to - v.from) * 0.01)
}

/** The same span, moved to end at now. */
export function to_now (v, now) {
    return { from: now - (v.to - v.from), to: now }
}

/** One view width back (-1) or forward (+1). */
export function step_view (v, dir, max_to) {
    const span = v.to - v.from
    return clamp_view({ from: v.from + dir * span, to: v.to + dir * span }, max_to)
}

/** The same span, centred on t. */
export function go_view (v, t, max_to) {
    const span = v.to - v.from
    return clamp_view({ from: t - span / 2, to: t + span / 2 }, max_to)
}

/** Drag or scroll by `dx` px over a chart `width` px wide. */
export function pan_view (v, dx, width, max_to) {
    const span = v.to - v.from
    const dt = -dx * span / Math.max(1, width)
    return clamp_view({ from: v.from + dt, to: v.to + dt }, max_to)
}

/**
 * What the toolbar shows for a view: the zoom (the one given, else the
 * nearest), the label and the date input value. The label follows the
 * zoom: up to Days it names the day the view ends on ("Today, Thu 8
 * Oct"); Weeks and Years name the week or month at the centre.
 */
export function view_labels (v, width, now = Date.now(), zoom = null) {
    const z = zoom ?? nearest_zoom(v.to - v.from, width)
    const c = (v.from + v.to) / 2
    const daily = z === 'seconds' || z === 'minutes' || z === 'hours' || z === 'days'
    const at = daily ? Math.min(v.to, now) : c
    return { zoom: z, label: centre_label(daily ? 'hours' : z, at, now), dateValue: london_date_key(at), span: fmt_span(v.to - v.from) }
}

/** "24 h", "45 min", "3 days". */
export function fmt_span (ms) {
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`
    if (ms < 48 * HOUR) return `${Math.round(ms / HOUR * 10) / 10} h`
    return `${Math.round(ms / (24 * HOUR))} days`
}

/* ------------------------------------------------------------------
 * Overview sparklines
 * ------------------------------------------------------------------ */

/** The sparkline spans, shortest first. `null` is the whole window. */
export const SPARK_RANGES = [
    // These two use 10 s buckets with the raw live values over them.
    { id: '1m', label: '1 min', span: MIN },
    { id: '5m', label: '5 min', span: 5 * MIN },
    { id: '15m', label: '15 min', span: 15 * MIN },
    { id: '1h', label: '1 h', span: HOUR },
    { id: '6h', label: '6 h', span: 6 * HOUR },
    { id: '24h', label: '24 h', span: 24 * HOUR },
    { id: 'window', label: 'Window', span: null },
]

/**
 * The range a sparkline shows for a choice, over a dataset window
 * `w` ({ from, to }): it ends at now, or at the window's end once that
 * has passed, so the line fills its width with the data so far.
 */
export function spark_range (id, w, now = Date.now()) {
    const end = Math.max(w.from + 1, Math.min(w.to, now))
    const r = SPARK_RANGES.find(x => x.id === id) ?? SPARK_RANGES[3]
    if (r.span == null) return { from: w.from, to: end }
    return { from: Math.max(w.from, end - r.span), to: end }
}

/** The default choice: the whole window once it has finished, else the last 24 h. */
export function default_spark_range (w, now = Date.now()) {
    return !w.windowless && !w.open && w.to <= now ? 'window' : '24h'
}

/* ------------------------------------------------------------------
 * Words while dragging
 * ------------------------------------------------------------------ */

/**
 * A range for the drag tooltip, at the zoom's precision, London time:
 * seconds at Seconds and Minutes ("Thu 8 Oct 12:41:10 to 12:46:10"),
 * minutes at Hours ("Thu 8 Oct 12:41 to 20:41"), dates at Days and
 * beyond ("Thu 8 Oct to Sat 10 Oct"). The second date shows only when
 * it differs.
 */
export function fmt_view_range (from, to, zoom) {
    const sameDay = london_date_key(from) === london_date_key(to)
    if (zoom === 'days' || zoom === 'weeks' || zoom === 'years') {
        return sameDay ? fmt_day(from) : `${fmt_day(from)} to ${fmt_day(to)}`
    }
    const secs = zoom === 'seconds' || zoom === 'minutes'
    const end = sameDay ? fmt_clock(to, secs) : `${fmt_day(to)} ${fmt_clock(to, secs)}`
    return `${fmt_day(from)} ${fmt_clock(from, secs)} to ${end}`
}

/** "1 h 35 min", "45 min", "30 s", "2 days 3 h". */
export function fmt_length (ms) {
    const s = Math.round(Math.max(0, ms) / 1000)
    if (s < 60) return `${s} s`
    const m = Math.round(s / 60)
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60), rm = m % 60
    if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`
    const d = Math.floor(h / 24), rh = h % 24
    return `${d} ${d === 1 ? 'day' : 'days'}${rh ? ` ${rh} h` : ''}`
}

/** A selection being dragged: "12:05 to 13:40, 1 h 35 min". */
export function fmt_selection (from, to) {
    const a = Math.min(from, to), b = Math.max(from, to)
    const sameDay = london_date_key(a) === london_date_key(b)
    const span = sameDay
        ? `${fmt_clock(a)} to ${fmt_clock(b)}`
        : `${fmt_day(a)} ${fmt_clock(a)} to ${fmt_day(b)} ${fmt_clock(b)}`
    return `${span}, ${fmt_length(b - a)}`
}

/**
 * Where a tooltip goes along a box `width` wide, at `x`: its left edge
 * at x, shifted left by the same share of its own width, so it never
 * leaves the box.
 */
export function inside_x (x, width) {
    const cx = Math.max(0, Math.min(width, x))
    return { left: cx, shift: width > 0 ? (cx / width) * 100 : 0 }
}
