/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Chart views: the range the Data tab and the sparklines show, the
 * live rule at each zoom, values sent on change, and the chart cache.
 */

import { describe, it, expect } from 'vitest'
import {
    zoom_span, nearest_zoom, at_now, to_now, CHART_ZOOMS, fmt_view_range, fmt_length, fmt_selection, inside_x, clamp_view, zoom_view, step_view, go_view, pan_view, view_labels,
    spark_range, default_spark_range, MIN_SPAN, SPARK_RANGES,
} from '../src/lib/datasets/chart-view.js'
import { ZOOMS } from '../src/lib/datasets/model.js'
import { dataset_window, chart_pairs, sparkline_path, y_range, gap_joins, live_mode, display_rows, SeriesCache, every_for_width, series_key } from '../src/lib/datasets/series.js'

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
        // Choosing Hours keeps the view ending at now.
        const z = zoom_view(w, 'hours', 960, now, now, { live: true })
        expect(z).toEqual({ from: now - 8 * HOUR, to: now })
        expect(view_labels(z, 960, now, 'hours')).toMatchObject({ zoom: 'hours', span: '8 h' })
    })

    it('always lights one zoom: the default is the zoom nearest 24 h, at its own span', () => {
        const now = Date.parse('2026-10-08T11:30:00.000Z')
        const zoom = nearest_zoom(DAY, 960)
        expect(zoom).toBe('days')
        const span = zoom_span(zoom, 960)
        const v = { from: now - span, to: now }
        const l = view_labels(v, 960, now, zoom)
        expect(l.zoom).toBe('days')
        // Any span lights a zoom, never none.
        expect(view_labels({ from: now - 3 * HOUR, to: now }, 960, now).zoom).toBeTruthy()
    })

    it('labels the day the view ends on, up to Days, and the week or month beyond', () => {
        const now = Date.parse('2026-10-08T11:30:00.000Z')
        const days = view_labels({ from: now - 40 * HOUR, to: now }, 960, now, 'days')
        expect(days.label).toMatch(/^Today, Thu 8 Oct/)
        expect(view_labels({ from: now - HOUR, to: now }, 960, now, 'minutes').label).toMatch(/^Today/)
        expect(view_labels({ from: now - 20 * DAY, to: now }, 960, now, 'weeks').label).toMatch(/^Week of/)
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
        expect(Object.keys(CHART_ZOOMS)[1]).toBe('minutes')
        expect(zoom_span('minutes', 1000)).toBe(HOUR)
        const v = zoom_view({ from: now - DAY, to: now }, 'minutes', 1000, now, now, { live: true })
        const every = every_for_width(v.from, v.to, 1000)
        expect(every).toBe('10s')
        expect(live_mode(v, every, now).stream).toBe(true)
        expect(view_labels(v, 1000, now).zoom).toBe('minutes')
    })

    it('leaves the main timeline without Seconds or Minutes', () => {
        expect('minutes' in ZOOMS).toBe(false)
        expect('seconds' in ZOOMS).toBe(false)
    })

    it('has a Seconds zoom of about 5 minutes, first, in 10 s buckets', () => {
        expect(Object.keys(CHART_ZOOMS)[0]).toBe('seconds')
        expect(zoom_span('seconds', 1000)).toBe(5 * MIN)
        const v = zoom_view({ from: now - HOUR, to: now }, 'seconds', 1000, now, now, { live: true })
        expect(v).toEqual({ from: now - 5 * MIN, to: now })
        expect(every_for_width(v.from, v.to, 1000)).toBe('10s')
        expect(view_labels(v, 1000, now)).toMatchObject({ zoom: 'seconds', span: '5 min' })
        // Back to now keeps the 5 minutes.
        expect(to_now(step_view(v, -1, now), now)).toEqual(v)
    })

    it('draws raw values over 10 s buckets, and buckets alone further back', () => {
        const buckets = Array.from({ length: 30 }, (_, i) => [now - 5 * MIN + i * 10 * SEC, i, 10])
        const raw = Array.from({ length: 60 }, (_, i) => [now - MIN + i * SEC, 100 + i])
        const rows = chart_pairs(buckets, '10s', raw)
        // The last minute is raw, one point a second; before it, buckets.
        expect(rows.filter(r => r[0] >= now - MIN)).toEqual(raw)
        expect(rows.filter(r => r[0] < now - MIN)).toHaveLength(24)
        // Panned back past the raw values: the buckets still draw.
        const back = display_rows({ points: buckets.slice(0, 12), tail: raw }, '10s', { until: now - 3 * MIN })
        expect(back.rows.filter(r => r[0] < now - 3 * MIN).length).toBe(12)
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

    it('ends the newest raw value at its own time, not at now', () => {
        const m = { points: [[T0, 1, 1]], tail: [[T0 + 9 * MIN + 30 * SEC, 2]] }
        const { rows } = display_rows(m, every, { active, until: T0 + 9 * MIN + 50 * SEC })
        expect(rows.at(-1)).toEqual([T0 + 9 * MIN + 30 * SEC, 2])
    })

    it('draws a linear-looking metric as steps: each bucket a flat level', () => {
        const pts = Array.from({ length: 10 }, (_, i) => [T0 + i * MIN, i, 60])
        const { rows, step } = display_rows({ points: pts }, every, { active, until: T0 + 10 * MIN })
        expect(step).toBe(true)
        // One level per bucket, and the newest closes at its bucket end.
        expect(rows).toHaveLength(11)
        expect(rows.at(-1)).toEqual([T0 + 10 * MIN, 9])
        const d = sparkline_path(rows, { from: T0, to: T0 + 10 * MIN, w: 100, h: 20, step, pad: 0 })
        expect(d).not.toMatch(/L/)
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

describe('Data tab fixes: y axis, history edge, faint joins', () => {
    it('fits the y axis to the points in view only', () => {
        const rows = [[T0 - HOUR, 1000], [T0 - MIN, 50], [T0, 10], [T0 + MIN, 20], [T0 + HOUR, -500]]
        const r = y_range(rows, T0, T0 + 10 * MIN)
        // 50 is carried in from the left edge; 1000 and -500 are outside.
        expect(r.min).toBeCloseTo(10 - 4)
        expect(r.max).toBeCloseTo(50 + 4)
        expect(y_range([[T0, 5], [T0 + MIN, 5]], T0, T0 + MIN)).toEqual({ min: 4.5, max: 5.5 })
        expect(y_range([[T0, 0]], T0, T0 + MIN)).toEqual({ min: -1, max: 1 })
        expect(y_range([[T0 - DAY, 3]], T0, T0 + MIN)).toEqual({ min: 2.7, max: 3.3 })
        expect(y_range([], T0, T0 + MIN)).toBe(null)
    })

    it('fetches the newest stretch again after the view used another bucket size', () => {
        const c = new SeriesCache('10s')
        const key = series_key(D1, 'A')
        // Loaded at 12:30 (the open chunk is complete to here).
        const t1 = T0 + 30 * MIN
        c.put(t1 - 20 * MIN, t1 + 10 * MIN, { asOf: t1, devices: {}, metrics: { [key]: { device: D1, metric: 'A', points: [] } } }, { keys: [key] })
        expect(c.stale(t1, t1)).toBe(null)
        // Ten minutes later, with no refreshes at 10 s since: 12:30 to now is missing.
        const now = t1 + 10 * MIN
        expect(c.stale(now, now)).toEqual({ from: t1, to: now + 10 * SEC })
        // Fetching that stretch catches the edge up.
        c.put(t1, now + 10 * SEC, { asOf: now, devices: {}, metrics: {} }, { keys: [key], final: false })
        expect(c.stale(now, now)).toBe(null)
    })

    it('holds an on-change value in from the left edge', () => {
        const active = () => true
        const { rows, step } = display_rows({ points: [[T0 - 5 * MIN, 7, 1], [T0 + 2 * MIN, 8, 1], [T0 + 2 * MIN + 10 * SEC, 8, 1]] }, '10s', { active, until: T0 + 4 * MIN })
        expect(step).toBe(true)
        // The value before the view carries across its left edge.
        expect(rows.find(r => r[0] === T0)).toEqual([T0, 7])
    })

    it('joins a gap faintly between two real points, and nothing past the newest', () => {
        const rows = [[T0, 1], [T0 + 10 * SEC, 2], [T0 + 20 * SEC, null], [T0 + 50 * SEC, 3], [T0 + MIN, null]]
        expect(gap_joins(rows)).toEqual([[T0 + 10 * SEC, 2], [T0 + 50 * SEC, 3], [T0 + 50 * SEC, null]])
        expect(gap_joins([[T0, 1], [T0 + MIN, null]])).toEqual([])
    })

    it('holds a step value across the gap', () => {
        const busy = t => t < T0 + 30 * SEC || t >= T0 + MIN
        const { rows, step } = display_rows({ points: [[T0, 4, 1], [T0 + MIN + 30 * SEC, 6, 1]] }, '10s', { active: busy, until: T0 + 2 * MIN })
        expect(step).toBe(true)
        const joins = gap_joins(rows)
        // The join starts at the held value; drawn as steps, it stays at 4 across the gap.
        expect(joins[0][1]).toBe(4)
        expect(joins[1][0]).toBe(T0 + MIN)
    })
})

describe('words while dragging', () => {
    // 12:41:10 London (BST) on Thu 8 Oct 2026.
    const t = Date.parse('2026-10-08T11:41:10.000Z')

    it('gives the range at the zoom precision, in London time', () => {
        expect(fmt_view_range(t, t + 5 * MIN, 'seconds')).toBe('Thu 8 Oct 12:41:10 to 12:46:10')
        expect(fmt_view_range(t, t + HOUR, 'minutes')).toBe('Thu 8 Oct 12:41:10 to 13:41:10')
        expect(fmt_view_range(t, t + 8 * HOUR, 'hours')).toBe('Thu 8 Oct 12:41 to 20:41')
        expect(fmt_view_range(t, t + 14 * HOUR, 'hours')).toBe('Thu 8 Oct 12:41 to Fri 9 Oct 02:41')
        expect(fmt_view_range(t, t + 2 * DAY, 'days')).toBe('Thu 8 Oct to Sat 10 Oct')
        expect(fmt_view_range(t, t + HOUR, 'weeks')).toBe('Thu 8 Oct')
    })

    it('gives a length in words', () => {
        expect(fmt_length(95 * MIN)).toBe('1 h 35 min')
        expect(fmt_length(2 * HOUR)).toBe('2 h')
        expect(fmt_length(45 * MIN)).toBe('45 min')
        expect(fmt_length(30 * SEC)).toBe('30 s')
        expect(fmt_length(DAY + 3 * HOUR)).toBe('1 day 3 h')
        expect(fmt_length(2 * DAY)).toBe('2 days')
    })

    it('describes a selection being dragged, either way', () => {
        const a = Date.parse('2026-10-08T11:05:00.000Z')
        expect(fmt_selection(a, a + 95 * MIN)).toBe('12:05 to 13:40, 1 h 35 min')
        expect(fmt_selection(a + 95 * MIN, a)).toBe('12:05 to 13:40, 1 h 35 min')
        expect(fmt_selection(a, a + DAY)).toBe('Thu 8 Oct 12:05 to Fri 9 Oct 12:05, 1 day')
    })

    it('keeps a tooltip inside its box', () => {
        expect(inside_x(0, 400)).toEqual({ left: 0, shift: 0 })
        expect(inside_x(400, 400)).toEqual({ left: 400, shift: 100 })
        expect(inside_x(-20, 400)).toEqual({ left: 0, shift: 0 })
        expect(inside_x(200, 400)).toEqual({ left: 200, shift: 50 })
    })
})

describe('fine sparkline spans', () => {
    const now = Date.parse('2026-10-08T11:30:00.000Z')
    const open = { from: now - 3 * DAY, to: now, open: true, windowless: false }

    it('offers 1 min and 5 min first, ending at now, in 10 s buckets that stream', () => {
        expect(SPARK_RANGES.slice(0, 3).map(r => r.label)).toEqual(['1 min', '5 min', '15 min'])
        for (const [id, span] of [['1m', MIN], ['5m', 5 * MIN]]) {
            const r = spark_range(id, open, now)
            expect(r).toEqual({ from: now - span, to: now })
            const every = every_for_width(r.from, r.to, 800)
            expect(every).toBe('10s')
            expect(live_mode(r, every, now).stream).toBe(true)
        }
        expect(default_spark_range(open, now)).toBe('24h')
    })

    it('draws the raw values over the 10 s buckets on a sparkline', () => {
        const buckets = Array.from({ length: 6 }, (_, i) => [now - MIN + i * 10 * SEC, 1, 10])
        const raw = Array.from({ length: 20 }, (_, i) => [now - 20 * SEC + i * SEC, 2 + (i % 2)])
        const { rows } = display_rows({ points: buckets, tail: raw }, '10s', { until: now })
        // Buckets until the raw values begin, then every raw value.
        expect(rows.filter(r => r[0] >= now - 20 * SEC)).toEqual(raw)
        expect(rows[0]).toEqual([now - MIN, 1])
        const d = sparkline_path(rows, { from: now - MIN, to: now, w: 600, h: 20, step: true })
        expect(d.match(/V/g).length).toBeGreaterThan(10)
    })
})
