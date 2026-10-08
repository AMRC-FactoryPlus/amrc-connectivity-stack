/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { describe, it, expect } from 'vitest'
import { STRUCTURE, DA } from '../src/lib/datasets/constants.js'
import { merge_datasets, structure_tree } from '../src/lib/datasets/model.js'
import {
    tab_of, equipment_of, included_list, equipment_change, group_items,
    labels_for, metric_total, filter_metrics, tree_rows, structure_type,
} from '../src/components/Datasets/page/page-logic.js'
import {
    is_energy_metric, energy_applies, energy_sparkplug_ids, pick_meters, pick_intensity,
} from '../src/components/Datasets/addons/energy-logic.js'

const F = '2026-03-02T09:00:00.000Z'
const T = '2026-03-02T11:00:00.000Z'

function world () {
    const meta = (uuid, name, extra = {}) => ({ uuid, name, ...extra })
    const metadata = [
        meta('dd-a', 'Meter A'),
        meta('dd-b', 'Spindle B'),
        meta('dd-c', 'Spindle C'),
        meta('eq', 'Rig 1', {
            function: [DA.Class.Equipment],
            metadata: { [DA.App.EquipmentLabels]: { labels: { 'dd-a': 'Energy' } } },
        }),
        meta('run', 'Rig 1 run', {
            from: F, to: T,
            function: [DA.Class.Run],
            metadata: { [DA.App.RunMetadata]: { equipment: 'eq', devices: ['dd-a', 'dd-b'] } },
            // Data Access fills parts inconsistently, so it is ignored.
            parts: ['eq'],
        }),
        meta('grp', 'Process X', { function: [DA.Class.Operation] }),
    ]
    const structures = [
        { uuid: 'dd-a', structure: STRUCTURE.DEVICE, config: { source: 'dev-a' } },
        { uuid: 'dd-b', structure: STRUCTURE.DEVICE, config: { source: 'dev-b' } },
        { uuid: 'dd-c', structure: STRUCTURE.DEVICE, config: { source: 'dev-c' } },
        { uuid: 'eq', structure: STRUCTURE.UNION, config: ['dd-a', 'dd-b'] },
        { uuid: 'run', structure: STRUCTURE.SESSION, config: { source: 'eq', from: F, to: T } },
        { uuid: 'grp', structure: STRUCTURE.UNION, config: ['run'] },
    ]
    return merge_datasets(metadata, structures)
}

describe('page logic', () => {
    it('reads the tab from the URL', () => {
        expect(tab_of('add-ons')).toBe('add-ons')
        expect(tab_of('history')).toBe('overview')
        expect(tab_of(undefined)).toBe('overview')
    })

    it('finds the equipment of a run', () => {
        const by = world()
        expect(equipment_of(by.run, by).uuid).toBe('eq')
        expect(equipment_of(by.eq, by)).toBeNull()
    })

    it('lists what includes a dataset once', () => {
        const by = world()
        expect(included_list(by.run, by)).toEqual(['grp'])
        expect(included_list(by['dd-a'], by)).toEqual(['eq'])
    })

    it('spots equipment changes after a run', () => {
        const by = world()
        expect(equipment_change(by.run, ['dd-a', 'dd-b'], by)).toEqual({ added: [], removed: [] })
        expect(equipment_change(by.run, ['dd-a', 'dd-c'], by)).toEqual({ added: ['dev-c'], removed: ['dev-b'] })
        // A snapshot of device UUIDs compares the same way.
        const r = { run: { devices: ['dev-a', 'dev-b'] } }
        expect(equipment_change(r, ['dd-a', 'dd-b'], by)).toEqual({ added: [], removed: [] })
        expect(equipment_change({ run: {} }, ['dd-a'], by)).toBeNull()
    })

    it('lists the items of a group, through a session', () => {
        const by = world()
        expect(group_items(by.grp, by)).toEqual(['run'])
        const s = { uuid: 's', structure: STRUCTURE.SESSION, config: { source: 'grp' } }
        expect(group_items(s, by)).toEqual(['run'])
    })

    it('collects equipment labels for runs and groups', () => {
        const by = world()
        expect(labels_for(by.run, by)).toEqual({ 'dd-a': 'Energy' })
        expect(labels_for(by.grp, by)).toEqual({ 'dd-a': 'Energy' })
    })

    it('counts and filters metrics', () => {
        const devs = [
            { uuid: 'a', metrics: [{ path: 'Power/Energy', name: 'Energy', unit: 'kWh' }, { path: 'Power/Volts', name: 'Volts', unit: 'V' }] },
            { uuid: 'b', metrics: [{ path: 'Spindle/Speed', name: 'Speed', unit: 'rpm' }] },
        ]
        expect(metric_total(devs)).toBe(3)
        expect(filter_metrics(devs, '').length).toBe(2)
        const f = filter_metrics(devs, 'kwh')
        expect(f.length).toBe(1)
        expect(f[0].metrics.map(m => m.name)).toEqual(['Energy'])
    })

    it('words the structure tree plainly', () => {
        const by = world()
        const rows = tree_rows(structure_tree('run', by), { deviceName: u => ({ 'dev-a': 'Meter A' })[u] ?? null })
        expect(rows[0].wording).toMatch(/^limited to /)
        expect(rows[1].wording).toBe('combines 2 datasets')
        expect(rows[2].wording).toBe('device Meter A')
        expect(rows[2].label).toBe('Energy')
        expect(rows[3].wording).toBe('device Spindle B')
        expect(structure_type(STRUCTURE.UNION)).toBe('Union components')
    })

    it('marks cycles and unknown nodes', () => {
        const by = merge_datasets([], [
            { uuid: 'x', structure: STRUCTURE.UNION, config: ['y', 'gone'] },
            { uuid: 'y', structure: STRUCTURE.UNION, config: ['x'] },
        ])
        const rows = tree_rows(structure_tree('x', by))
        expect(rows.find(r => r.uuid === 'x' && r.depth === 2).cycle).toBe(true)
        const gone = rows.find(r => r.uuid === 'gone')
        expect(gone.unknown).toBe(true)
        expect(gone.wording).toBe('a dataset you cannot see')
    })
})

describe('energy add-on logic', () => {
    it('recognises energy metrics', () => {
        expect(is_energy_metric({ name: 'Total', unit: 'kWh' })).toBe(true)
        expect(is_energy_metric({ name: 'Active energy', unit: null })).toBe(true)
        expect(is_energy_metric({ name: 'Speed', unit: 'rpm' })).toBe(false)
    })

    it('says when it applies', () => {
        const meter = { metrics: [{ name: 'E', unit: 'kWh' }] }
        const other = { metrics: [{ name: 'S', unit: 'rpm' }] }
        expect(energy_applies({ kind: 'equipment' }, [meter]).state).toBe('no-window')
        expect(energy_applies({ from: F, to: T }, [other]).state).toBe('no-energy')
        expect(energy_applies({ from: F, to: T }, [other, meter]).state).toBe('applies')
        expect(energy_applies({ from: F, to: T }, []).state).toBe('unknown')
    })

    it('maps Energy labels to Sparkplug IDs', () => {
        const by = world()
        const devs = { 'dev-a': { sparkplug: 'MeterA' }, 'dev-b': { sparkplug: 'SpindleB' } }
        expect([...energy_sparkplug_ids({ 'dd-a': 'energy', 'dd-b': 'Spindle' }, by, devs)]).toEqual(['MeterA'])
    })

    const rising = (device, metric, unit) => ({
        device, metric, unit,
        points: [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 3 }],
    })

    it('prefers labelled meters, one register per device', () => {
        const series = [
            rising('MeterA', 'Energy/Active total', 'kWh'),
            rising('MeterA', 'Energy/Reactive total', 'kWh'),
            rising('SpindleB', 'Energy', 'kWh'),
        ]
        const a = pick_meters(series, new Set(['MeterA']))
        expect(a.source).toBe('label')
        expect(a.meters.map(m => m.metric)).toEqual(['Energy/Active total'])
        const b = pick_meters(series, new Set())
        expect(b.source).toBe('all')
        expect(b.meters.map(m => m.device).sort()).toEqual(['MeterA', 'SpindleB'])
        const c = pick_meters(series, new Set(['Nobody']))
        expect(c.source).toBe('all')
    })

    it('picks a grid intensity series if there is one', () => {
        expect(pick_intensity([rising('Grid', 'Intensity/Actual', 'gCO2/kWh')]).metric).toBe('Intensity/Actual')
        expect(pick_intensity([rising('MeterA', 'Energy', 'kWh')])).toBeNull()
    })
})

describe('pick_meters with power-only meters', () => {
    it('uses a register where a device has one, and power otherwise', () => {
        const pts = [{ t: 0, v: 10 }, { t: 60e3, v: 20 }, { t: 120e3, v: 30 }]
        const series = [
            { device: 'Mill_Meter', metric: 'Supply/Active_Power_Total', unit: 'kW', points: pts },
            { device: 'Lathe_Meter', metric: 'Active_Energy_Total', unit: 'kWh', points: pts },
            { device: 'Lathe_Meter', metric: 'Active_Power_Total', unit: 'kW', points: pts },
        ]
        const { meters } = pick_meters(series, new Set())
        const byDevice = Object.fromEntries(meters.map(m => [m.device, m]))
        expect(byDevice.Lathe_Meter.from_power).toBeUndefined()
        expect(byDevice.Mill_Meter.from_power).toBe(true)
        expect(energy_applies({ from: 'a', to: 'b' }, [{ metrics: [{ name: 'Active_Power_Total', unit: 'kW' }] }]).state).toBe('applies')
    })
})

describe('fmt_amount', () => {
    it('keeps small figures readable and large ones tidy', async () => {
        const { fmt_amount } = await import('../src/components/Datasets/addons/energy-logic.js')
        expect(fmt_amount(0.0477)).toBe('0.0477')
        expect(fmt_amount(0.01013)).toBe('0.0101')
        expect(fmt_amount(1.794)).toBe('1.79')
        expect(fmt_amount(12.34)).toBe('12.3')
        expect(fmt_amount(1234.5)).toBe('1,235')
        expect(fmt_amount(0)).toBe('0')
    })
})
