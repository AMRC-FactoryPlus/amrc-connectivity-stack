/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The list's selection actions and the Compare page.
 *
 * Compare overlays one raw metric across runs, each aligned to its own
 * start. It must only offer metrics every run has, say when a metric
 * is not numeric, and keep long lines small enough to draw quickly.
 */

import { describe, it, expect } from 'vitest'
import { DA, STRUCTURE } from '../src/lib/datasets/constants.js'
import { merge_datasets } from '../src/lib/datasets/model.js'
import { parse_csv } from '../src/lib/datasets/energy.js'
import {
    is_finished_run, comparable, compare_problem, group_problem,
    windows_overlap, repeats_rows, metric_key, metric_series, is_numeric,
    common_metrics, align, downsample, fmt_hmm, line_style, LINE_STYLES,
} from '../src/lib/datasets/compare.js'

const DS1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const DS2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const EQ = 'cccccccc-0000-4000-8000-000000000001'
const R1 = 'dddddddd-0000-4000-8000-000000000001'
const R2 = 'dddddddd-0000-4000-8000-000000000002'
const R3 = 'dddddddd-0000-4000-8000-000000000003'

const H = 3600e3
const T0 = Date.parse('2026-10-07T08:00:00.000Z')
const iso = t => new Date(t).toISOString()

function fixture () {
    const run = (uuid, from, to) => ({ uuid, name: uuid.slice(-1), from: iso(from), to: iso(to), function: [DA.Class.Run] })
    const metadata = [
        { uuid: DS1, name: 'Meter' },
        { uuid: DS2, name: 'Spindle' },
        { uuid: EQ, name: 'Lathe', function: [DA.Class.Equipment] },
        run(R1, T0, T0 + 2 * H),
        run(R2, T0 + H, T0 + 3 * H),
        run(R3, T0 + 5 * H, T0 + 6 * H),
    ]
    const session = (uuid, from, to) => ({ uuid, structure: STRUCTURE.SESSION, config: { source: EQ, from: iso(from), to: iso(to) } })
    const structures = [
        { uuid: DS1, structure: STRUCTURE.DEVICE, config: { source: 'dev-1' } },
        { uuid: DS2, structure: STRUCTURE.DEVICE, config: { source: 'dev-2' } },
        { uuid: EQ, structure: STRUCTURE.UNION, config: [DS1, DS2] },
        session(R1, T0, T0 + 2 * H),
        session(R2, T0 + H, T0 + 3 * H),
        session(R3, T0 + 5 * H, T0 + 6 * H),
    ]
    return merge_datasets(metadata, structures)
}

describe('selection', () => {
    const by = fixture()

    it('compares only runs with a start and an end', () => {
        const open = { ...by[R1], to: null }
        expect(is_finished_run(by[R1])).toBe(true)
        expect(is_finished_run(open)).toBe(false)
        expect(is_finished_run(by[EQ])).toBe(false)
        expect(comparable([by[R1], by[EQ], open, by[R2]]).map(r => r.uuid)).toEqual([R1, R2])
    })

    it('needs two finished runs to compare', () => {
        expect(compare_problem([by[R1], by[EQ]])).toMatch(/two runs/)
        expect(compare_problem([by[R1], by[R2], by[EQ]])).toBeNull()
    })

    it('groups runs only', () => {
        expect(group_problem([])).toMatch(/at least one/)
        expect(group_problem([by[R1], by[EQ]])).toMatch(/Only runs/)
        expect(group_problem([by[R1], by[R2]])).toBeNull()
    })
})

describe('repeated rows', () => {
    const by = fixture()

    it('treats a missing end as open', () => {
        expect(windows_overlap(by[R1], by[R2])).toBe(true)
        expect(windows_overlap(by[R1], by[R3])).toBe(false)
        expect(windows_overlap(by[R3], { from: null, to: null })).toBe(true)
    })

    it('warns only when runs share devices and overlap in time', () => {
        expect(repeats_rows([R1, R2], by)).toBe(true)
        expect(repeats_rows([R1, R3], by)).toBe(false)
        expect(repeats_rows([R1], by)).toBe(false)
    })
})

describe('metrics', () => {
    const csv = text => metric_series(parse_csv(`device,metric,timestamp,value,unit\n${text}`))
    const a = csv([
        `Meter,Power,${iso(T0)},5,kW`,
        `Meter,Power,${iso(T0 + 60e3)},6,kW`,
        `Meter,State,${iso(T0)},RUNNING,`,
        `Spindle,Speed,${iso(T0)},1200,rpm`,
    ].join('\n'))
    const b = csv([
        `Meter,Power,${iso(T0)},7,kW`,
        `Meter,State,${iso(T0)},IDLE,`,
    ].join('\n'))

    it('counts rows and keeps numeric points', () => {
        const power = a.get(metric_key('Meter', 'Power'))
        expect(power.rows).toBe(2)
        expect(power.unit).toBe('kW')
        expect(is_numeric(power)).toBe(true)
        const state = a.get(metric_key('Meter', 'State'))
        expect(state.rows).toBe(1)
        expect(is_numeric(state)).toBe(false)
    })

    it('offers only metrics every run has', () => {
        expect(common_metrics([a, b])).toEqual([metric_key('Meter', 'Power'), metric_key('Meter', 'State')])
        expect(common_metrics([])).toEqual([])
    })
})

describe('chart data', () => {
    it('aligns to the run start and drops earlier points', () => {
        const pts = [{ t: T0 - 1000, v: 1 }, { t: T0, v: 2 }, { t: T0 + 90e3, v: 3 }]
        expect(align(pts, T0)).toEqual([[0, 2], [90e3, 3]])
    })

    it('leaves short lines alone', () => {
        const pairs = [[0, 1], [1, 2]]
        expect(downsample(pairs, 10)).toBe(pairs)
    })

    it('keeps each bucket\'s low and high in time order', () => {
        const pairs = Array.from({ length: 10000 }, (_, i) => [i, Math.sin(i / 50)])
        pairs[5000][1] = 99
        pairs[7000][1] = -99
        const out = downsample(pairs, 2000)
        expect(out.length).toBeLessThanOrEqual(2000)
        expect(out.some(p => p[1] === 99)).toBe(true)
        expect(out.some(p => p[1] === -99)).toBe(true)
        for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0])
    })

    it('formats elapsed time as h:mm', () => {
        expect(fmt_hmm(0)).toBe('0:00')
        expect(fmt_hmm(5 * 60e3 + 59e3)).toBe('0:05')
        expect(fmt_hmm(27 * H + 10 * 60e3)).toBe('27:10')
    })

    it('repeats line styles lighter past four runs', () => {
        expect(line_style(0)).toMatchObject({ color: '#0f172a', type: 'solid', opacity: 1 })
        expect(line_style(3).type).toEqual([10, 3, 2, 3])
        expect(line_style(LINE_STYLES.length).color).toBe('#0f172a')
        expect(line_style(LINE_STYLES.length).opacity).toBeLessThan(1)
    })
})
