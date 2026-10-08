/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Review fixes for the Datasets pages: stale pins, the 400 day chart
 * limit, request splitting, live duplicates and quality, dataset
 * windows in gaps, the data rate at any moment, and long-zoom strips
 * from the coverage summary.
 */

import { describe, it, expect } from 'vitest'
import {
    LIMITS, STEP_MS, COVERAGE_NOTE, StripCache, bucket_start, bucket_end, bucket_total,
    coverage_every, strip_every, coverage_not_ready, stray_mean_device, mean_window,
    append_live_items, good_quality, usable_windows, parse_series, series_error, series_key,
} from '../src/lib/datasets/series.js'
import { device_gaps, window_gaps, data_rate, fmt_rate } from '../src/lib/datasets/gaps.js'
import { pinned_entries, stale_pins } from '../src/components/Datasets/page/page-logic.js'

const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const D2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const D3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// 09:00 London (BST) on 8 October 2026.
const T0 = Date.parse('2026-10-08T08:00:00.000Z')

describe('stale pins (1)', () => {
    const keys = [series_key(D1, 'A/Speed'), series_key(D2, 'B/Load')]
    const byUuid = {
        [D1]: { name: 'Spindle', metrics: [{ path: 'A/Speed', name: 'Speed', type: 'Double' }] },
        [D2]: { name: 'Meter', metrics: [{ path: 'B/Load', name: 'Load', type: 'Double' }] },
    }

    it('leaves out pins for devices the dataset no longer covers', () => {
        expect(pinned_entries(keys, byUuid, [D1]).map(e => e.device)).toEqual([D1])
        expect(pinned_entries(keys, byUuid).map(e => e.device)).toEqual([D1, D2])
    })

    it('finds the pins to forget', () => {
        expect(stale_pins(keys, [D1])).toEqual([series_key(D2, 'B/Load')])
        expect(stale_pins(keys, [D1, D2])).toEqual([])
    })

    it('reads the device a refusal names', () => {
        expect(stray_mean_device({ status: 422, detail: `"mean" device ${D2} is not in the dataset.` })).toBe(D2)
        expect(stray_mean_device({ status: 422, detail: 'something else' })).toBe(null)
        expect(stray_mean_device({ status: 403 })).toBe(null)
    })
})

describe('charts over 400 days (2)', () => {
    it('keeps a window up to 400 days', () => {
        expect(mean_window(T0, T0 + 400 * DAY)).toEqual({ from: T0, to: T0 + 400 * DAY, clamped: false })
    })

    it('charts the most recent 400 days of a longer window', () => {
        const w = mean_window(T0, T0 + 900 * DAY)
        expect(w).toEqual({ from: T0 + 500 * DAY, to: T0 + 900 * DAY, clamped: true })
        expect(w.to - w.from).toBe(LIMITS.mean_span)
    })
})

describe('request size (3)', () => {
    it('counts buckets like the service', () => {
        expect(bucket_total(T0, T0 + HOUR, '5m')).toBe(12)
        expect(bucket_total(T0 + MIN, T0 + HOUR, '5m')).toBe(12)
        expect(bucket_total(T0, T0 + HOUR + 1, '5m')).toBe(13)
        expect(bucket_total(T0, T0 + 7 * DAY, '1d')).toBe(8)
    })

    it('splits a long Hours selection into pieces under 2,000 buckets', () => {
        const c = new StripCache({ every: '5m' })
        const from = T0 + 7 * MIN, to = from + 15 * DAY
        const pieces = c.pieces(from, to, 1900)
        expect(pieces.length).toBeGreaterThan(1)
        expect(pieces[0].from).toBe(from)
        expect(pieces.at(-1).to).toBe(to)
        for (let i = 1; i < pieces.length; i++) expect(pieces[i].from).toBe(pieces[i - 1].to)
        for (const p of pieces) {
            expect(bucket_total(p.from, p.to, '5m')).toBeLessThanOrEqual(1900)
            // Each piece is a raw count, so it stays within 14 days.
            expect(p.to - p.from).toBeLessThanOrEqual(LIMITS.count_span)
        }
    })

    it('keeps a short range in one piece', () => {
        const c = new StripCache({ every: '5m' })
        expect(c.pieces(T0, T0 + 3 * HOUR)).toEqual([{ from: T0, to: T0 + 3 * HOUR }])
    })
})

describe('live values (4)', () => {
    const E = { device: D1, path: 'A/Speed', unit: 'rpm' }
    const key = series_key(D1, 'A/Speed')
    const lookup = id => id === 'e1' ? E : null
    const base = () => ({
        every: '5m', asOf: T0 + 2 * MIN,
        devices: { [D1]: { count: [], windows: [], last: undefined } },
        metrics: { [key]: { device: D1, metric: 'A/Speed', type: 'd', unit: 'rpm', points: [[T0, 10, 2]] } },
    })
    const item = (t, value, quality = 'Good') => ({ elementId: 'e1', value, quality, timestamp: new Date(t).toISOString() })

    it('keeps a value newer than asOf as a raw tail, not in the buckets', () => {
        const s = append_live_items(base(), [item(T0 + 3 * MIN, 40)], lookup)
        expect(s.metrics[key].points).toEqual([[T0, 10, 2]])
        expect(s.metrics[key].tail).toEqual([[T0 + 3 * MIN, 40]])
    })

    it('does not count an SSE replay twice', () => {
        const s = append_live_items(base(), [item(T0 + 3 * MIN, 40)], lookup)
        const again = append_live_items(s, [item(T0 + 3 * MIN, 40), item(T0 + 2.5 * MIN, 99)], lookup)
        expect(again).toBe(s)
    })

    it('skips values at or before the device\'s newest data time', () => {
        const s = base()
        s.devices[D1].last = T0 + 4 * MIN
        expect(append_live_items(s, [item(T0 + 4 * MIN, 40)], lookup)).toBe(s)
        expect(append_live_items(s, [item(T0 + 4 * MIN + 1, 40)], lookup)).not.toBe(s)
    })

    it('does not chart values of bad or uncertain quality', () => {
        const s = base()
        expect(append_live_items(s, [item(T0 + 3 * MIN, 40, 'Bad')], lookup)).toBe(s)
        expect(append_live_items(s, [item(T0 + 3 * MIN, 40, 'Uncertain')], lookup)).toBe(s)
        expect(good_quality(undefined)).toBe(true)
        expect(good_quality('Good')).toBe(true)
    })
})

describe('dataset windows in gaps (5)', () => {
    const W = { from: T0, to: T0 + HOUR, every: '5m' }
    const rows = (idx, n = 300) => idx.map(i => [T0 + i * 5 * MIN, n])
    const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i)

    it('treats time outside the device\'s windows as neither data nor gap', () => {
        // In the dataset for the first and last 15 minutes only, with data throughout them.
        const windows = [[T0, T0 + 15 * MIN], [T0 + 45 * MIN, T0 + HOUR]]
        const g = device_gaps(rows([...range(0, 3), ...range(9, 12)]), { ...W, windows })
        expect(g.grid.length).toBe(6)
        expect(g.gaps).toEqual([])
        expect(g.sending).toBe(30 * MIN)
    })

    it('does not run a gap across time outside the windows', () => {
        const windows = [[T0, T0 + 15 * MIN], [T0 + 45 * MIN, T0 + HOUR]]
        // One empty bucket either side of the hole: neither is a gap.
        const g = device_gaps(rows([0, 1, 10, 11]), { ...W, windows })
        expect(g.gaps).toEqual([])
    })

    it('keeps coverage at 100% for a device that joined late', () => {
        const r = window_gaps(
            { [D1]: rows(range(0, 12)), [D2]: rows(range(6, 12)) },
            { ...W, windows: { [D2]: [[T0 + 30 * MIN, T0 + HOUR]] } },
        )
        expect(r.total).toBe(0)
        expect(r.coverage).toBe(1)
    })

    it('shares a stretch only among devices inside their windows then', () => {
        const hole = [...range(0, 4), ...range(8, 12)]
        const r = window_gaps(
            { [D1]: rows(hole), [D2]: rows(hole), [D3]: rows(range(0, 4)) },
            { ...W, windows: { [D3]: [[T0, T0 + 20 * MIN]] } },
        )
        expect(r.shared).toHaveLength(1)
        expect(r.total).toBe(1)
    })

    it('leaves ranges the summary has not reached out of the windows', () => {
        expect(usable_windows(null, [[T0 + 10 * MIN, T0 + 20 * MIN]], T0, T0 + HOUR))
            .toEqual([[T0, T0 + 10 * MIN], [T0 + 20 * MIN, T0 + HOUR]])
        expect(usable_windows([[T0, T0 + 30 * MIN]], [], T0 + 10 * MIN, T0 + HOUR))
            .toEqual([[T0 + 10 * MIN, T0 + 30 * MIN]])
    })
})

describe('data rate at any moment (6)', () => {
    // A 1 Hz device with one metric, counted in 5 minute buckets over
    // the last hour, with `now` part way through a bucket.
    function one_hz (now) {
        const from = now - HOUR
        const out = []
        for (let t = bucket_start(from, '5m'); t < now; t = bucket_end(t, '5m')) {
            const a = Math.max(t, from), b = Math.min(bucket_end(t, '5m'), now)
            out.push([t, Math.round((b - a) / SEC)])
        }
        return { counts: out, from, to: now }
    }

    for (const offset of [0, 7 * SEC, 2 * MIN + 13 * SEC, 4 * MIN + 59 * SEC]) {
        it(`reads 1 point/s ${offset / SEC} s into a bucket`, () => {
            const now = T0 + offset
            const { counts, from, to } = one_hz(now)
            const g = device_gaps(counts, { from, to, every: '5m', now })
            expect(data_rate(g, '5m')).toBeCloseTo(1, 2)
            expect(fmt_rate(data_rate(g, '5m'))).toBe('1 point/s')
        })
    }
})

describe('long-zoom strips (13)', () => {
    it('picks the step each zoom prefers', () => {
        expect(strip_every('hours', T0, T0 + 3 * DAY)).toBe('5m')
        expect(strip_every('days', T0, T0 + 7 * DAY)).toBe('1h')
        expect(strip_every('weeks', T0, T0 + 60 * DAY)).toBe('6h')
        expect(strip_every('years', T0, T0 + 700 * DAY)).toBe('1d')
    })

    it('goes coarser to stay under the bucket limit', () => {
        expect(strip_every('days', T0, T0 + 100 * DAY, 1900)).toBe('6h')
        expect(strip_every('years', T0, T0 + 2500 * DAY, 1900)).toBe('1w')
        const from = T0, to = T0 + 2500 * DAY
        expect(bucket_total(from, to, strip_every('years', from, to, 1900))).toBeLessThanOrEqual(1900)
        expect(coverage_every(T0, T0 + 30 * DAY, { max: 1000 })).toBe('1h')
        expect(coverage_every(T0, T0 + 300 * DAY, { max: 1000 })).toBe('1d')
    })

    it('caches days in London weeks, so a chunk never splits a bucket', () => {
        const c = new StripCache({ every: '1d' })
        const chunks = c.chunks(T0, T0 + 30 * DAY)
        for (const ch of chunks) {
            expect(bucket_start(ch, '1w')).toBe(ch)
            expect(bucket_start(ch, '1d')).toBe(ch)
        }
        // Across the clocks going back on 25 October 2026.
        expect(chunks.some(ch => ch > Date.parse('2026-10-25T00:00:00Z'))).toBe(true)
    })

    it('caches closed past buckets and asks again for pending ones later', () => {
        const c = new StripCache({ every: '1h' })
        const asOf = T0 + 40 * DAY
        const from = c.chunk_start(T0), to = from + 3 * DAY
        const answer = parse_series({
            every: '1h', asOf: new Date(asOf).toISOString(), source: 'mixed',
            pending: [[new Date(from + DAY).toISOString(), new Date(from + 2 * DAY).toISOString()]],
            devices: { [D1]: { count: [[T0 + HOUR, 5]] } },
        })
        c.put([D1], from, to, answer)
        expect(c.get(D1)).toEqual([[T0 + HOUR, 5]])
        // The day still being summarised is asked for again after a few minutes.
        expect(c.missing([D1], from, to, asOf + MIN)).toBe(null)
        expect(c.missing([D1], from, to, asOf + 10 * MIN)).toEqual({ devices: [D1], from: from + DAY, to: from + 2 * DAY })
    })

    it('knows when the coverage summary is not ready', () => {
        const err = { status: 422, detail: '"count" over more than 14 days needs the coverage summary, which is not available yet.', message: COVERAGE_NOTE }
        expect(coverage_not_ready(err)).toBe(true)
        expect(coverage_not_ready({ status: 422, detail: 'Over 2000 buckets' })).toBe(false)
        expect(coverage_not_ready({ status: 503 })).toBe(false)
        expect(series_error(422, { message: err.detail })).toBe(COVERAGE_NOTE)
    })
})

describe('errors with text bodies', () => {
    it('gives a message for each status without reading a body', () => {
        for (const body of [undefined, 'Server error: ']) {
            expect(series_error(403, body)).toMatch(/permission/)
            expect(series_error(404, body)).toMatch(/cannot find/)
            expect(series_error(503, body)).toMatch(/historian/)
            expect(series_error(504, body)).toMatch(/too long/)
            expect(series_error(500, body)).toMatch(/HTTP 500/)
        }
    })

    it('reads pending ranges and leaves them out when absent', () => {
        expect(parse_series({ every: '1h' }).pending).toEqual([])
        expect(STEP_MS['1w']).toBe(7 * DAY)
    })
})
