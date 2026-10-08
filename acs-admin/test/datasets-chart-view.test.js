/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Chart views: the range the Data tab and the sparklines show, the
 * live rule at each zoom, values sent on change, and the chart cache.
 */

import { describe, it, expect } from 'vitest'
import {
    zoom_span, nearest_zoom, at_now, to_now, CHART_ZOOMS, clamp_view, zoom_view, step_view, go_view, pan_view, view_labels,
    spark_range, default_spark_range, MIN_SPAN,
} from '../src/lib/datasets/chart-view.js'
import { ZOOMS } from '../src/lib/datasets/model.js'
import { dataset_window, live_mode, display_rows, sent_on_change, SeriesCache, every_for_width, series_key } from '../src/lib/datasets/series.js'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = Date.parse('2026-10-08T08:00:00.000Z')
const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'

describe('the Data tab view', () => {
    it('shows as many hours as the timeline would in one chart width', () => {
        // Hours zoom is 120 px an hour: 1,200 px is 10 hours.
        expect(zoom_span('hours', 1200)).toBe(10 * HOUR)
        expect(zoom_span('days', 1300)).toBe(50 * HOUR)
        expect(nearest_zoom(10 * HOUR, 1200)).toBe('hours')
        expect(nearest_zoom(60 * DAY, 1200)).toBe('weeks')
        expect(zoom_span('hours', 10)).toBeGreaterThanOrEqual(MIN_SPAN)
    })

    it('zooms around the centre and never runs past the limit', () => {
        const v = { from: T0, to: T0 + 4 * HOUR }
        expect(zoom_view(v, 'hours', 1200, Infinity, T0 + DAY)).toEqual({ from: T0 - 3 * HOUR, to: T0 + 7 * HOUR })
        expect(zoom_view(v, 'hours', 1200, T0 + 5 * HOUR, T0 + DAY)).toEqual({ from: T0 - 5 * HOUR, to: T0 + 5 * HOUR })
        expect(clamp_view({ from: 0, to: 10 }, 20)).toEqual({ from: 0, to: 10 })
    })

    it('steps, goes to a time and pans', () => {
        const v = { from: T0, to: T0 + HOUR }
        expect(step_view(v, -1, Infinity)).toEqual({ from: T0 - HOUR, to: T0 })
        expect(step_view(v, 1, T0 + HOUR)).toEqual(v)
        expect(go_view(v, T0 + DAY, Infinity)).toEqual({ from: T0 + DAY - HOUR / 2, to: T0 + DAY + HOUR / 2 })
        // Dragging right by half the width goes back half the span.
        expect(pan_view(v, 300, 600, Infinity)).toEqual({ from: T0 - HOUR / 2, to: T0 + HOUR / 2 })
    })

    it('opens a windowless dataset on the last 24 hours, ending at now', () => {
        // 12:30 London (BST) is 11:30 UTC.
        const now = Date.parse('2026-10-08T11:30:00.000Z')
        const w = dataset_window({}, now)
        expect(w).toMatchObject({ from: now - DAY, to: now, windowless: true })
        // The toolbar says what the axis shows: 24 h, no zoom lit.
        const l = view_labels(w, 960, now)
        expect(l.zoom).toBe(null)
        expect(l.span).toBe('24 h')
        // Choosing Hours keeps the view ending at now.
        const z = zoom_view(w, 'hours', 960, now, now, { live: true })
        expect(z).toEqual({ from: now - 8 * HOUR, to: now })
        expect(view_labels(z, 960, now)).toMatchObject({ zoom: 'hours', span: '8 h' })
    })

    it('opens a finished window on the whole window', () => {
        const w = dataset_window({ from: '2026-10-07T08:00:00.000Z', to: '2026-10-07T10:00:00.000Z' }, T0)
        expect(w).toMatchObject({ from: T0 - DAY, to: T0 - DAY + 2 * HOUR, open: false })
    })

    it('labels the view like the timeline', () => {
        const l = view_labels({ from: T0, to: T0 + 10 * HOUR }, 1200, T0)
        expect(l.zoom).toBe('hours')
        expect(l.label).toMatch(/^Today/)
        expect(l.dateValue).toBe('2026-10-08')
    })

    it('asks for buckets to suit the span and width', () => {
        expect(every_for_width(T0, T0 + 10 * HOUR, 1200)).toBe('30s')
        expect(every_for_width(T0, T0 + 50 * HOUR, 1300)).toBe('5m')
    })
})

describe('zoom and Back to now', () => {
    const now = Date.parse('2026-10-08T11:30:00.000Z')

    it('goes to now on a zoom change while the dataset takes live data', () => {
        const past = { from: now - 3 * DAY, to: now - 2 * DAY }
        expect(zoom_view(past, 'hours', 960, now, now, { live: true })).toEqual({ from: now - 8 * HOUR, to: now })
    })

    it('zooms a finished window around its centre, inside the window', () => {
        const window = { from: now - 3 * DAY, to: now - DAY }
        const v = { ...window }
        expect(zoom_view(v, 'hours', 960, now, now, { window })).toEqual({ from: now - 2 * DAY - 4 * HOUR, to: now - 2 * DAY + 4 * HOUR })
        const edge = { from: now - 3 * DAY, to: now - 3 * DAY + HOUR }
        expect(zoom_view(edge, 'hours', 960, now, now, { window })).toEqual({ from: now - 3 * DAY, to: now - 3 * DAY + 8 * HOUR })
    })

    it('offers Back to now only when the view does not end at now, and keeps the span', () => {
        const v = { from: now - HOUR, to: now }
        expect(at_now(v, now, 10 * SEC)).toBe(true)
        // A live view a few seconds behind still counts as at now.
        expect(at_now(v, now + 5 * SEC, 10 * SEC)).toBe(true)
        const back = step_view(v, -1, now)
        expect(at_now(back, now, 10 * SEC)).toBe(false)
        expect(to_now(back, now)).toEqual({ from: now - HOUR, to: now })
    })

    it('has a Minutes zoom of about an hour that streams live', () => {
        expect(Object.keys(CHART_ZOOMS)[0]).toBe('minutes')
        expect(zoom_span('minutes', 1000)).toBe(HOUR)
        const v = zoom_view({ from: now - DAY, to: now }, 'minutes', 1000, now, now, { live: true })
        const every = every_for_width(v.from, v.to, 1000)
        expect(every).toBe('10s')
        expect(live_mode(v, every, now).stream).toBe(true)
        expect(view_labels(v, 1000, now).zoom).toBe('minutes')
    })

    it('leaves the main timeline without Minutes', () => {
        expect('minutes' in ZOOMS).toBe(false)
    })
})

describe('sparkline spans', () => {
    const open = { from: T0 - DAY * 3, to: T0, open: true, windowless: false }
    const done = { from: T0 - 3 * HOUR, to: T0 - HOUR, open: false, windowless: false }
    const later = { from: T0 - HOUR, to: T0 + HOUR, open: false, windowless: false }

    it('ends at now, or at the end of a finished window', () => {
        expect(spark_range('15m', open, T0)).toEqual({ from: T0 - 15 * MIN, to: T0 })
        expect(spark_range('24h', done, T0)).toEqual({ from: T0 - 3 * HOUR, to: T0 - HOUR })
        expect(spark_range('1h', done, T0)).toEqual({ from: T0 - 2 * HOUR, to: T0 - HOUR })
        // A window that ends later shows the data so far.
        expect(spark_range('window', later, T0)).toEqual({ from: T0 - HOUR, to: T0 })
    })

    it('defaults to the window once finished, else 24 h', () => {
        expect(default_spark_range(done, T0)).toBe('window')
        expect(default_spark_range(open, T0)).toBe('24h')
        expect(default_spark_range(later, T0)).toBe('24h')
        expect(default_spark_range({ ...open, windowless: true }, T0)).toBe('24h')
    })
})

describe('live at each zoom', () => {
    it('streams only at 30 s buckets or finer, while the view includes now', () => {
        expect(live_mode({ from: T0 - HOUR, to: T0 }, '10s', T0)).toEqual({ live: true, stream: true, hint: null })
        expect(live_mode({ from: T0 - HOUR, to: T0 }, '30s', T0).stream).toBe(true)
    })

    it('stays live at coarse buckets, updating as each closes', () => {
        expect(live_mode({ from: T0 - DAY, to: T0 }, '1m', T0)).toEqual({ live: true, stream: false, hint: 'Updates every 1 min' })
        expect(live_mode({ from: T0 - 30 * DAY, to: T0 }, '1h', T0).hint).toBe('Updates every 5 min')
    })

    it('is not live for a past view or a finished dataset', () => {
        expect(live_mode({ from: T0 - 2 * DAY, to: T0 - DAY }, '1m', T0)).toEqual({ live: false, stream: false, hint: null })
        expect(live_mode({ from: T0 - HOUR, to: T0 }, '10s', T0, false).live).toBe(false)
    })
})

describe('values sent on change', () => {
    const every = '1m'
    // The device sends every minute from T0 to T0 + 10 min.
    const active = t => t >= T0 && t < T0 + 10 * MIN

    it('draws continuous steps across buckets with no value', () => {
        const m = { points: [[T0, 8000, 1], [T0 + 4 * MIN, 6000, 1]] }
        expect(sent_on_change(m.points, every, active, T0 + 10 * MIN)).toBe(true)
        const { rows, step } = display_rows(m, every, { active, until: T0 + 10 * MIN })
        expect(step).toBe(true)
        expect(rows.every(r => r[1] != null)).toBe(true)
        expect(rows[1]).toEqual([T0 + MIN, 8000])
        expect(rows.at(-1)).toEqual([T0 + 10 * MIN, 6000])
    })

    it('breaks where the device sent nothing at all', () => {
        const busy = t => (t >= T0 && t < T0 + 3 * MIN) || (t >= T0 + 6 * MIN && t < T0 + 10 * MIN)
        const m = { points: [[T0, 5, 1]] }
        const { rows } = display_rows(m, every, { active: busy, until: T0 + 10 * MIN })
        expect(rows).toContainEqual([T0 + 3 * MIN, null])
        expect(rows).toContainEqual([T0 + 6 * MIN, 5])
    })

    it('holds a live value until now', () => {
        const m = { points: [[T0, 1, 1]], tail: [[T0 + 9 * MIN + 30 * SEC, 2]] }
        const { rows } = display_rows(m, every, { active, until: T0 + 9 * MIN + 50 * SEC })
        expect(rows.at(-2)).toEqual([T0 + 9 * MIN + 30 * SEC, 2])
        expect(rows.at(-1)).toEqual([T0 + 9 * MIN + 50 * SEC, 2])
    })

    it('draws a metric sent on a clock as before', () => {
        const pts = Array.from({ length: 10 }, (_, i) => [T0 + i * MIN, i, 60])
        const { rows, step } = display_rows({ points: pts }, every, { active, until: T0 + 10 * MIN })
        expect(step).toBe(false)
        expect(rows).toHaveLength(10)
    })
})

describe('the chart cache', () => {
    const key = series_key(D1, 'A')
    const answer = (from, to, asOf) => ({
        asOf,
        devices: { [D1]: { count: [[from, 5]] } },
        metrics: { [key]: { device: D1, metric: 'A', unit: 'kW', points: [[from, 1, 5]] } },
    })

    it('keeps finished chunks, and fetches only what is missing', () => {
        const c = new SeriesCache('10s')
        const chunk = 250 * 10 * SEC
        const now = T0 + 10 * chunk
        const need = c.missing(T0, T0 + chunk, now)
        expect(need).toEqual({ devices: ['*'], from: T0 - (T0 % chunk), to: T0 - (T0 % chunk) + 2 * chunk })
        c.put(need.from, need.to, answer(need.from, need.to, now), { keys: [key], counted: true })
        expect(c.missing(T0, T0 + chunk, now)).toBe(null)
        expect(c.view(need.from, need.to, [key]).metrics[key].points).toEqual([[need.from, 1, 5]])
        expect(c.active(D1, need.from)).toBe(true)
        expect(c.has_counts(need.from, need.to)).toBe(true)
    })

    it('refreshes the newest buckets without marking them loaded', () => {
        const c = new SeriesCache('10s')
        c.put(T0, T0 + 20 * SEC, answer(T0, T0 + 20 * SEC, T0 + 15 * SEC), { keys: [key], final: false })
        expect(c.missing(T0, T0 + 20 * SEC, T0 + HOUR)).not.toBe(null)
        expect(c.asOf).toBe(T0 + 15 * SEC)
    })
})
