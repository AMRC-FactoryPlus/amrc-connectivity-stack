/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Gaps, coverage and data rate from v1/series counts, and how many
 * datasets an add-on applies to.
 */

import { describe, it, expect } from 'vitest'
import {
    bucket_grid, normal_spacing, device_gaps, window_gaps,
    selection_gap_line, gap_note, fmt_coverage, coverage_sub, recording_gap_note,
    data_rate, fmt_rate,
} from '../src/lib/datasets/gaps.js'
import { ADDONS, addon_applies_count, applies_text } from '../src/lib/datasets/addons.js'
import { sending_summary, fmt_ago } from '../src/lib/datasets/kiosk.js'

const MIN = 60e3
const HOUR = 60 * MIN
// 09:00 London (BST) on 8 October 2026.
const T0 = Date.parse('2026-10-08T08:00:00.000Z')
const W = { from: T0, to: T0 + HOUR, every: '5m' }

/** Rows for 5 minute buckets at the given indexes, `n` points each. */
const rows = (idx, n = 300) => idx.map(i => [T0 + i * 5 * MIN, n])
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i)

describe('bucket_grid', () => {
    it('covers the window in steps', () => {
        expect(bucket_grid(T0, T0 + HOUR, '5m')).toHaveLength(12)
    })
    it('stops at now', () => {
        expect(bucket_grid(T0, T0 + HOUR, '5m', T0 + 12 * MIN)).toHaveLength(3)
    })
    it('starts at the bucket holding from', () => {
        expect(bucket_grid(T0 + 2 * MIN, T0 + 10 * MIN, '5m')[0]).toBe(T0)
    })
})

describe('normal_spacing', () => {
    it('is 1 for a device with data in every bucket', () => {
        expect(normal_spacing([0, 1, 2, 3])).toBe(1)
    })
    it('follows a device that sends every third bucket', () => {
        expect(normal_spacing([0, 3, 6, 9, 20])).toBe(3)
    })
    it('is 1 with too little to tell', () => {
        expect(normal_spacing([4])).toBe(1)
    })
})

describe('device_gaps', () => {
    it('finds no gaps in a full window', () => {
        const g = device_gaps(rows(range(0, 12)), W)
        expect(g.gaps).toEqual([])
        expect(g.points).toBe(12 * 300)
    })

    it('ignores a single empty bucket', () => {
        const g = device_gaps(rows([...range(0, 5), ...range(6, 12)]), W)
        expect(g.gaps).toEqual([])
    })

    it('reports two or more empty buckets on a busy device', () => {
        const g = device_gaps(rows([...range(0, 4), ...range(6, 12)]), W)
        expect(g.gaps).toHaveLength(1)
        expect(g.gaps[0].from).toBe(T0 + 20 * MIN)
        expect(g.gaps[0].to).toBe(T0 + 30 * MIN)
    })

    it('does not count the normal spacing of a slow device as gaps', () => {
        // Data every third bucket: two empty buckets between is normal.
        const g = device_gaps(rows([0, 3, 6, 9], 1), W)
        expect(g.spacing).toBe(3)
        expect(g.gaps).toEqual([])
    })

    it('reports a silence longer than a slow device\'s spacing', () => {
        const g = device_gaps(rows([0, 3, 6, 11], 1), { ...W, to: T0 + 12 * 5 * MIN })
        expect(g.gaps).toHaveLength(1)
        expect(g.gaps[0].i0).toBe(7)
        expect(g.gaps[0].i1).toBe(11)
    })

    it('counts a silence at the end, before now', () => {
        const g = device_gaps(rows(range(0, 6)), { ...W, now: T0 + 50 * MIN })
        expect(g.gaps).toHaveLength(1)
        expect(g.gaps[0].from).toBe(T0 + 30 * MIN)
        expect(g.gaps[0].to).toBe(T0 + 50 * MIN)
    })

    it('treats a device with no data as one gap', () => {
        expect(device_gaps([], W).gaps).toHaveLength(1)
    })

    it('has nothing to say before the window starts', () => {
        const g = device_gaps([], { ...W, now: T0 - MIN })
        expect(g.grid).toEqual([])
        expect(g.gaps).toEqual([])
    })
})

describe('window_gaps', () => {
    it('adds up gaps on separate devices', () => {
        const r = window_gaps({
            a: rows([...range(0, 3), ...range(6, 12)]),
            b: rows([...range(0, 8), ...range(10, 12)]),
            c: rows(range(0, 12)),
        }, W)
        expect(r.total).toBe(2)
        expect(r.shared).toEqual([])
    })

    it('counts a stretch most devices missed as one gap', () => {
        const hole = [...range(0, 4), ...range(8, 12)]
        const r = window_gaps({ a: rows(hole), b: rows(hole), c: rows(range(0, 12)) }, W)
        expect(r.shared).toHaveLength(1)
        expect(r.shared[0].from).toBe(T0 + 20 * MIN)
        expect(r.total).toBe(1)
        expect(r.own.a).toEqual([])
    })

    it('keeps a device gap outside the shared stretch', () => {
        const hole = [...range(0, 4), ...range(8, 12)]
        const r = window_gaps({
            a: rows(hole),
            b: rows([0, 1, 2, 3, 8, 11]),
            c: rows(range(0, 12)),
        }, W)
        // b also misses 9 and 10: its own gap.
        expect(r.shared).toHaveLength(1)
        expect(r.own.b).toHaveLength(1)
        expect(r.total).toBe(2)
    })

    it('never shares with one device', () => {
        const r = window_gaps({ a: rows([...range(0, 4), ...range(8, 12)]) }, W)
        expect(r.shared).toEqual([])
        expect(r.total).toBe(1)
    })

    describe('coverage', () => {
        it('is 1 when nothing is missing', () => {
            expect(window_gaps({ a: rows(range(0, 12)) }, W).coverage).toBe(1)
        })
        it('is the share of device buckets outside gaps', () => {
            const r = window_gaps({
                a: rows([...range(0, 3), ...range(6, 12)]),  // 3 of 12 missing
                b: rows(range(0, 12)),
            }, W)
            expect(r.coverage).toBeCloseTo(21 / 24)
        })
        it('does not punish a slow device for its normal spacing', () => {
            expect(window_gaps({ a: rows([0, 3, 6, 9], 1) }, W).coverage).toBe(1)
        })
        it('is null before the window starts', () => {
            expect(window_gaps({ a: [] }, { ...W, now: T0 - MIN }).coverage).toBeNull()
        })
        it('formats as a percentage', () => {
            expect(fmt_coverage(21 / 24)).toBe('87.5%')
            expect(fmt_coverage(1)).toBe('100%')
            expect(fmt_coverage(null)).toBe('–')
        })
    })
})

describe('words', () => {
    it('gives the selection card line', () => {
        expect(selection_gap_line(0).text).toBe('No gaps in this window')
        expect(selection_gap_line(0).dot).toBe('bg-green-500')
        expect(selection_gap_line(1).text).toBe('1 gap in this window')
        expect(selection_gap_line(3).text).toBe('3 gaps in this window')
        expect(selection_gap_line(3).dot).toBe('bg-amber-500')
    })

    it('notes one gap with its length and start', () => {
        expect(gap_note([{ from: T0 + 20 * MIN, to: T0 + 24 * MIN }])).toBe('1 gap, 4 min at 09:20')
    })

    it('notes the longest of several gaps', () => {
        expect(gap_note([
            { from: T0, to: T0 + 10 * MIN },
            { from: T0 + 30 * MIN, to: T0 + 45 * MIN },
        ])).toBe('2 gaps, longest 15 min at 09:30')
        expect(gap_note([])).toBe('')
    })

    it('names the device in the coverage sub-line', () => {
        const r = window_gaps({ a: rows([...range(0, 3), ...range(6, 12)]), b: rows(range(0, 12)) }, W)
        expect(coverage_sub(r, id => id === 'a' ? 'Spindle' : 'Meter')).toEqual({ text: '1 gap on Spindle', cls: 'text-amber-700' })
        expect(coverage_sub(window_gaps({ a: rows(range(0, 12)) }, W)).text).toBe('Complete')
    })

    it('says when most devices missed the same stretch', () => {
        const hole = [...range(0, 4), ...range(8, 12)]
        const r = window_gaps({ a: rows(hole), b: rows(hole), c: rows(range(0, 12)) }, W)
        expect(coverage_sub(r).text).toBe('1 gap across most devices')
    })

    it('gives the kiosk saved note', () => {
        const r = window_gaps({ a: rows([...range(0, 3), ...range(6, 12)]), b: rows(range(0, 12)) }, W)
        expect(recording_gap_note(r, () => 'Spindle')).toEqual({ text: '1 gap, 15 min at 09:15 on Spindle', gap: true })
        expect(recording_gap_note(window_gaps({ a: rows(range(0, 12)) }, W))).toEqual({ text: 'No gaps', gap: false })
    })
})

describe('data rate', () => {
    it('is the device total, points per second while sending', () => {
        // 300 points per 5 minutes = 1 per second, whatever the metric count.
        const g = device_gaps(rows(range(0, 12)), W)
        expect(data_rate(g, '5m')).toBeCloseTo(1)
    })

    it('leaves out the time in gaps', () => {
        const g = device_gaps(rows([...range(0, 3), ...range(6, 12)]), W)
        expect(data_rate(g, '5m')).toBeCloseTo(1)
    })

    it('is null with no data', () => {
        expect(data_rate(device_gaps([], W), '5m')).toBeNull()
    })

    it('formats as points per second, minute or hour', () => {
        expect(fmt_rate(6)).toBe('6 points/s')
        expect(fmt_rate(1)).toBe('1 point/s')
        expect(fmt_rate(2.5)).toBe('2.5 points/s')
        expect(fmt_rate(0.98)).toBe('59 points/min')
        expect(fmt_rate(4 / 60)).toBe('4 points/min')
        expect(fmt_rate(1 / 60)).toBe('1 point/min')
        expect(fmt_rate(6 / 3600)).toBe('6 points/h')
        expect(fmt_rate(1 / 86400)).toBe('Under 1 point/h')
        expect(fmt_rate(0)).toBe('')
        expect(fmt_rate(null)).toBe('')
    })

    it('reads 4 points a minute from a slow device', () => {
        // 20 points per 5 minutes.
        const g = device_gaps(rows(range(0, 12), 20), W)
        expect(fmt_rate(data_rate(g, '5m'))).toBe('4 points/min')
    })
})

describe('add-ons', () => {
    const meter = { metrics: [{ name: 'Active_Power_Total', unit: 'kW' }] }
    const spindle = { metrics: [{ name: 'Speed', unit: 'rpm' }] }
    const win = { from: '2026-10-08T08:00:00.000Z', to: '2026-10-08T09:00:00.000Z' }
    const records = [
        { uuid: '1', kind: 'run', ...win, devs: [meter] },
        { uuid: '2', kind: 'run', ...win, devs: [spindle] },
        { uuid: '3', kind: 'equipment', devs: [meter] },
        { uuid: '4', kind: 'run', ...win, devs: [meter], voided: true },
        { uuid: '5', kind: 'other', ...win, devs: [spindle, meter] },
        { uuid: '6', kind: 'run', ...win, devs: [] },
    ]
    const devicesOf = r => r.devs

    it('counts datasets with a window and a power or energy metric', () => {
        expect(addon_applies_count('energy', records, devicesOf)).toBe(2)
    })

    it('counts nothing for add-ons that are not available', () => {
        expect(addon_applies_count('cycle', records, devicesOf)).toBe(0)
    })

    it('lists energy and carbon as the only available add-on', () => {
        expect(ADDONS.filter(a => a.available).map(a => a.id)).toEqual(['energy'])
    })

    it('words the count', () => {
        const energy = ADDONS[0]
        expect(applies_text(energy, 2)).toBe('Applies to 2 of your datasets')
        expect(applies_text(energy, 0)).toBe('Applies to none of your datasets yet')
        expect(applies_text(ADDONS[1], 0)).toBe('Not available yet')
    })
})

describe('kiosk: devices sending data', () => {
    const NOW = T0 + HOUR
    const devs = [{ uuid: 'a', name: 'Spindle' }, { uuid: 'b', name: 'Meter' }]

    it('says all devices are sending', () => {
        const s = sending_summary(devs, { a: NOW - 2000, b: NOW - 5000 }, NOW)
        expect(s.text).toBe('All 2 devices sending data')
        expect(s.warn).toBe('')
        expect(fmt_ago(s.last, NOW)).toBe('2 s ago')
    })

    it('names a quiet device', () => {
        const s = sending_summary(devs, { a: T0 - 9 * MIN, b: NOW - 1000 }, NOW)
        expect(s.text).toBe('1 of 2 devices sending data')
        expect(s.warn).toBe('Spindle: no data since 08:51')
    })

    it('words older times', () => {
        expect(fmt_ago(NOW - 4 * MIN, NOW)).toBe('4 min ago')
        expect(fmt_ago(NOW - 2 * HOUR, NOW)).toBe('at 08:00')
    })
})
