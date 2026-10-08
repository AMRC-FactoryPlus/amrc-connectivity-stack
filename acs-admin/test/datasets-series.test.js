/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Series for the Datasets pages: the POST v1/series request and
 * answer, refetching the newest buckets, data strips, "quiet since"
 * and the i3X leaf IDs that live values arrive under.
 */

import { describe, it, expect } from 'vitest'
import { v5 as uuidv5 } from 'uuid'
import { london_local_to_ms } from '../src/lib/datasets/model.js'
import {
    LADDER, STEP_MS, I3X_UUID_NAMESPACE, QUIET_AFTER_MS,
    pick_every, chunk, type_suffix, chartable, series_key, split_key, mean_entry,
    series_request, count_too_long, dataset_window, window_is_live, NO_WINDOW_SPAN, parse_series, series_error,
    bucket_start, bucket_end, live_number, tail_window, replace_tail,
    chart_pairs, extent, sparkline_path,
    density_alpha, density_colour, bucket_cells, bin_counts, window_strip, sum_counts, StripCache,
    fmt_since, device_status, quiet_note,
    i3x_leaf_ids, i3x_leaf_id, metric_label, axis_ticks,
} from '../src/lib/datasets/series.js'

const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const D2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const DS = 'bbbbbbbb-0000-4000-8000-000000000001'
const MIN = 60e3
const HOUR = 60 * MIN
const T0 = Date.parse('2026-10-08T00:00:00.000Z')

describe('the request', () => {
    it('picks the smallest step that fits the points', () => {
        expect(pick_every(T0, T0 + HOUR, 300)).toBe('30s')
        expect(pick_every(T0, T0 + 24 * HOUR, 300)).toBe('5m')
        expect(pick_every(T0, T0 + 14 * 24 * HOUR, 300)).toBe('6h')
        expect(pick_every(T0, T0 + 3000 * 24 * HOUR, 300)).toBe('1w')
        expect(LADDER.every(e => STEP_MS[e] > 0)).toBe(true)
    })

    it('splits long device lists', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    })

    it('maps Sparkplug types to the historian suffix', () => {
        expect(type_suffix('Double')).toBe('d')
        expect(type_suffix('FloatLE')).toBe('d')
        expect(type_suffix('DoubleBE')).toBe('d')
        expect(type_suffix('Int32')).toBe('i')
        expect(type_suffix('UInt64')).toBe('u')
        expect(type_suffix('Boolean')).toBe('b')
        expect(type_suffix('String')).toBe('s')
        expect(chartable('String')).toBe(false)
        expect(chartable('Boolean')).toBe(true)
    })

    it('keys a series by device and full metric name', () => {
        const k = series_key(D1, 'Axes/X/Load')
        expect(split_key(k)).toEqual({ device: D1, metric: 'Axes/X/Load' })
        expect(split_key('nope')).toBe(null)
    })

    it('sends the type with a mean entry, but not for strings', () => {
        expect(mean_entry(D1, { path: 'A/B', type: 'Double' })).toEqual({ device: D1, metric: 'A/B', type: 'd' })
        expect(mean_entry(D1, { path: 'A/S', type: 'String' })).toEqual({ device: D1, metric: 'A/S' })
        expect(mean_entry(D1, { path: 'A/C' })).toEqual({ device: D1, metric: 'A/C' })
    })

    it('builds a device request', () => {
        const b = series_request({ devices: [D1, D2, D1], from: T0, to: T0 + HOUR, every: '5m', count: true, last: '30d' })
        expect(b).toEqual({
            from: '2026-10-08T00:00:00.000Z',
            to: '2026-10-08T01:00:00.000Z',
            devices: [D1, D2],
            every: '5m',
            count: true,
            last: { lookback: '30d' },
        })
    })

    it('builds a dataset request with points and means', () => {
        const mean = [{ device: D1, metric: 'A/B', type: 'd' }]
        const b = series_request({ dataset: DS, from: T0, to: T0 + HOUR, points: 300, mean, last: true })
        expect(b).toEqual({
            from: '2026-10-08T00:00:00.000Z',
            to: '2026-10-08T01:00:00.000Z',
            dataset: DS,
            points: 300,
            mean,
            last: true,
        })
        expect(b.devices).toBeUndefined()
    })

    it('knows when a count needs the coverage summary', () => {
        expect(count_too_long(T0, T0 + 14 * 24 * HOUR)).toBe(false)
        expect(count_too_long(T0, T0 + 14 * 24 * HOUR + 1)).toBe(true)
    })
})

describe('the answer', () => {
    const body = {
        from: '2026-10-08T00:00:00.000Z',
        to: '2026-10-09T00:00:00.000Z',
        every: '15m',
        asOf: '2026-10-08T07:56:10.412Z',
        source: 'raw',
        devices: {
            [D1]: {
                windows: [['2026-10-08T00:00:00.000Z', '2026-10-09T00:00:00.000Z']],
                count: [[T0 + 15 * MIN, 5478], [T0, 4537]],
                last: '2026-10-08T07:55:54.302Z',
            },
            [D2]: { count: [], last: null },
        },
        metrics: [
            { device: D2, metric: 'Supply/Power', type: 'd', unit: 'kW', points: [[T0 + 5 * MIN, 10.2, 243], [T0, 8.3, 191]] },
        ],
        denied: [],
    }

    it('turns times into ms and sorts rows', () => {
        const s = parse_series(body)
        expect(s.from).toBe(T0)
        expect(s.step).toBe(15 * MIN)
        expect(s.asOf).toBe(Date.parse('2026-10-08T07:56:10.412Z'))
        expect(s.devices[D1].count).toEqual([[T0, 4537], [T0 + 15 * MIN, 5478]])
        expect(s.devices[D1].windows).toEqual([[T0, T0 + 24 * HOUR]])
        expect(s.devices[D1].last).toBe(Date.parse('2026-10-08T07:55:54.302Z'))
        expect(s.devices[D2].last).toBe(null)
        const m = s.metrics[series_key(D2, 'Supply/Power')]
        expect(m.unit).toBe('kW')
        expect(m.points[0]).toEqual([T0, 8.3, 191])
    })

    it('leaves last undefined when it was not asked for', () => {
        const s = parse_series({ ...body, devices: { [D1]: { count: [] } } })
        expect(s.devices[D1].last).toBeUndefined()
    })

    it('copes with an empty body', () => {
        const s = parse_series(undefined)
        expect(s.devices).toEqual({})
        expect(s.metrics).toEqual({})
    })

    it('explains failures', () => {
        expect(series_error(413, { message: 'at most 500 devices' })).toBe('Too much at once: at most 500 devices')
        expect(series_error(413)).toMatch(/Too many/)
        expect(series_error(422, { message: '"count" over more than 14 days needs the coverage summary, which is not available yet.' })).toBe('Long-range data strips appear once the coverage summary has been built.')
        expect(series_error(422, { message: 'Use every 1h or more' })).toBe('Use every 1h or more')
        expect(series_error(504)).toMatch(/too long/)
        expect(series_error(503)).toMatch(/historian/)
        expect(series_error(403)).toMatch(/permission/)
        expect(series_error(500)).toMatch(/HTTP 500/)
    })
})

describe('buckets', () => {
    it('aligns short steps to UTC', () => {
        expect(bucket_start(T0 + 7 * MIN, '5m')).toBe(T0 + 5 * MIN)
        expect(bucket_start(T0 + 59 * MIN, '1h')).toBe(T0)
        expect(bucket_end(T0, '15m')).toBe(T0 + 15 * MIN)
    })

    it('aligns days and weeks to London', () => {
        // 8 Oct 2026 is in BST, so London midnight is 23:00 UTC the day before.
        const noon = Date.parse('2026-10-08T11:00:00.000Z')
        expect(bucket_start(noon, '1d')).toBe(Date.parse('2026-10-07T23:00:00.000Z'))
        expect(bucket_end(bucket_start(noon, '1d'), '1d')).toBe(Date.parse('2026-10-08T23:00:00.000Z'))
        // Thursday 8 Oct: the week starts Monday 5 Oct.
        expect(bucket_start(noon, '1w')).toBe(london_local_to_ms('2026-10-05T00:00'))
        // The clock change on 25 Oct makes a 25-hour day.
        const d = london_local_to_ms('2026-10-25T00:00')
        expect(bucket_end(d, '1d') - d).toBe(25 * HOUR)
    })

    it('reads live values as numbers', () => {
        expect(live_number(3.5)).toBe(3.5)
        expect(live_number(true)).toBe(1)
        expect(live_number('2.5')).toBe(2.5)
        expect(live_number('on')).toBe(null)
        expect(live_number(NaN)).toBe(null)
        expect(live_number(null)).toBe(null)
    })
})

describe('refetching the newest buckets', () => {
    it('refetches the two newest buckets', () => {
        const s = { from: T0, to: T0 + 24 * HOUR, every: '5m' }
        expect(tail_window(s, T0 + 12 * MIN)).toEqual({ from: T0 + 5 * MIN, to: T0 + 24 * HOUR })
        // Never before the start of the series.
        expect(tail_window(s, T0 + MIN).from).toBe(T0)
        // A past window: the last two buckets.
        expect(tail_window(s, T0 + 48 * HOUR).from).toBe(T0 + 24 * HOUR - 10 * MIN)
    })

    it('replaces the tail and keeps what came before', () => {
        const k = series_key(D1, 'A')
        const k2 = series_key(D1, 'B')
        const series = {
            from: T0, to: T0 + HOUR, every: '5m', asOf: T0 + 12 * MIN,
            devices: { [D1]: { windows: [], count: [[T0, 5], [T0 + 5 * MIN, 6], [T0 + 10 * MIN, 2]], last: T0 } },
            metrics: {
                [k]: { device: D1, metric: 'A', unit: 'kW', points: [[T0, 1, 1], [T0 + 5 * MIN, 2, 1], [T0 + 10 * MIN, 9, 9]] },
                [k2]: { device: D1, metric: 'B', unit: null, points: [[T0 + 10 * MIN, 1, 1]] },
            },
        }
        const tail = {
            from: T0 + 5 * MIN, to: T0 + HOUR, every: '5m', asOf: T0 + 16 * MIN,
            devices: { [D1]: { windows: [], count: [[T0 + 5 * MIN, 7], [T0 + 15 * MIN, 1]], last: T0 + 15 * MIN } },
            metrics: { [k]: { device: D1, metric: 'A', unit: null, points: [[T0 + 5 * MIN, 3, 2], [T0 + 15 * MIN, 4, 1]] } },
        }
        const out = replace_tail(series, tail)
        expect(out.asOf).toBe(T0 + 16 * MIN)
        expect(out.devices[D1].count).toEqual([[T0, 5], [T0 + 5 * MIN, 7], [T0 + 15 * MIN, 1]])
        expect(out.devices[D1].last).toBe(T0 + 15 * MIN)
        expect(out.metrics[k].points).toEqual([[T0, 1, 1], [T0 + 5 * MIN, 3, 2], [T0 + 15 * MIN, 4, 1]])
        expect(out.metrics[k].unit).toBe('kW')
        // A metric the tail has nothing for loses its stale tail.
        expect(out.metrics[k2].points).toEqual([])
    })
})

describe('charts and sparklines', () => {
    it('breaks lines at missing buckets', () => {
        const pairs = chart_pairs([[T0, 1, 1], [T0 + 5 * MIN, 2, 1], [T0 + 20 * MIN, 3, 1]], '5m')
        expect(pairs).toEqual([[T0, 1], [T0 + 5 * MIN, 2], [T0 + 10 * MIN, null], [T0 + 20 * MIN, 3]])
    })

    it('finds the extent', () => {
        expect(extent([[0, 3], [1, -1], [2, 5]])).toEqual([-1, 5])
        expect(extent([])).toBe(null)
    })

    it('draws a sparkline with gaps', () => {
        const pts = [[T0, 0, 1], [T0 + 5 * MIN, 10, 1], [T0 + 20 * MIN, 5, 1]]
        const d = sparkline_path(pts, { from: T0, to: T0 + 30 * MIN, w: 120, h: 24, every: '5m', pad: 2 })
        expect(d.match(/M/g)).toHaveLength(2)
        expect(d.startsWith('M10 22')).toBe(true)
        expect(d).toContain('L30 2')
        expect(sparkline_path([], { from: T0, to: T0 + HOUR, w: 100, h: 20, every: '5m' })).toBe('')
    })

    it('draws a flat line in the middle', () => {
        const d = sparkline_path([[T0, 4, 1], [T0 + 5 * MIN, 4, 1]], { from: T0, to: T0 + 10 * MIN, w: 100, h: 20, every: '5m' })
        expect(d).toBe('M25 10L75 10')
    })
})

describe('data strips', () => {
    it('shades by density', () => {
        expect(density_alpha(0, 10)).toBe(0)
        expect(density_alpha(1, 100)).toBeCloseTo(0.45)
        expect(density_alpha(100, 100)).toBe(0.85)
        expect(density_alpha(10, 100)).toBeCloseTo(0.65)
        expect(density_alpha(3, 1)).toBe(0.85)
        expect(density_colour(0, 5)).toBe(null)
        expect(density_colour(5, 5)).toBe('rgba(15,23,42,0.85)')
    })

    it('places a cell per bucket with data on the track', () => {
        // Hours zoom: 120 px per hour, so a 5 minute bucket is 10 px.
        const range = { start: T0, px_per_ms: 120 / HOUR }
        const cells = bucket_cells([[T0, 4], [T0 + 5 * MIN, 0], [T0 + 10 * MIN, 8]], { range, every: '5m' })
        expect(cells).toHaveLength(2)
        expect(cells[0]).toMatchObject({ x: 0, w: 9, n: 4 })
        expect(cells[1]).toMatchObject({ x: 20, w: 9, n: 8, colour: 'rgba(15,23,42,0.85)' })
    })

    it('keeps only cells in view', () => {
        const range = { start: T0, px_per_ms: 120 / HOUR }
        const counts = [[T0, 1], [T0 + HOUR, 1], [T0 + 2 * HOUR, 1]]
        const cells = bucket_cells(counts, { range, every: '5m', x0: 100, x1: 200 })
        expect(cells.map(c => c.x)).toEqual([120])
    })

    it('bins counts across a window', () => {
        expect(bin_counts([[T0, 1], [T0 + 30 * MIN, 2], [T0 + 59 * MIN, 3], [T0 + HOUR, 9]], T0, T0 + HOUR, 2)).toEqual([1, 5])
    })

    it('makes a table strip and counts the gaps', () => {
        const counts = [[T0, 5], [T0 + 10 * MIN, 5], [T0 + 50 * MIN, 5]]
        const s = window_strip(counts, { from: T0, to: T0 + HOUR, width: 24, cell: 4 })
        // 6 cells of 10 minutes: data, data, empty, empty, empty, data.
        expect(s.cells.map(c => c.x)).toEqual([0, 4, 20])
        expect(s.cells[0].w).toBe(3)
        expect(s.gaps).toBe(1)
        expect(s.any).toBe(true)
        expect(window_strip([], { from: T0, to: T0 + HOUR }).any).toBe(false)
    })

    it('adds counts for a collapsed equipment row', () => {
        expect(sum_counts([[[T0, 1], [T0 + 5, 2]], [[T0 + 5, 3]]])).toEqual([[T0, 1], [T0 + 5, 5]])
    })
})

describe('strip cache', () => {
    const answer = (asOf, rows) => ({ asOf, devices: { [D1]: { count: rows } } })

    it('asks for what it does not have', () => {
        const c = new StripCache({ every: '5m' })
        const need = c.missing([D1, D2], T0 + 10 * MIN, T0 + 90 * MIN, T0 + 10 * HOUR)
        expect(need).toEqual({ devices: [D1, D2], from: T0, to: T0 + 2 * HOUR })
    })

    it('keeps closed chunks and does not fetch them again', () => {
        const c = new StripCache({ every: '5m' })
        c.put([D1, D2], T0, T0 + 2 * HOUR, answer(T0 + 10 * HOUR, [[T0, 3], [T0 + HOUR, 4]]))
        expect(c.missing([D1, D2], T0, T0 + 2 * HOUR, T0 + 10 * HOUR)).toBe(null)
        expect(c.get(D1)).toEqual([[T0, 3], [T0 + HOUR, 4]])
        // D2 had no data, and that is remembered too.
        expect(c.get(D2)).toEqual([])
        expect(c.max(D1)).toBe(4)
        // A third hour is still missing.
        expect(c.missing([D1], T0, T0 + 3 * HOUR, T0 + 10 * HOUR)).toEqual({ devices: [D1], from: T0 + 2 * HOUR, to: T0 + 3 * HOUR })
    })

    it('fetches an open chunk again once it has ended', () => {
        const c = new StripCache({ every: '5m' })
        const now = T0 + 30 * MIN
        c.put([D1], T0, T0 + HOUR, answer(now, [[T0, 3]]))
        expect(c.missing([D1], T0, T0 + HOUR, now + MIN)).toBe(null)
        expect(c.missing([D1], T0, T0 + HOUR, T0 + HOUR + MIN)).toEqual({ devices: [D1], from: T0, to: T0 + HOUR })
    })

    it('skips the future', () => {
        const c = new StripCache({ every: '5m' })
        expect(c.missing([D1], T0, T0 + 5 * HOUR, T0 + 30 * MIN)).toEqual({ devices: [D1], from: T0, to: T0 + HOUR })
    })

    it('replaces only the polled tail', () => {
        const c = new StripCache({ every: '5m' })
        c.put([D1], T0, T0 + HOUR, answer(T0 + 30 * MIN, [[T0, 3], [T0 + 20 * MIN, 1]]))
        c.put([D1], T0 + 20 * MIN, T0 + 30 * MIN, answer(T0 + 31 * MIN, [[T0 + 20 * MIN, 6], [T0 + 25 * MIN, 2]]))
        expect(c.get(D1)).toEqual([[T0, 3], [T0 + 20 * MIN, 6], [T0 + 25 * MIN, 2]])
        expect(c.get(D1, T0 + 10 * MIN, T0 + 25 * MIN)).toEqual([[T0 + 20 * MIN, 6]])
    })
})

describe('quiet since', () => {
    const now = Date.parse('2026-10-08T10:00:00.000Z')

    it('formats today as a clock time and other days in full', () => {
        expect(fmt_since(Date.parse('2026-10-08T07:51:00.000Z'), now)).toBe('08:51')
        expect(fmt_since(Date.parse('2026-10-06T07:51:00.000Z'), now)).toBe('Tue 6 Oct, 08:51')
    })

    it('is live when online with recent data', () => {
        expect(device_status({ online: true }, now - MIN, now).state).toBe('live')
        // Not known yet: trust the Directory.
        expect(device_status({ online: true }, undefined, now).state).toBe('live')
    })

    it('is quiet when online with old data', () => {
        const s = device_status({ online: true }, Date.parse('2026-10-08T07:51:00.000Z'), now)
        expect(s.state).toBe('quiet')
        expect(s.label).toBe('Quiet since 08:51')
        expect(s.since).toBe(Date.parse('2026-10-08T07:51:00.000Z'))
        expect(device_status({ online: true }, null, now).label).toBe('Quiet for more than 30 days')
        expect(device_status({ online: true }, now - QUIET_AFTER_MS - 1, now).state).toBe('quiet')
    })

    it('is offline when the Directory says so', () => {
        const s = device_status({ online: false, last_change: '2026-10-08T06:00:00.000Z' }, now - HOUR, now)
        expect(s.state).toBe('offline')
        expect(s.label).toBe('Offline since 07:00')
        expect(s.since).toBe(now - HOUR)
        expect(device_status(null, now, now).state).toBe('unknown')
    })

    it('words the lane note', () => {
        expect(quiet_note(Date.parse('2026-10-08T07:51:00.000Z'), now)).toBe('No data since 08:51')
        expect(quiet_note(null, now)).toBe('No data in the last 30 days')
    })
})

describe('i3X leaf IDs', () => {
    const DEV = 'f4ed02cc-4511-4591-a46a-c9ac32e0b471'
    const AXES = '11111111-2222-4333-8444-555555555555'
    const om = {
        Schema_UUID: 'x',
        Instance_UUID: DEV,
        Axes: {
            Schema_UUID: 's1',
            Instance_UUID: AXES,
            X: {
                Schema_UUID: 's2',
                Load: { Sparkplug_Type: 'Double', Eng_Unit: '%' },
                Speed: { Sparkplug_Type: 'Float', Instance_UUID: 'leaf-own-id' },
            },
        },
        Status: { Sparkplug_Type: 'String' },
        Device_Information: { Site: { Value: 'Somewhere' } },
        Documentation: 'Not an object',
    }

    // The rule from acs-i3x, written out longhand.
    const X = uuidv5(`${AXES}:X`, I3X_UUID_NAMESPACE)

    it('follows the i3X rule for every leaf', () => {
        const ids = i3x_leaf_ids(om, DEV)
        expect(ids.get('Axes/X/Load')).toBe(uuidv5(`${X}:Load`, I3X_UUID_NAMESPACE))
        expect(ids.get('Axes/X/Speed')).toBe('leaf-own-id')
        expect(ids.get('Status')).toBe(uuidv5(`${DEV}:Status`, I3X_UUID_NAMESPACE))
        // Plain values (ISA-95 hierarchy) are not objects in i3X.
        expect([...ids.keys()].sort()).toEqual(['Axes/X/Load', 'Axes/X/Speed', 'Status'])
    })

    it('gives the same ID walking one path', () => {
        const ids = i3x_leaf_ids(om, DEV)
        for (const [path, id] of ids) expect(i3x_leaf_id(om, DEV, path)).toBe(id)
    })

    it('returns null for paths i3X has no leaf for', () => {
        expect(i3x_leaf_id(om, DEV, 'Axes/X')).toBe(null)
        expect(i3x_leaf_id(om, DEV, 'Axes/Y/Load')).toBe(null)
        expect(i3x_leaf_id(om, DEV, 'Device_Information/Site')).toBe(null)
        expect(i3x_leaf_id(om, DEV, '')).toBe(null)
        expect(i3x_leaf_id(null, DEV, 'Status')).toBe(null)
    })

    it('uses the namespace from acs-i3x', () => {
        expect(I3X_UUID_NAMESPACE).toBe('11ad7b32-1d32-4c4a-b0c9-fa049208939a')
    })
})

describe('labels and axis', () => {
    it('makes readable metric labels', () => {
        expect(metric_label('Spindle_Speed')).toBe('Spindle speed')
        expect(metric_label('Active_Power_Total')).toBe('Active power total')
        expect(metric_label('True_RMS_Current')).toBe('True RMS current')
        expect(metric_label('load')).toBe('Load')
        expect(metric_label('')).toBe('')
    })

    it('places London-time ticks across a short window', () => {
        const from = Date.parse('2026-10-08T07:25:00.000Z')
        const to = Date.parse('2026-10-08T08:05:00.000Z')
        const t = axis_ticks(from, to, 8)
        expect(t.map(x => x.label)).toEqual(['08:30', '08:40', '08:50', '09:00'])
        expect(t[0].frac).toBeCloseTo(5 / 40)
    })

    it('marks midnight with the day', () => {
        const from = london_local_to_ms('2026-10-07T18:00')
        const to = london_local_to_ms('2026-10-08T18:00')
        const t = axis_ticks(from, to, 8)
        expect(t.find(x => x.major).label).toBe('Thu 8 Oct')
        expect(t.length).toBeLessThanOrEqual(8)
        expect(t.every(x => x.major || /^(00|03|06|09|12|15|18|21):00$/.test(x.label))).toBe(true)
    })

    it('steps in days over long windows', () => {
        const from = london_local_to_ms('2026-09-01T00:00')
        const to = london_local_to_ms('2026-10-01T00:00')
        const t = axis_ticks(from, to, 8)
        expect(t.length).toBeLessThanOrEqual(8)
        expect(t.every(x => x.major)).toBe(true)
    })
})

describe('the dataset window', () => {
    const now = T0 + 10 * HOUR

    it('uses the dataset window', () => {
        const w = dataset_window({ from: '2026-10-08T01:00:00.000Z', to: '2026-10-08T02:00:00.000Z' }, now)
        expect(w).toEqual({ from: T0 + HOUR, to: T0 + 2 * HOUR, open: false, windowless: false })
        expect(window_is_live(w, now)).toBe(false)
    })

    it('shows the last 24 hours without a window', () => {
        const w = dataset_window({ from: null, to: null }, now)
        expect(w).toEqual({ from: now - NO_WINDOW_SPAN, to: now, open: true, windowless: true })
        expect(window_is_live(w, now + HOUR)).toBe(true)
    })

    it('is live while the window holds now', () => {
        const w = dataset_window({ from: '2026-10-08T09:00:00.000Z', to: '2026-10-08T12:00:00.000Z' }, now)
        expect(window_is_live(w, now)).toBe(true)
    })
})

describe('calling the service (fake client)', async () => {
    const { fetch_series, download_csv } = await import('../src/lib/datasets/api.js')
    const fake = (status, body) => {
        const calls = []
        return {
            calls,
            DataAccess: { fetch: async opts => { calls.push(opts); return [status, body, undefined, new Map()] } },
        }
    }

    it('posts to v1/series and parses the answer', async () => {
        const client = fake(200, { from: '2026-10-08T00:00:00.000Z', to: '2026-10-08T01:00:00.000Z', every: '5m', asOf: '2026-10-08T00:30:00.000Z', devices: { [D1]: { count: [[T0, 3]], last: null } }, metrics: [], denied: [] })
        const body = series_request({ devices: [D1], from: T0, to: T0 + HOUR, every: '5m', count: true })
        const s = await fetch_series(client, body)
        expect(client.calls[0]).toEqual({ url: 'v1/series', method: 'POST', body })
        expect(s.devices[D1].count).toEqual([[T0, 3]])
    })

    it('throws a readable error', async () => {
        await expect(fetch_series(fake(504), {})).rejects.toMatchObject({ status: 504, message: expect.stringMatching(/too long/) })
        await expect(fetch_series(fake(413, { error: 'too_many', message: 'at most 500 devices' }), {}))
            .rejects.toMatchObject({ message: 'Too much at once: at most 500 devices' })
    })

    it('asks for pinned metrics only, and says when the service refuses', async () => {
        const client = fake(422, { message: 'unknown field' })
        await expect(download_csv(client, DS, null, { metrics: ['A/B'] }))
            .rejects.toMatchObject({ message: 'The service refused the pinned-only download.' })
        expect(client.calls[0]).toMatchObject({ url: `v1/data/${DS}`, method: 'POST', body: { metrics: ['A/B'] } })
    })

    it('keeps the whole-dataset download body empty', async () => {
        const client = fake(403)
        await expect(download_csv(client, DS, null)).rejects.toMatchObject({ status: 403 })
        expect(client.calls[0].body).toEqual({})
    })
})
