/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Datasets timeline layout: lanes, windowing, blocks and selection.
 *
 * The timeline can hold hundreds of device lanes, so it renders only
 * what is near the view. These tests pin down the maths that decides
 * what that is, and what a drag turns into.
 */

import { describe, it, expect } from 'vitest'
import { DA, STRUCTURE } from '../src/lib/datasets/constants.js'
import { merge_datasets, resolve_devices, track_range, london_local_to_ms } from '../src/lib/datasets/model.js'
import {
    LABEL_W, LABEL_W_MIN, LABEL_W_MAX, TRACK_MIN, HEADER_H, ROW_H,
    label_w_limits, clamp_label_w,
    x_of, t_of, scroll_left_for, view_centre, in_track, visible_x, visible_ticks,
    quick_dates, date_input_to_ms,
    equipment_devices, build_rows, place_label, place_key, row_at, visible_rows,
    equipment_blocks, place_blocks, title_inset,
    resolve_selection, selection_summary, make_dataset_query,
} from '../src/lib/datasets/timeline.js'

const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const D2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const D3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const DS1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const DS2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const EQ = 'cccccccc-0000-4000-8000-000000000001'
const RUN = 'dddddddd-0000-4000-8000-000000000001'
const RUN2 = 'dddddddd-0000-4000-8000-000000000002'
const ONG = 'eeeeeeee-0000-4000-8000-000000000001'

const NOW = Date.parse('2026-10-07T10:00:00.000Z')

function fixture () {
    const metadata = [
        { uuid: DS1, name: 'Meter 1', function: [] },
        { uuid: DS2, name: 'Spindle', function: [] },
        { uuid: EQ, name: 'Lathe', function: [DA.Class.Equipment],
          metadata: { [DA.App.EquipmentLabels]: { labels: { [DS1]: 'Energy' } } } },
        { uuid: RUN, name: 'Lathe run, 7 Oct 08:00', from: '2026-10-07T07:00:00.000Z', to: '2026-10-07T08:00:00.000Z',
          function: [DA.Class.Run],
          metadata: { [DA.App.RunMetadata]: { equipment: EQ, operator: 'Sam', createdBy: 'sam' },
                      [DA.App.Tags]: { tags: ['batch-4'] } } },
        { uuid: RUN2, name: 'Lathe idle window', from: '2026-10-07T08:30:00.000Z', to: '2026-10-07T09:00:00.000Z',
          function: [DA.Class.Run],
          metadata: { [DA.App.RunMetadata]: { equipment: EQ, reference: 'idle', void: true } } },
        { uuid: ONG, name: 'Both meters', function: [],
          metadata: { [DA.App.RunMetadata]: { createdBy: 'kim' } } },
    ]
    const structures = [
        { uuid: DS1, structure: STRUCTURE.DEVICE, config: { source: D1 } },
        { uuid: DS2, structure: STRUCTURE.DEVICE, config: { source: D2 } },
        { uuid: EQ, structure: STRUCTURE.UNION, config: [DS1, DS2] },
        { uuid: ONG, structure: STRUCTURE.UNION, config: [DS1, DS2] },
    ]
    const byUuid = merge_datasets(metadata, structures)
    const devices = [
        { uuid: D1, name: 'Meter 1', path: ['Works', 'Site A', 'Hall 1'], metrics: [{}, {}], status: { online: true } },
        { uuid: D2, name: 'Spindle', path: ['Works', 'Site A', 'Hall 1'], metrics: [{}], status: null },
        { uuid: D3, name: 'Chiller', path: ['Works', 'Site A', 'Yard'], metrics: [{}, {}, {}], status: { online: false, last_change: NOW } },
    ]
    return { byUuid, devices }
}

function layout (opts = {}) {
    const { byUuid, devices } = fixture()
    const equipment = [byUuid[EQ]]
    const eq_devices = equipment_devices(equipment, u => resolve_devices(u, byUuid), byUuid)
    const ongoing = [{ record: byUuid[ONG], devices: 2 }]
    return { byUuid, devices, ...build_rows({ ongoing, equipment, eq_devices, devices, ...opts }) }
}

describe('geometry', () => {
    const range = track_range('hours', NOW)

    it('maps time to x and back', () => {
        const x = x_of(NOW, range)
        expect(t_of(x, range)).toBeCloseTo(NOW, -1)
        expect(x_of(NOW + 3600e3, range) - x).toBeCloseTo(120)
    })

    it('clamps x outside the track', () => {
        expect(t_of(-50, range)).toBe(range.start)
        expect(t_of(range.width + 50, range)).toBe(range.end)
    })

    it('scrolls a time to the middle of the visible track', () => {
        const left = scroll_left_for(NOW, range, 1260)
        expect(view_centre(range, left, 1260)).toBeCloseTo(NOW, -1)
        expect(scroll_left_for(range.start, range, 1260)).toBe(0)
    })

    it('knows when a time is well inside the track', () => {
        expect(in_track(NOW, range)).toBe(true)
        expect(in_track(range.start + 1, range)).toBe(false)
        expect(in_track(range.end + 1, range)).toBe(false)
    })

    it('keeps ticks near the view only', () => {
        const ticks = [{ x: 0 }, { x: 500 }, { x: 5000 }]
        const { x0, x1 } = visible_x(0, LABEL_W + 600)
        expect(visible_ticks(ticks, x0, x1)).toEqual([{ x: 0 }, { x: 500 }])
    })
})

describe('label column width', () => {
    const range = track_range('hours', NOW)

    it('uses 260 px when no width is given', () => {
        expect(LABEL_W).toBe(260)
        expect(scroll_left_for(NOW, range, 1260)).toBe(scroll_left_for(NOW, range, 1260, 0.5, LABEL_W))
        expect(view_centre(range, 5000, 1260)).toBe(view_centre(range, 5000, 1260, LABEL_W))
        expect(visible_x(5000, 1260)).toEqual(visible_x(5000, 1260, null, LABEL_W))
    })

    it('centres a time in the track a wider column leaves', () => {
        // 1260 px frame, 460 px of labels: 800 px of track in view.
        const left = scroll_left_for(NOW, range, 1260, 0.5, 460)
        expect(left).toBeCloseTo(x_of(NOW, range) - 400)
        expect(view_centre(range, left, 1260, 460)).toBeCloseTo(NOW, -1)
        // The same scroll position with the default column is centred later.
        expect(view_centre(range, left, 1260)).toBeGreaterThan(NOW)
        expect(scroll_left_for(NOW, range, 1260, 0, 460)).toBeCloseTo(x_of(NOW, range))
    })

    it('renders the band of track a wider column leaves in view', () => {
        expect(visible_x(5000, 1260, 0, 460)).toEqual({ x0: 5000, x1: 5800 })
        expect(visible_x(5000, 1260, 0)).toEqual({ x0: 5000, x1: 6000 })
        // The default buffer is the view's own width, and at least 400 px.
        expect(visible_x(5000, 1260, null, 460)).toEqual({ x0: 4200, x1: 6600 })
        expect(visible_x(5000, 760, null, 460)).toEqual({ x0: 4600, x1: 5700 })
        // A column wider than the frame leaves no track, not a negative one.
        expect(visible_x(5000, 300, 0, 460)).toEqual({ x0: 5000, x1: 5000 })
    })

    it('keeps the width between its limits', () => {
        expect(clamp_label_w(320)).toBe(320)
        expect(clamp_label_w(320.6)).toBe(321)
        expect(clamp_label_w(50)).toBe(LABEL_W_MIN)
        expect(clamp_label_w(5000)).toBe(LABEL_W_MAX)
    })

    it('falls back to the default for a width that is not a number', () => {
        for (const bad of [undefined, null, NaN, Infinity, '400', {}])
            expect(clamp_label_w(bad)).toBe(LABEL_W)
    })

    it('always leaves some track in a narrow frame', () => {
        expect(label_w_limits(1400)).toEqual({ min: LABEL_W_MIN, max: LABEL_W_MAX })
        expect(label_w_limits(700)).toEqual({ min: LABEL_W_MIN, max: 700 - TRACK_MIN })
        expect(clamp_label_w(600, 700)).toBe(460)
        // Too narrow for both: the column stays at its smallest.
        expect(label_w_limits(300)).toEqual({ min: LABEL_W_MIN, max: LABEL_W_MIN })
        expect(clamp_label_w(600, 300)).toBe(LABEL_W_MIN)
    })
})

describe('navigation', () => {
    it('gives London noon for yesterday and the start of the year', () => {
        const q = quick_dates(NOW)
        expect(q.today).toBe(NOW)
        expect(q.yesterday).toBe(london_local_to_ms('2026-10-06T12:00'))
        expect(q.year_start).toBe(london_local_to_ms('2026-01-01T12:00'))
        expect(q.week_ago).toBe(NOW - 7 * 86400e3)
    })

    it('finds yesterday across the clock change', () => {
        // 00:30 on the Monday after the October change (25-hour Sunday).
        const t = london_local_to_ms('2026-10-26T00:30')
        expect(quick_dates(t).yesterday).toBe(london_local_to_ms('2026-10-25T12:00'))
    })

    it('reads a date input', () => {
        expect(date_input_to_ms('2026-07-01')).toBe(Date.parse('2026-07-01T11:00:00.000Z'))
        expect(date_input_to_ms('')).toBeNaN()
    })
})

describe('lanes', () => {
    it('resolves equipment devices with their labels', () => {
        const { byUuid } = fixture()
        const out = equipment_devices([byUuid[EQ]], u => resolve_devices(u, byUuid), byUuid)
        expect(out[EQ]).toEqual([
            { device: D1, dataset: DS1, label: 'Energy' },
            { device: D2, dataset: DS2, label: null },
        ])
    })

    it('stacks the groups with collapsed equipment and other devices', () => {
        const { rows, height } = layout()
        expect(rows.map(r => r.kind)).toEqual(['ongoing-header', 'band', 'equipment', 'other-header'])
        expect(rows[1].label).toBe('Ongoing · 2 devices · made by kim')
        expect(rows[2].tag).toBe('2 devices')
        expect(rows[3].tag).toBe('1 not in any equipment')
        expect(height).toBe(ROW_H['ongoing-header'] + ROW_H.band + ROW_H.equipment + ROW_H['other-header'])
        expect(rows[2].top).toBe(68)
    })

    it('shows device rows when equipment is expanded, with label or metric count', () => {
        const { rows } = layout({ expanded: { [EQ]: true, other: true, ongoing: false } })
        expect(rows.map(r => r.kind)).toEqual(['ongoing-header', 'equipment', 'device', 'device', 'other-header', 'place', 'device'])
        expect(rows[2].tag).toBe('Energy')
        expect(rows[3].tag).toBe('1 metric')
        expect(rows[5].name).toBe('Works / Site A / Yard')
        expect(rows[6].status).toEqual({ online: false, last_change: NOW })
    })

    it('searches devices and opens the groups that match', () => {
        const { rows, matched } = layout({ query: 'spindle' })
        expect(rows.map(r => r.kind)).toEqual(['equipment', 'device'])
        expect(rows[1].name).toBe('Spindle')
        expect(matched).toBe(2)
        expect(layout({ query: 'nothing here' }).matched).toBe(0)
    })

    it('leaves out empty groups', () => {
        const { rows } = build_rows({ devices: [] })
        expect(rows).toEqual([])
    })

    it('labels places by ISA-95 path', () => {
        expect(place_label({ path: ['Works', 'Site A', 'Yard'] })).toBe('Works / Site A / Yard')
        expect(place_label({ path: [] })).toBe('Not in the ISA-95 hierarchy')
        expect(place_label({})).toBe('Not in the ISA-95 hierarchy')
    })

    it('groups other devices by path, unplaced last, and counts metrics only when known', () => {
        const devices = [
            { uuid: 'x', name: 'Unplaced', path: [], metrics: [{}] },
            { uuid: 'y', name: 'Pump', path: ['Works', 'Site B'], metrics: null },
            { uuid: 'z', name: 'Fan', path: ['Works', 'Site A'], metrics: [] },
        ]
        const { rows } = build_rows({ devices, expanded: { other: true } })
        // No dataset lookup given: no row links anywhere.
        expect(rows.filter(r => r.kind === 'device').every(r => r.dataset === null)).toBe(true)
        expect(rows.map(r => r.name)).toEqual([
            'Other devices', 'Works / Site A', 'Fan', 'Works / Site B', 'Pump', 'Not in the ISA-95 hierarchy', 'Unplaced',
        ])
        expect(rows[2].tag).toBe('0 metrics')
        expect(rows[4].tag).toBeNull()
        // A device with a dataset of its own links to it.
        const linked = build_rows({ devices, expanded: { other: true }, dataset_of: u => (u === 'y' ? 'ds-y' : null) }).rows
        expect(linked.filter(r => r.kind === 'device').map(r => [r.name, r.dataset]))
            .toEqual([['Fan', null], ['Pump', 'ds-y'], ['Unplaced', null]])
        expect(build_rows({ devices, query: 'site b' }).rows.map(r => r.name)).toEqual(['Other devices', 'Works / Site B', 'Pump'])
    })

    describe('places under Other devices', () => {
        const A = 'Works / Site A', B = 'Works / Site B'
        const devices = [
            { uuid: 'a1', name: 'Fan', path: ['Works', 'Site A'], metrics: [] },
            { uuid: 'a2', name: 'Heater', path: ['Works', 'Site A'], metrics: [] },
            { uuid: 'b1', name: 'Pump', path: ['Works', 'Site B'], metrics: [] },
            { uuid: 'n1', name: 'Unplaced', path: [], metrics: [] },
        ]
        const names = rows => rows.map(r => r.name)
        const stacked = rows => rows.every((r, i) => r.index === i && r.h === ROW_H[r.kind]
            && r.top === (i ? rows[i - 1].top + rows[i - 1].h : 0))

        it('opens every place by default, with a device count on each', () => {
            const { rows, height } = build_rows({ devices, expanded: { other: true } })
            expect(names(rows)).toEqual([
                'Other devices', A, 'Fan', 'Heater', B, 'Pump', 'Not in the ISA-95 hierarchy', 'Unplaced',
            ])
            const places = rows.filter(r => r.kind === 'place')
            expect(places.map(r => [r.key, r.tag, r.open])).toEqual([
                [place_key(A), '2 devices', true],
                [place_key(B), '1 device', true],
                [place_key('Not in the ISA-95 hierarchy'), '1 device', true],
            ])
            expect(stacked(rows)).toBe(true)
            expect(height).toBe(ROW_H['other-header'] + 3 * ROW_H.place + 4 * ROW_H.device)
        })

        it('hides the devices of a closed place and moves the rows below up', () => {
            const open = build_rows({ devices, expanded: { other: true } })
            const { rows, height } = build_rows({ devices, expanded: { other: true, [place_key(A)]: false } })
            expect(names(rows)).toEqual([
                'Other devices', A, B, 'Pump', 'Not in the ISA-95 hierarchy', 'Unplaced',
            ])
            // The closed heading stays, still counting what it holds.
            expect(rows[1]).toMatchObject({ kind: 'place', open: false, tag: '2 devices', top: ROW_H['other-header'] })
            expect(rows[2]).toMatchObject({ name: B, open: true, top: ROW_H['other-header'] + ROW_H.place })
            expect(stacked(rows)).toBe(true)
            expect(height).toBe(open.height - 2 * ROW_H.device)
            // The "not in any equipment" count is of devices, open or not.
            expect(rows[0].tag).toBe('4 not in any equipment')
        })

        it('closes each place on its own', () => {
            const all = { other: true, [place_key(A)]: false, [place_key(B)]: false, [place_key('Not in the ISA-95 hierarchy')]: false }
            const { rows, height } = build_rows({ devices, expanded: all })
            expect(rows.map(r => r.kind)).toEqual(['other-header', 'place', 'place', 'place'])
            expect(height).toBe(ROW_H['other-header'] + 3 * ROW_H.place)
            const one = build_rows({ devices, expanded: { ...all, [place_key(B)]: true } }).rows
            expect(names(one)).toEqual(['Other devices', A, B, 'Pump', 'Not in the ISA-95 hierarchy'])
        })

        it('shows no places while Other devices is closed', () => {
            const { rows } = build_rows({ devices, expanded: { [place_key(A)]: true } })
            expect(rows.map(r => r.kind)).toEqual(['other-header'])
        })

        it('opens a closed place for a search that matches inside it', () => {
            const { rows, matched } = build_rows({ devices, expanded: { [place_key(A)]: false }, query: 'heater' })
            expect(names(rows)).toEqual(['Other devices', A, 'Heater'])
            // The count is of the devices that match, as the header's is.
            expect(rows[1]).toMatchObject({ open: true, tag: '1 device' })
            expect(matched).toBe(1)
        })

        it('windows and hit-tests the rows left after a place is closed', () => {
            const many = Array.from({ length: 300 }, (_, i) => ({
                uuid: `d${i}`, name: `Dev ${String(i).padStart(3, '0')}`, path: ['Works', i < 200 ? 'Site A' : 'Site B'],
            }))
            const { rows, height } = build_rows({ devices: many, expanded: { other: true, [place_key(A)]: false } })
            // Header, closed Site A, Site B, then its 100 devices.
            expect(rows.length).toBe(103)
            expect(height).toBe(ROW_H['other-header'] + 2 * ROW_H.place + 100 * ROW_H.device)
            const first = rows[3]
            expect(first).toMatchObject({ kind: 'device', name: 'Dev 200', top: 92 })
            expect(row_at(rows, 92)).toBe(3)
            expect(row_at(rows, 91)).toBe(2)
            const vis = visible_rows(rows, HEADER_H, 200, 0)
            expect(vis[0].key).toBe('other')
            // The window runs from the frame's top, header included.
            expect(vis.at(-1).top).toBeLessThan(HEADER_H + 200)
            expect(vis.length).toBe(row_at(rows, HEADER_H + 199) + 1)
            expect(visible_rows(rows, height + HEADER_H, 200, 0)).toEqual([])
        })

        it('leaves a closed place out of a selection', () => {
            const { rows } = build_rows({ devices, expanded: { other: true, [place_key(A)]: false } })
            const sel = resolve_selection({ k0: rows[1].key, k1: rows.at(-1).key, t0: 0, t1: 3600e3 }, rows)
            expect(sel.devices).toEqual(['b1', 'n1'])
        })
    })

    it('finds the row at a y position', () => {
        const { rows } = layout({ expanded: { [EQ]: true } })
        expect(row_at(rows, 0)).toBe(0)
        expect(row_at(rows, 31)).toBe(0)
        expect(row_at(rows, 32)).toBe(1)
        expect(row_at(rows, 100000)).toBe(-1)
    })

    it('windows 450 lanes to the ones near the view', () => {
        const rows = Array.from({ length: 450 }, (_, i) => ({ key: i, top: i * 36, h: 36 }))
        const vis = visible_rows(rows, 3600 + HEADER_H, 600, 0)
        expect(vis[0].key).toBe(100)
        expect(vis.at(-1).key).toBeLessThan(120)
        expect(visible_rows(rows, 0, 600).length).toBeLessThan(40)
    })
})

describe('blocks', () => {
    it('styles runs and a recording in progress', () => {
        const { byUuid } = fixture()
        const runs = [byUuid[RUN], byUuid[RUN2]]
        const rec = { startedAt: '2026-10-07T09:30:00.000Z', operator: 'Ali', tags: ['setup'] }
        const out = equipment_blocks(byUuid[EQ], runs, rec, NOW)
        expect(out.map(b => b.style)).toEqual(['done', 'voided', 'recording'])
        expect(out[0].title).toBe('Run, 7 Oct 08:00')
        expect(out[0].sub).toBe('Sam · batch-4')
        expect(out[1].title).toBe('Voided')
        expect(out[2].to).toBe(NOW)
        expect(out[2].sub).toBe('Ali · setup')
    })

    it('names a reference window by its type', () => {
        const { byUuid } = fixture()
        const ref = { ...byUuid[RUN2], voided: false }
        expect(equipment_blocks(byUuid[EQ], [ref], null, NOW)[0]).toMatchObject({ style: 'reference', title: 'Idle reference' })
    })

    it('places blocks and drops ones outside the view', () => {
        const range = track_range('hours', NOW)
        const blocks = [
            { from: NOW - 3600e3, to: NOW, key: 'a' },
            { from: range.start - 10 * 86400e3, to: range.start - 9 * 86400e3, key: 'b' },
        ]
        const x = x_of(NOW, range)
        const out = place_blocks(blocks, range, x - 1000, x + 1000)
        expect(out.map(b => b.key)).toEqual(['a'])
        expect(out[0].w).toBeCloseTo(120)
        expect(out[0].show_title).toBe(true)
    })

    it('keeps a long block title in view', () => {
        expect(title_inset(0, 2000, 500)).toBe(508)
        expect(title_inset(0, 200, 500)).toBe(80)
        expect(title_inset(600, 200, 500)).toBe(6)
    })
})

describe('selection', () => {
    it('collects devices between the rows and snaps the window', () => {
        const { rows, devices } = layout({ expanded: { [EQ]: true, other: true } })
        const first = rows.find(r => r.kind === 'device')
        const last = rows.at(-1)
        const t0 = Date.parse('2026-10-07T08:02:00.000Z')
        const t1 = Date.parse('2026-10-07T06:58:00.000Z')
        const sel = resolve_selection({ k0: last.key, k1: first.key, t0, t1 }, rows)
        expect(sel.from).toBe(Date.parse('2026-10-07T07:00:00.000Z'))
        expect(sel.to).toBe(Date.parse('2026-10-07T08:00:00.000Z'))
        expect(sel.devices).toEqual([D1, D2, D3])
        expect(sel.top).toBe(first.top)
        expect(sel.height).toBe(last.top + last.h - first.top)

        const by = Object.fromEntries(devices.map(d => [d.uuid, d]))
        expect(selection_summary(sel.devices, by)).toMatchObject({ count: 3, metrics: 6, more: 0 })
        expect(make_dataset_query(sel)).toEqual({ devices: `${D1},${D2},${D3}`, from: String(sel.from), to: String(sel.to) })
    })

    it('drops a selection whose rows have gone', () => {
        const { rows } = layout()
        expect(resolve_selection({ k0: 'gone', k1: 'gone', t0: 0, t1: 1 }, rows)).toBeNull()
    })

    it('leaves the metric count out when a device has no readable metric list', () => {
        const s = selection_summary(['a', 'b'], { a: { uuid: 'a', name: 'A', metrics: [{}] }, b: { uuid: 'b', name: 'B', metrics: null } })
        expect(s.metrics).toBeNull()
        expect(s.count).toBe(2)
    })

    it('lists four devices and counts the rest', () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f']
        const s = selection_summary(ids, {})
        expect(s.shown.length).toBe(4)
        expect(s.more).toBe(2)
    })
})
