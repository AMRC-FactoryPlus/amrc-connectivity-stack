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
    LABEL_W, HEADER_H, ROW_H,
    x_of, t_of, scroll_left_for, view_centre, in_track, visible_x, visible_ticks,
    quick_dates, date_input_to_ms,
    equipment_devices, build_rows, place_label, row_at, visible_rows,
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
        { uuid: D1, name: 'Meter 1', site: 'Site A', area: 'Hall 1', metrics: [{}, {}], status: { online: true } },
        { uuid: D2, name: 'Spindle', site: 'Site A', area: 'Hall 1', metrics: [{}], status: null },
        { uuid: D3, name: 'Chiller', site: 'Site A', area: 'Yard', metrics: [{}, {}, {}], status: { online: false, last_change: NOW } },
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
        expect(rows[5].name).toBe('Site A · Yard')
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

    it('labels places', () => {
        expect(place_label({ site: 'S', area: 'A' })).toBe('S · A')
        expect(place_label({ site: null, area: 'A' })).toBe('A')
        expect(place_label({})).toBe('No site or area')
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

    it('lists four devices and counts the rest', () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f']
        const s = selection_summary(ids, {})
        expect(s.shown.length).toBe(4)
        expect(s.more).toBe(2)
    })
})
