/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Datasets pages: merging Data Access results, resolving devices
 * through unions and sessions, and London time handling.
 *
 * Times matter most here. Data Access accepts only
 * YYYY-MM-DDTHH:mm:ss.sssZ and accepts a start after the end, so the
 * UI is the only thing standing between a person and a broken dataset.
 */

import { describe, it, expect } from 'vitest'
import { DA, STRUCTURE } from '../src/lib/datasets/constants.js'
import {
    merge_datasets, resolve_devices, included_in, device_dataset_for,
    overlapping_devices, dataset_status, structure_tree,
    to_iso, validate_window, fmt_duration, fmt_elapsed, fmt_window,
    london_local_to_ms, ms_to_london_local, london_offset_min,
    track_range, ticks, historised_metrics, normalise_tags, matches,
} from '../src/lib/datasets/model.js'

const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const D2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const DS1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const DS2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const EQ = 'cccccccc-0000-4000-8000-000000000001'
const RUN = 'dddddddd-0000-4000-8000-000000000001'

function fixture () {
    const metadata = [
        { uuid: DS1, name: 'Meter', function: [] },
        { uuid: DS2, name: 'UNKNOWN', function: [] },
        { uuid: EQ, name: 'Lathe', function: [DA.Class.Equipment],
          metadata: {
            [DA.App.Tags]: { tags: ['cnc', ' CNC ', '', 'turning'] },
            [DA.App.EquipmentLabels]: { labels: { [DS1]: 'Energy' } },
          } },
        { uuid: RUN, name: 'Run 1', from: '2026-10-07T08:00:00.000Z', to: '2026-10-07T10:00:00.000Z',
          function: [DA.Class.Run],
          metadata: { [DA.App.RunMetadata]: { createdBy: 'op1', void: { reason: 'test' } } } },
    ]
    const structures = [
        { uuid: DS1, structure: STRUCTURE.DEVICE, config: { source: D1 } },
        { uuid: DS2, structure: STRUCTURE.DEVICE, config: { source: D2 } },
        { uuid: EQ, structure: STRUCTURE.UNION, config: [DS1, DS2] },
        { uuid: RUN, structure: STRUCTURE.SESSION, config: { source: EQ, from: 'x', to: 'y' } },
    ]
    return merge_datasets(metadata, structures)
}

describe('merge_datasets', () => {
    it('joins metadata and structure and reads the UI metadata apps', () => {
        const by = fixture()
        expect(by[EQ].kind).toBe('equipment')
        expect(by[EQ].tags).toEqual(['cnc', 'turning'])
        expect(by[EQ].labels[DS1]).toBe('Energy')
        expect(by[RUN].kind).toBe('run')
        expect(by[RUN].voided).toBe(true)
        expect(by[RUN].created_by).toBe('op1')
        expect(by[DS1].kind).toBe('device')
        // The service's placeholder name is not a name.
        expect(by[DS2].name).toBe(null)
    })

    it('keeps an invalid dataset that only the structure search returns', () => {
        const by = merge_datasets([], [{ uuid: EQ, structure: STRUCTURE.INVALID, config: null }])
        expect(by[EQ].invalid).toBe(true)
        expect(by[EQ].readable).toBe(false)
        expect(dataset_status(by[EQ])).toBe('invalid')
    })
})

describe('structure', () => {
    it('resolves a run to its devices through the equipment', () => {
        const r = resolve_devices(RUN, fixture())
        expect(r.devices.sort()).toEqual([D1, D2])
        expect(r.device_datasets.sort()).toEqual([DS1, DS2])
        expect(r.unknown).toEqual([])
    })

    it('stops on a cycle and reports unknown datasets', () => {
        const by = merge_datasets([], [
            { uuid: EQ, structure: STRUCTURE.UNION, config: [RUN, 'zzzz'] },
            { uuid: RUN, structure: STRUCTURE.UNION, config: [EQ] },
        ])
        const r = resolve_devices(EQ, by)
        expect(r.devices).toEqual([])
        expect(r.unknown).toEqual(['zzzz'])
        const tree = structure_tree(EQ, by)
        expect(tree.children[0].children[0].cycle).toBe(true)
    })

    it('finds what includes a dataset, and device datasets by device', () => {
        const by = fixture()
        expect(included_in(EQ, by)).toEqual([RUN])
        expect(included_in(DS1, by)).toEqual([EQ])
        expect(device_dataset_for(D2, by)).toBe(DS2)
        expect(device_dataset_for('nope', by)).toBe(null)
    })

    it('flags devices reached twice in a union', () => {
        expect(overlapping_devices([EQ, DS1], fixture())).toEqual([DS1])
        expect(overlapping_devices([DS1, DS2], fixture())).toEqual([])
    })
})

describe('status', () => {
    it('shows recording on equipment with a recording record', () => {
        const by = fixture()
        by[EQ].recording = { startedAt: '2026-10-07T08:00:00.000Z' }
        expect(dataset_status(by[EQ])).toBe('recording')
    })

    it('shows filling when the window ends in the future', () => {
        const by = merge_datasets([{ uuid: RUN, to: '2026-10-08T00:00:00.000Z' }], [])
        expect(dataset_status(by[RUN], Date.parse('2026-10-07T12:00:00Z'))).toBe('filling')
        expect(dataset_status(by[RUN], Date.parse('2026-10-09T12:00:00Z'))).toBe('none')
    })
})

describe('time', () => {
    it('writes the exact form Data Access accepts', () => {
        expect(to_iso(Date.UTC(2026, 9, 7, 8, 0, 0))).toBe('2026-10-07T08:00:00.000Z')
        expect(() => to_iso('nonsense')).toThrow()
    })

    it('refuses a start at or after the end', () => {
        expect(validate_window('2026-10-07T10:00:00.000Z', '2026-10-07T09:00:00.000Z')).toMatch(/before/)
        expect(validate_window('2026-10-07T10:00:00.000Z', '2026-10-07T10:00:00.000Z')).toMatch(/before/)
        expect(validate_window('', '2026-10-07T10:00:00.000Z')).toMatch(/start and an end/)
        expect(validate_window('2026-10-07T09:00:00.000Z', '2026-10-07T10:00:00.000Z')).toBe(null)
    })

    it('converts London wall-clock time in summer and winter', () => {
        // BST: 09:12 London is 08:12 UTC.
        expect(to_iso(london_local_to_ms('2026-10-07T09:12'))).toBe('2026-10-07T08:12:00.000Z')
        // GMT: 09:12 London is 09:12 UTC.
        expect(to_iso(london_local_to_ms('2026-12-07T09:12'))).toBe('2026-12-07T09:12:00.000Z')
        expect(ms_to_london_local(Date.parse('2026-10-07T08:12:00.000Z'))).toBe('2026-10-07T09:12')
        expect(london_offset_min(Date.parse('2026-07-01T00:00:00Z'))).toBe(60)
        expect(london_offset_min(Date.parse('2026-01-01T00:00:00Z'))).toBe(0)
    })

    it('formats durations, timers and windows', () => {
        expect(fmt_duration((11 * 60 + 45) * 60e3)).toBe('11h 45m')
        expect(fmt_duration(45e3)).toBe('45s')
        expect(fmt_duration(3 * 86400e3 + 4 * 3600e3)).toBe('3d 4h')
        expect(fmt_elapsed(17 * 60e3 + 22e3)).toBe('00:17:22')
        expect(fmt_window(null, null)).toBe('Ongoing, no time window')
        const now = Date.parse('2026-10-07T12:00:00Z')
        expect(fmt_window('2026-10-07T08:12:00.000Z', '2026-10-07T10:54:00.000Z', now))
            .toBe('Wed 7 Oct, 09:12 – 11:54')
    })
})

describe('timeline', () => {
    it('puts hour ticks on London hours and marks midnight', () => {
        const range = track_range('hours', Date.parse('2026-10-07T12:00:00Z'))
        const t = ticks('hours', range)
        const midnight = t.find(x => x.major)
        expect(midnight.label).toMatch(/^\w{3} \d+ \w{3,4}$/)
        // 24 hourly ticks a day, on a normal day.
        expect(t.filter(x => x.t >= Date.parse('2026-10-06T23:00:00Z') && x.t < Date.parse('2026-10-07T23:00:00Z')).length).toBe(24)
    })

    it('copes with the October clock change (25 hours that day)', () => {
        const range = track_range('hours', Date.parse('2026-10-25T12:00:00Z'))
        const day = ticks('hours', range).filter(x => x.t >= Date.parse('2026-10-24T23:00:00Z') && x.t < Date.parse('2026-10-26T00:00:00Z'))
        // 01:00 happens twice, so the day has 25 hourly ticks, one midnight,
        // and no two ticks at the same instant.
        expect(day.filter(x => x.major).length).toBe(1)
        expect(day.length).toBe(25)
        expect(day.filter(x => x.label === '01:00').length).toBe(2)
        expect(new Set(day.map(x => x.t)).size).toBe(day.length)
    })

    it('copes with the March clock change (23 hours, no 01:00)', () => {
        const range = track_range('hours', Date.parse('2026-03-29T12:00:00Z'))
        const day = ticks('hours', range).filter(x => x.t >= Date.parse('2026-03-29T00:00:00Z') && x.t < Date.parse('2026-03-29T23:00:00Z'))
        expect(day.length).toBe(23)
        expect(day.map(x => x.label)).not.toContain('01:00')
        expect(day.find(x => x.t === Date.parse('2026-03-29T01:00:00Z')).label).toBe('02:00')
    })

    it('marks Mondays in Weeks and January in Years', () => {
        const wr = track_range('weeks', Date.parse('2026-10-07T12:00:00Z'))
        expect(ticks('weeks', wr).filter(x => x.major).every(x => /^\d+ \w{3,4}$/.test(x.label))).toBe(true)
        const yr = track_range('years', Date.parse('2026-10-07T12:00:00Z'))
        expect(ticks('years', yr).filter(x => x.major).map(x => x.label)).toContain('2026')
    })
})

describe('metrics', () => {
    it('lists historised metrics and skips ones not recorded', () => {
        const om = {
            Schema_UUID: 'x',
            Meter: {
                Active_Energy_Total: { Sparkplug_Type: 'Double', Eng_Unit: 'kWh' },
                Debug: { Sparkplug_Type: 'String', Record_To_Historian: false },
            },
            Status: { Sparkplug_Type: 'Boolean' },
        }
        const m = historised_metrics(om)
        expect(m.map(x => x.path)).toEqual(['Meter/Active_Energy_Total', 'Status'])
        expect(m[0].unit).toBe('kWh')
    })
})

describe('search and tags', () => {
    it('matches names, tags and words in any order', () => {
        const r = { uuid: RUN, name: 'Lathe run 3', tags: ['trial'] }
        expect(matches(r, 'run lathe')).toBe(true)
        expect(matches(r, '#trial')).toBe(true)
        expect(matches(r, 'mill')).toBe(false)
        expect(normalise_tags(['a', 'A', 3, ' b '])).toEqual(['a', 'b'])
    })
})

describe('validate_window with numbers', () => {
    it('accepts ms as well as ISO strings', () => {
        expect(validate_window(Date.UTC(2026, 9, 7, 9), Date.UTC(2026, 9, 7, 10))).toBe(null)
        expect(validate_window(Date.UTC(2026, 9, 7, 10), Date.UTC(2026, 9, 7, 9))).toMatch(/before/)
    })
})
