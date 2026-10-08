/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Dataset builder: turning existing datasets and timeline selections
 * into builder state, validating it, and working out what saving will
 * store. Also the pickers' grouping and loop checks.
 */

import { describe, it, expect } from 'vitest'
import { STRUCTURE } from '../src/lib/datasets/constants.js'
import { merge_datasets } from '../src/lib/datasets/model.js'
import {
    empty_state, item_for, source_items, state_from_record, state_from_query,
    dedupe_items, covered_devices, repeated_devices, device_dataset_plan,
    item_datasets, labels_by_dataset, shows_window, window_of, window_problem,
    problems, store_rows, ancestors, picker_exclusions, equipment_by_device,
    text_match, group_devices,
} from '../src/components/Datasets/builder/builder.js'

const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const D2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const D3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const DS1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const DS2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const EQ = 'cccccccc-0000-4000-8000-000000000001'
const RUN = 'dddddddd-0000-4000-8000-000000000001'
const RUNU = 'dddddddd-0000-4000-8000-000000000002'
const RUN1 = 'dddddddd-0000-4000-8000-000000000003'
const PROC = 'eeeeeeee-0000-4000-8000-000000000001'

const FROM = '2026-03-02T09:00:00.000Z'
const TO = '2026-03-02T11:30:00.000Z'

function fixture () {
    return merge_datasets(
        [
            { uuid: DS1, name: 'Device one' },
            { uuid: DS2, name: 'Device two' },
            { uuid: EQ, name: 'Rig', function: ['4c93ddc1-e610-4efe-91e3-a355f9ba1a09'],
              metadata: { 'dfc3983b-658c-4099-b76a-01ce7c18bde1': { labels: { [DS1]: 'Energy' } },
                          'c95e372e-2fbe-45b9-9937-3235f94e22a3': { tags: ['trial'] } } },
            { uuid: RUN, name: 'Morning', from: FROM, to: TO,
              metadata: { '2b2b4dbc-e0a0-474e-93a8-257bbcbb7f7a': { description: 'First pass' } } },
            { uuid: RUNU, name: 'Morning (devices)' },
            { uuid: RUN1, name: 'Single', from: FROM, to: TO },
            { uuid: PROC, name: 'Process' },
        ],
        [
            { uuid: DS1, structure: STRUCTURE.DEVICE, config: { source: D1 } },
            { uuid: DS2, structure: STRUCTURE.DEVICE, config: { source: D2 } },
            { uuid: EQ, structure: STRUCTURE.UNION, config: [DS1, DS2] },
            { uuid: RUNU, structure: STRUCTURE.UNION, config: [DS1, EQ] },
            { uuid: RUN, structure: STRUCTURE.SESSION, config: { source: RUNU, from: FROM, to: TO } },
            { uuid: RUN1, structure: STRUCTURE.SESSION, config: { source: EQ, from: FROM, to: TO } },
            { uuid: PROC, structure: STRUCTURE.UNION, config: [RUN1] },
        ],
    )
}

describe('items', () => {
    const by = fixture()

    it('turns device datasets into device items and keeps the dataset', () => {
        expect(item_for(DS1, by, 'Energy')).toEqual({ type: 'device', uuid: D1, label: 'Energy', dataset: DS1 })
        expect(item_for(EQ, by)).toEqual({ type: 'dataset', uuid: EQ, label: '' })
    })

    it('reads a session over its own union as the union items', () => {
        expect(source_items(by[RUN], by)).toEqual([DS1, EQ])
        expect(source_items(by[RUN1], by)).toEqual([EQ])
        expect(source_items(by[EQ], by)).toEqual([DS1, DS2])
    })

    it('drops duplicate items', () => {
        expect(dedupe_items([
            { type: 'device', uuid: D1 }, { type: 'device', uuid: D1 }, { type: 'dataset', uuid: D1 },
        ])).toHaveLength(2)
    })
})

describe('state from a record or query', () => {
    const by = fixture()

    it('prefills an edit with window, kind, tags and labels', () => {
        const s = state_from_record(by[EQ], by)
        expect(s.name).toBe('Rig')
        expect(s.kind).toBe('equipment')
        expect(s.tags).toEqual(['trial'])
        expect(s.items.map(i => [i.uuid, i.label])).toEqual([[D1, 'Energy'], [D2, '']])
        expect(s.window_mode).toBe('none')
    })

    it('names a duplicate as a copy and keeps the exact window', () => {
        const s = state_from_record(by[RUN], by, { copy: true })
        expect(s.name).toBe('Morning (copy)')
        expect(s.description).toBe('First pass')
        expect(s.window_mode).toBe('window')
        expect(window_of(s)).toEqual({ from: FROM, to: TO })
    })

    it('reads the timeline selection', () => {
        const s = state_from_query({ devices: `${D1},${DS2},${D1}`, from: String(Date.parse(FROM)), to: String(Date.parse(TO)) }, by)
        expect(s.items).toEqual([
            { type: 'device', uuid: D1, label: '' },
            { type: 'device', uuid: D2, label: '', dataset: DS2 },
        ])
        expect(s.window_mode).toBe('window')
        expect(s.from).toBe(Date.parse(FROM))
    })

    it('presets the kind and drops the window for equipment', () => {
        const s = state_from_query({ kind: 'equipment', from: '1', to: '2' }, by)
        expect(s.kind).toBe('equipment')
        expect(s.window_mode).toBe('none')
        expect(state_from_query({ kind: 'nonsense' }, by).kind).toBe(null)
    })
})

describe('devices and saving', () => {
    const by = fixture()

    it('resolves covered devices through datasets', () => {
        const c = covered_devices([{ type: 'device', uuid: D3 }, { type: 'dataset', uuid: EQ }], by)
        expect(c.devices.sort()).toEqual([D1, D2, D3].sort())
        expect(c.unknown).toEqual([])
    })

    it('finds devices that two items both reach', () => {
        expect(repeated_devices([{ type: 'device', uuid: D1 }, { type: 'dataset', uuid: EQ }], by)).toEqual([D1])
        expect(repeated_devices([{ type: 'device', uuid: D3 }, { type: 'dataset', uuid: EQ }], by)).toEqual([])
    })

    it('reuses existing device datasets and plans the rest', () => {
        const items = [{ type: 'device', uuid: D1 }, { type: 'device', uuid: D3 }]
        expect(device_dataset_plan(items, by)).toEqual([
            { device: D1, existing: DS1 }, { device: D3, existing: null },
        ])
        const map = { [D3]: 'new-ds' }
        expect(item_datasets([...items, { type: 'dataset', uuid: EQ }], map, by)).toEqual([DS1, 'new-ds', EQ])
    })

    it('keys labels by device dataset', () => {
        const items = [{ type: 'device', uuid: D1, label: ' Energy ' }, { type: 'device', uuid: D3, label: 'Fan' }, { type: 'device', uuid: D2, label: '' }]
        expect(labels_by_dataset(items, { [D3]: 'new-ds' }, by)).toEqual({ [DS1]: 'Energy', 'new-ds': 'Fan' })
    })
})

describe('validation', () => {
    const base = () => ({ ...empty_state(), name: 'A', items: [{ type: 'device', uuid: D1 }] })

    it('needs a name and items', () => {
        expect(problems(empty_state())).toEqual(['Give the dataset a name.', 'Add at least one device or dataset.'])
        expect(problems(base())).toEqual([])
    })

    it('checks the start is before the end', () => {
        const s = { ...base(), window_mode: 'window', from: Date.parse(TO), to: Date.parse(FROM) }
        expect(window_problem(s)).toBe('The start must be before the end.')
        expect(problems(s)).toContain('The start must be before the end.')
        expect(window_problem({ ...s, from: null })).toBe('Choose a start and an end.')
    })

    it('allows an end in the future', () => {
        const s = { ...base(), window_mode: 'window', from: Date.now(), to: Date.now() + 86400e3 }
        expect(problems(s)).toEqual([])
    })

    it('needs a window for a run', () => {
        expect(problems({ ...base(), kind: 'run' })).toContain('A run needs a time window.')
    })

    it('holds equipment to devices and groups to runs', () => {
        expect(problems({ ...base(), kind: 'equipment', items: [{ type: 'dataset', uuid: EQ }] }))
            .toContain('Equipment holds devices only. Remove the datasets.')
        expect(problems({ ...base(), kind: 'part' })).toContain('A part groups runs. Remove the devices.')
    })

    it('ignores the window for kinds without one', () => {
        const s = { ...base(), kind: 'equipment', window_mode: 'window', from: 2, to: 1 }
        expect(shows_window(s)).toBe(false)
        expect(window_of(s)).toBe(null)
        expect(problems(s)).toEqual([])
    })

    it('keeps the edit shape', () => {
        const edit = { ok: true, has_window: true, items_uuid: null, items: [EQ] }
        const s = { ...base(), kind: 'equipment', window_mode: 'window', from: Date.parse(FROM), to: Date.parse(TO),
            items: [{ type: 'dataset', uuid: EQ }, { type: 'dataset', uuid: DS1 }] }
        expect(shows_window(s, edit)).toBe(true)
        expect(problems(s, edit)).toContain('This dataset is limited to one source. Duplicate it to combine several.')
    })
})

describe('what the service will store', () => {
    const by = fixture()

    it('lists device datasets, the union, the window and the kind', () => {
        const s = { ...empty_state(), name: 'A', kind: 'run', window_mode: 'window', from: Date.parse(FROM), to: Date.parse(TO),
            items: [{ type: 'device', uuid: D1 }, { type: 'device', uuid: D3 }] }
        // The shape plan() in api.js returns for two items and a window.
        const steps = [
            { structure: STRUCTURE.UNION, combines: 2, plumbing: true },
            { structure: STRUCTURE.SESSION, ...window_of(s) },
        ]
        const rows = store_rows(s, by, { steps })
        expect(rows.map(r => r.text)).toEqual([
            '1 device dataset reused', '1 device dataset created', 'Combines 2 items', 'Limited to a window', 'Kind: Run',
        ])
        expect(rows[3].note).toBe(`${FROM} to ${TO}`)
    })
})

describe('pickers', () => {
    const by = fixture()

    it('finds every dataset that includes one, at any depth', () => {
        expect([...ancestors(DS1, by)].sort()).toEqual([EQ, RUNU, RUN, RUN1, PROC].sort())
        expect([...ancestors(PROC, by)]).toEqual([])
    })

    it('excludes the edited datasets and anything that includes them', () => {
        const ex = picker_exclusions([RUN1, null], by)
        expect([...ex].sort()).toEqual([RUN1, PROC].sort())
    })

    it('maps devices to the equipment that holds them', () => {
        expect(equipment_by_device([by[EQ]], by, () => 'Rig')).toEqual({ [D1]: ['Rig'], [D2]: ['Rig'] })
    })

    it('matches every word', () => {
        expect(text_match('pump two', ['Pump', 'Area two'])).toBe(true)
        expect(text_match('pump three', ['Pump', 'Area two'])).toBe(false)
        expect(text_match('', [])).toBe(true)
    })

    it('groups devices by site and area, missing last', () => {
        const g = group_devices([
            { name: 'b', site: 'S1', area: 'A2' },
            { name: 'a', site: 'S1', area: 'A2' },
            { name: 'c', site: null, area: null },
            { name: 'd', site: 'S1', area: null },
        ])
        expect(g.map(s => s.site)).toEqual(['S1', 'No site'])
        expect(g[0].areas.map(a => a.area)).toEqual(['A2', 'No area'])
        expect(g[0].areas[0].devices.map(d => d.name)).toEqual(['a', 'b'])
    })
})
