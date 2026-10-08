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

import { ZOOMS, centre_label, london_date_key } from './model.js'

const MIN = 60 * 1000
const HOUR = 60 * MIN

/** The shortest span a chart shows. */
export const MIN_SPAN = 10 * MIN

/** How many ms one chart width shows at a timeline zoom. */
export function zoom_span (zoom, width) {
    const z = ZOOMS[zoom] ?? ZOOMS.hours
    return Math.max(MIN_SPAN, (Math.max(200, width || 0) / z.px_per_hour) * HOUR)
}

/** The timeline zoom whose span is closest to `span` at this width. */
export function nearest_zoom (span, width) {
    let best = null, gap = Infinity
    for (const id of Object.keys(ZOOMS)) {
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

/** The view at a zoom, around the same centre. */
export function zoom_view (v, zoom, width, max_to) {
    const span = zoom_span(zoom, width)
    const c = (v.from + v.to) / 2
    return clamp_view({ from: c - span / 2, to: c + span / 2 }, max_to)
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

/** What the toolbar shows for a view: zoom, label and date input value. */
export function view_labels (v, width, now = Date.now()) {
    const zoom = nearest_zoom(v.to - v.from, width)
    const c = (v.from + v.to) / 2
    return { zoom, label: centre_label(zoom, c, now), dateValue: london_date_key(c) }
}

/* ------------------------------------------------------------------
 * Overview sparklines
 * ------------------------------------------------------------------ */

/** The sparkline spans, shortest first. `null` is the whole window. */
export const SPARK_RANGES = [
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
