/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The energy and carbon add-on.
 *
 * Its figures are quoted as carbon per run, so the method must match
 * the dashboards: half-hourly energy from a cumulative register, a
 * fixed factor, and grid intensity plus 0.05 kg/kWh for CH4 and N2O.
 * It must also be honest about coverage rather than fill gaps.
 */

import { describe, it, expect } from 'vitest'
import {
    parse_csv, series_of, find_energy_series, find_intensity_series,
    interpolate_at, held_at, boundaries, energy_and_carbon, half_hour_rows,
} from '../src/lib/datasets/energy.js'

const T0 = Date.parse('2026-10-07T08:00:00.000Z')
const MIN = 60e3

// A register rising 10 kWh every 15 minutes.
function register (from, to, step = 15 * MIN, per = 10) {
    const pts = []
    for (let t = from, v = 1000; t <= to; t += step, v += per) pts.push({ t, v })
    return pts
}

describe('CSV', () => {
    it('parses the Data Access columns and groups series', () => {
        const csv = 'device,metric,timestamp,value,unit\r\n' +
            'M1,Active_Energy_Total,2026-10-07T08:00:00.000Z,100,kWh\r\n' +
            'M1,Active_Energy_Total,2026-10-07T08:15:00.000Z,110,kWh\r\n' +
            'M1,Status,2026-10-07T08:00:00.000Z,Running,\r\n'
        const s = series_of(parse_csv(csv))
        expect(s).toHaveLength(2)
        const e = s.find(x => x.metric === 'Active_Energy_Total')
        expect(e.points).toEqual([{ t: T0, v: 100 }, { t: T0 + 15 * MIN, v: 110 }])
    })
})

describe('series detection', () => {
    it('prefers active delivered energy over returned or reactive', () => {
        const pts = register(T0, T0 + 60 * MIN)
        const found = find_energy_series([
            { device: 'M', metric: 'Reactive_Energy_Total', unit: 'kVArh', points: pts },
            { device: 'M', metric: 'Active_Energy_Returned_Total', unit: 'kWh', points: pts },
            { device: 'M', metric: 'Active_Energy_Total', unit: 'kWh', points: pts },
            { device: 'M', metric: 'Active_Power', unit: 'kW', points: pts },
        ])
        expect(found[0].metric).toBe('Active_Energy_Total')
        expect(found.map(f => f.metric)).not.toContain('Active_Power')
    })

    it('skips a series that falls more than it rises', () => {
        const pts = [{ t: 1, v: 5 }, { t: 2, v: 4 }, { t: 3, v: 3 }, { t: 4, v: 2 }]
        expect(find_energy_series([{ device: 'M', metric: 'Energy', unit: 'kWh', points: pts }])).toEqual([])
    })

    it('scales Wh and MWh to kWh', () => {
        const pts = register(T0, T0 + 30 * MIN)
        const [wh] = find_energy_series([{ device: 'M', metric: 'E', unit: 'Wh', points: pts }])
        expect(wh.scale).toBe(0.001)
    })

    it('finds grid intensity by unit or name', () => {
        const s = find_intensity_series([
            { device: 'G', metric: 'Yorkshire/Intensity/Forecast', unit: 'gCO2/kWh', points: [{ t: T0, v: 100 }] },
            { device: 'G', metric: 'Other', unit: '', points: [{ t: T0, v: 1 }] },
        ])
        expect(s).toHaveLength(1)
    })
})

describe('interpolation', () => {
    it('interpolates inside the series and refuses outside it', () => {
        const pts = [{ t: 0, v: 0 }, { t: 10, v: 100 }]
        expect(interpolate_at(pts, 5)).toBe(50)
        expect(interpolate_at(pts, 11)).toBe(null)
        expect(held_at(pts, 12, 5)).toBe(100)
        expect(held_at(pts, 20, 5)).toBe(null)
    })

    it('splits a window at half hours', () => {
        expect(boundaries(T0 + 10 * MIN, T0 + 70 * MIN))
            .toEqual([T0 + 10 * MIN, T0 + 30 * MIN, T0 + 60 * MIN, T0 + 70 * MIN])
    })
})

describe('energy and carbon', () => {
    const meters = [{ device: 'M', metric: 'Active_Energy_Total', scale: 1, points: register(T0, T0 + 120 * MIN) }]

    it('matches the dashboard method on a two-hour run', () => {
        const intensity = [
            { t: T0, v: 100 }, { t: T0 + 30 * MIN, v: 200 },
            { t: T0 + 60 * MIN, v: 100 }, { t: T0 + 90 * MIN, v: 200 },
        ]
        const r = energy_and_carbon({ meters, intensity, from: T0, to: T0 + 120 * MIN })
        // 40 kWh/h for 2 h.
        expect(r.kwh).toBeCloseTo(80, 6)
        expect(r.kg_fixed).toBeCloseTo(80 * 0.21233, 6)
        // Each half hour is 20 kWh: 20 x (0.1 + 0.05) + 20 x (0.2 + 0.05), twice.
        expect(r.kg_grid).toBeCloseTo(2 * (20 * 0.15 + 20 * 0.25), 6)
        expect(r.coverage).toBe(1)
        expect(r.confidence).toBe('high')
        expect(half_hour_rows(r.segments)).toHaveLength(4)
    })

    it('does not count time before the first reading, and says so', () => {
        const r = energy_and_carbon({ meters, from: T0 - 60 * MIN, to: T0 + 120 * MIN })
        expect(r.kwh).toBeCloseTo(80, 6)
        expect(r.coverage).toBeCloseTo(2 / 3, 6)
        expect(r.confidence).toBe('low')
        // No intensity series: no grid figure at all, rather than zero.
        expect(r.kg_grid).toBe(null)
    })

    it('drops a meter reset instead of counting a negative', () => {
        const pts = register(T0, T0 + 60 * MIN)
        pts.push({ t: T0 + 75 * MIN, v: 0 }, { t: T0 + 90 * MIN, v: 10 })
        const r = energy_and_carbon({ meters: [{ ...meters[0], points: pts }], from: T0, to: T0 + 90 * MIN })
        expect(r.bad_segments).toBe(1)
        expect(r.kwh).toBeCloseTo(40, 6)
    })

    it('reports energy with no intensity separately', () => {
        const intensity = [{ t: T0, v: 100 }]
        const r = energy_and_carbon({ meters, intensity, from: T0, to: T0 + 120 * MIN })
        // Intensity is held for 6 h, so the whole run is covered.
        expect(r.kwh_no_intensity).toBe(0)
        const late = energy_and_carbon({ meters, intensity: [{ t: T0 - 7 * 3600e3, v: 100 }], from: T0, to: T0 + 120 * MIN })
        expect(late.kwh_no_intensity).toBeCloseTo(80, 6)
        expect(late.kg_grid).toBe(null)
    })

    it('sums several meters', () => {
        const r = energy_and_carbon({ meters: [meters[0], { ...meters[0], device: 'N' }], from: T0, to: T0 + 60 * MIN })
        expect(r.kwh).toBeCloseTo(80, 6)
    })
})

describe('review fixes', () => {
    // A register read every minute at 60 kW, starting a minute inside the
    // window, as a Data Access CSV cut at the window would give.
    const dense = (from, to) => register(from + MIN, to - MIN, MIN, 1)

    it('covers the window edges with an estimate from the nearest readings', () => {
        const from = T0 + 10 * MIN, to = T0 + 25 * MIN
        const r = energy_and_carbon({ meters: [{ device: 'M', metric: 'E', scale: 1, points: dense(from, to) }], from, to })
        expect(r.kwh).toBeCloseTo(15, 6)
        expect(r.coverage).toBe(1)
        expect(r.estimated_kwh).toBeCloseTo(15, 6)
    })

    it('covers a two-hour run in full', () => {
        const from = T0, to = T0 + 120 * MIN
        const r = energy_and_carbon({ meters: [{ device: 'M', metric: 'E', scale: 1, points: dense(from, to) }], from, to })
        expect(r.kwh).toBeCloseTo(120, 6)
        expect(r.confidence).toBe('high')
    })

    it('does not spread energy across a long silence', () => {
        const pts = [{ t: T0, v: 0 }, { t: T0 + 6 * 60 * MIN, v: 60 }]
        const r = energy_and_carbon({ meters: [{ device: 'M', metric: 'E', scale: 1, points: pts }], from: T0, to: T0 + 6 * 60 * MIN })
        expect(r.coverage).toBe(0)
        expect(r.kwh).toBe(0)
    })

    it('ignores registers with a non-energy unit', () => {
        const pts = register(T0, T0 + 60 * MIN)
        expect(find_energy_series([{ device: 'M', metric: 'Reactive Energy', unit: 'kvarh', points: pts }])).toEqual([])
        expect(find_energy_series([{ device: 'M', metric: 'Energy', unit: '', points: pts }])).toHaveLength(1)
    })

    it('reads a blank value as missing, not zero', () => {
        const rows = parse_csv('device,metric,timestamp,value,unit\nM,E,2026-10-07T08:00:00.000Z, ,kWh\n')
        expect(rows[0].value).not.toBe(0)
    })
})

describe('meters that report power only', () => {
    it('integrates power into kWh', async () => {
        const { find_power_series, power_to_register } = await import('../src/lib/datasets/energy.js')
        // 60 kW for an hour, read every minute.
        const pts = []
        for (let t = T0; t <= T0 + 60 * MIN; t += MIN) pts.push({ t, v: 60 })
        const series = [
            { device: 'M', metric: 'Three_Phase_Circuits/Supply/Active_Power_Total', unit: 'kW', points: pts },
            { device: 'M', metric: 'Reactive_Power_Total', unit: 'kvar', points: pts },
            { device: 'M', metric: 'Power_Factor_Average', unit: '', points: pts },
        ]
        const found = find_power_series(series)
        expect(found).toHaveLength(1)
        const reg = power_to_register(found[0])
        const r = energy_and_carbon({ meters: [reg], from: T0, to: T0 + 60 * MIN })
        expect(r.kwh).toBeCloseTo(60, 6)
        expect(r.coverage).toBe(1)
    })

    it('scales W to kW and adds nothing across a long silence', async () => {
        const { find_power_series, power_to_register } = await import('../src/lib/datasets/energy.js')
        const pts = [{ t: T0, v: 1000 }, { t: T0 + 3 * 3600e3, v: 1000 }]
        const reg = power_to_register(find_power_series([{ device: 'M', metric: 'Power', unit: 'W', points: pts }])[0])
        expect(reg.points[1].v).toBe(0)
    })
})
