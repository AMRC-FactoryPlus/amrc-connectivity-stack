/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Live charts and labels: the raw live tail after the buckets, the
 * bucket size from the chart's width, recording framing, labels that
 * tell metrics apart, picker order, and deleting a dataset with its
 * own device list.
 */

import { describe, it, expect } from 'vitest'
import {
    LIVE_TAIL, append_live_items, replace_tail, chart_pairs, sparkline_path, latest_point,
    points_for_width, every_for_width, dataset_window, metric_labels, series_key,
} from '../src/lib/datasets/series.js'
import { picker_order } from '../src/components/Datasets/page/page-logic.js'
import { STRUCTURE } from '../src/lib/datasets/constants.js'
import { own_helper, edit_shape, delete_plan, helper_owner, delete_in_order, owner_of_helper, dataset_exists } from '../src/lib/datasets/api.js'

const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const T0 = Date.parse('2026-10-08T08:00:00.000Z')

describe('live tail', () => {
    const key = series_key(D1, 'A/Load')
    const lookup = id => id === 'e1' ? { device: D1, path: 'A/Load', unit: '%' } : null
    const item = (t, value) => ({ elementId: 'e1', value, quality: 'Good', timestamp: new Date(t).toISOString() })
    const base = () => ({
        from: T0 - HOUR, to: T0 + HOUR, every: '1m', asOf: T0 + 30 * SEC,
        devices: { [D1]: { count: [], windows: [], last: undefined } },
        metrics: { [key]: { device: D1, metric: 'A/Load', type: 'd', unit: '%', points: [[T0 - MIN, 5, 60], [T0, 6, 30]] } },
    })

    it('appends each value at full resolution, in order', () => {
        const items = [1, 2, 3].map(i => item(T0 + 30 * SEC + i * SEC, i))
        const s = append_live_items(base(), items, lookup)
        expect(s.metrics[key].tail).toEqual([[T0 + 31 * SEC, 1], [T0 + 32 * SEC, 2], [T0 + 33 * SEC, 3]])
        // The buckets do not change.
        expect(s.metrics[key].points).toEqual(base().metrics[key].points)
        expect(latest_point(s.metrics[key])).toEqual([T0 + 33 * SEC, 3])
    })

    it('never keeps a value twice, or one the buckets hold', () => {
        let s = append_live_items(base(), [item(T0 + 31 * SEC, 1)], lookup)
        // Replayed, older, and at asOf.
        const same = append_live_items(s, [item(T0 + 31 * SEC, 1), item(T0 + 30.5 * SEC, 9), item(T0 + 30 * SEC, 9)], lookup)
        expect(same).toBe(s)
        s = append_live_items(s, [item(T0 + 32 * SEC, 2), item(T0 + 32 * SEC, 2)], lookup)
        expect(s.metrics[key].tail).toHaveLength(2)
    })

    it('keeps at most the newest 10 minutes', () => {
        const items = []
        for (let i = 1; i <= 15 * 60; i++) items.push(item(T0 + 30 * SEC + i * SEC, i))
        const tail = append_live_items(base(), items, lookup).metrics[key].tail
        expect(tail.length).toBeLessThanOrEqual(LIVE_TAIL.points)
        expect(tail.at(-1)[0] - tail[0][0]).toBeLessThanOrEqual(LIVE_TAIL.span)
        expect(tail.at(-1)[1]).toBe(15 * 60)
    })

    it('drops the raw values a refetch now counts, and keeps the rest', () => {
        const items = [1, 2, 3, 4].map(i => item(T0 + 50 * SEC + i * 5 * SEC, i))
        const s = append_live_items(base(), items, lookup)
        // The bucket at T0 + 1 min has closed; the refetch answered at T0 + 62 s.
        const answer = {
            from: T0, to: T0 + HOUR, every: '1m', asOf: T0 + 62 * SEC,
            devices: { [D1]: { count: [], windows: [], last: T0 + 61 * SEC } },
            metrics: { [key]: { device: D1, metric: 'A/Load', unit: '%', points: [[T0, 7, 60], [T0 + MIN, 3, 2]] } },
        }
        const out = replace_tail(s, answer)
        expect(out.metrics[key].points).toEqual([[T0 - MIN, 5, 60], [T0, 7, 60], [T0 + MIN, 3, 2]])
        expect(out.metrics[key].tail).toEqual([[T0 + 65 * SEC, 3], [T0 + 70 * SEC, 4]])
        // A value the refetch counted does not come back.
        expect(append_live_items(out, [item(T0 + 60 * SEC, 2)], lookup)).toBe(out)
    })

    it('draws the tail after the buckets, breaking at a long silence', () => {
        const pts = [[T0, 1, 1], [T0 + MIN, 2, 1]]
        const tail = [[T0 + 70 * SEC, 3], [T0 + 71 * SEC, 4], [T0 + 5 * MIN, 5]]
        expect(chart_pairs(pts, '1m', tail)).toEqual([
            [T0, 1], [T0 + MIN, 2], [T0 + 70 * SEC, 3], [T0 + 71 * SEC, 4], [T0 + 71 * SEC, null], [T0 + 5 * MIN, 5],
        ])
    })

    it('draws the tail on a sparkline, never left of the last bucket', () => {
        const d = sparkline_path([[T0, 0, 1]], { from: T0, to: T0 + 2 * MIN, w: 120, h: 20, every: '1m', tail: [[T0 + 10 * SEC, 10], [T0 + 50 * SEC, 5]] })
        // Bucket at its middle (30 s = x 30), then the raw values.
        expect(d).toBe('M30 18L30 2L50 10')
    })
})

describe('bucket size from the chart width', () => {
    it('asks for about one point per pixel, within limits', () => {
        expect(points_for_width(800)).toBe(800)
        expect(points_for_width(50)).toBe(200)
        expect(points_for_width(4000)).toBe(1500)
        expect(points_for_width(0)).toBe(200)
    })

    it('picks the finest step that fits', () => {
        expect(every_for_width(T0, T0 + 24 * HOUR, 1500)).toBe('1m')
        expect(every_for_width(T0, T0 + 24 * HOUR, 800)).toBe('5m')
        expect(every_for_width(T0, T0 + HOUR, 800)).toBe('10s')
        expect(every_for_width(T0, T0 + HOUR, 200)).toBe('30s')
        expect(every_for_width(T0, T0 + 10 * MIN, 200)).toBe('10s')
    })
})

describe('recording framing', () => {
    it('frames the current recording from its start to now', () => {
        const now = T0 + HOUR
        const w = dataset_window({ recording: { startedAt: new Date(T0 + 7 * MIN).toISOString() } }, now)
        expect(w).toEqual({ from: T0 + 7 * MIN, to: now, open: true, windowless: false, recording: T0 + 7 * MIN })
    })

    it('shows the last 24 hours when not recording', () => {
        expect(dataset_window({ recording: null }, T0).windowless).toBe(true)
    })
})

describe('metric labels', () => {
    it('tells metrics with the same name apart', () => {
        const l = metric_labels(['Axes/X/Base_Axis/Load', 'Axes/Y/Base_Axis/Load', 'Spindles/S1/Load', 'Spindles/S1/Speed'])
        expect(l.get('Axes/X/Base_Axis/Load')).toBe('X axis load')
        expect(l.get('Axes/Y/Base_Axis/Load')).toBe('Y axis load')
        expect(l.get('Spindles/S1/Load')).toBe('Spindle S1 load')
        expect(l.get('Spindles/S1/Speed')).toBe('Speed')
    })

    it('keeps a segment that is needed to tell them apart', () => {
        const l = metric_labels(['A/Base/Load', 'A/Other/Load'])
        expect(l.get('A/Base/Load')).toBe('Base load')
        expect(l.get('A/Other/Load')).toBe('Other load')
    })

    it('gives every metric a different label', () => {
        const paths = ['P/Phase_A/Current', 'P/Phase_B/Current', 'Q/Phase_A/Current', 'Current']
        const l = metric_labels(paths)
        expect(new Set(paths.map(p => l.get(p).toLowerCase())).size).toBe(paths.length)
    })
})

describe('picker order', () => {
    it('lists numbers, then text, then device details and controls', () => {
        const m = [
            { path: 'Device_Information/Model', type: 'String' },
            { path: 'Player_Controls/Speed', type: 'Double' },
            { path: 'Status', type: 'String' },
            { path: 'Load', type: 'Double' },
            { path: 'Speed', type: 'Int32' },
        ]
        expect(picker_order(m).map(x => x.path)).toEqual(['Load', 'Speed', 'Status', 'Player_Controls/Speed', 'Device_Information/Model'])
    })
})

describe('deleting a dataset with its own device list', () => {
    const SESSION = 'cccccccc-0000-4000-8000-000000000001'
    const HELPER = 'cccccccc-0000-4000-8000-000000000002'
    const OTHER = 'cccccccc-0000-4000-8000-000000000003'
    const byUuid = () => ({
        [SESSION]: { uuid: SESSION, name: 'Trial', structure: STRUCTURE.SESSION, editable: true, config: { source: HELPER } },
        [HELPER]: { uuid: HELPER, name: 'Trial (devices)', structure: STRUCTURE.UNION, editable: true, config: [D1] },
    })

    it('deletes the session, then its device list', () => {
        const b = byUuid()
        expect(own_helper(b[SESSION], b)).toBe(b[HELPER])
        expect(edit_shape(b[SESSION], b).items_uuid).toBe(HELPER)
        expect(delete_plan(b[SESSION], b)).toEqual({ order: [SESSION, HELPER], helper: b[HELPER] })
    })

    it('leaves a device list that something else uses', () => {
        const b = byUuid()
        b[OTHER] = { uuid: OTHER, name: 'Other', structure: STRUCTURE.UNION, config: [HELPER] }
        expect(delete_plan(b[SESSION], b)).toEqual({ order: [SESSION], helper: null })
        expect(helper_owner(b[HELPER], [SESSION, OTHER], b)).toBe(null)
    })

    it('leaves a union whose name does not match', () => {
        const b = byUuid()
        b[HELPER].name = 'Shared devices'
        expect(delete_plan(b[SESSION], b).helper).toBe(null)
    })

    it('offers to delete the session from the device list', () => {
        const b = byUuid()
        expect(helper_owner(b[HELPER], [SESSION], b)).toBe(b[SESSION])
        expect(helper_owner(b[SESSION], [HELPER], b)).toBe(null)
    })

    const fake = answers => {
        const calls = []
        return {
            calls,
            DataAccess: {
                fetch: async path => {
                    calls.push(path)
                    return answers.shift() ?? [204, null]
                },
            },
        }
    }

    it('waits while the service still sees the dataset it just deleted', async () => {
        const client = fake([[204, null], [409, { referrers: [{ dataset: SESSION }] }], [409, { referrers: [{ dataset: SESSION }] }], [200, null]])
        const waits = []
        const res = await delete_in_order(client, [SESSION, HELPER], { wait: async ms => { waits.push(ms) } })
        expect(res).toEqual({ ok: true, deleted: [SESSION, HELPER], failed: null, gone: [] })
        expect(waits).toEqual([500, 1000])
        expect(client.calls).toHaveLength(4)
    })

    it('reports a refusal that names another dataset', async () => {
        const client = fake([[204, null], [409, { referrers: [{ dataset: SESSION }, { dataset: OTHER }] }]])
        const res = await delete_in_order(client, [SESSION, HELPER], { wait: async () => {} })
        expect(res.ok).toBe(false)
        expect(res.deleted).toEqual([SESSION])
        expect(res.failed).toBe(HELPER)
        expect(res.referrers).toEqual([SESSION, OTHER])
    })

    it('stops waiting after the last retry', async () => {
        const answers = [[204, null], ...Array(10).fill([409, { referrers: [{ dataset: SESSION }] }])]
        const res = await delete_in_order(fake(answers), [SESSION, HELPER], { wait: async () => {} })
        expect(res.ok).toBe(false)
        expect(res.failed).toBe(HELPER)
    })
})

describe('deleting safely', () => {
    const SESSION = 'cccccccc-0000-4000-8000-000000000001'
    const HELPER = 'cccccccc-0000-4000-8000-000000000002'
    const byUuid = () => ({
        [SESSION]: { uuid: SESSION, name: 'Trial', structure: STRUCTURE.SESSION, config: { source: HELPER } },
        [HELPER]: { uuid: HELPER, name: 'Trial (devices)', structure: STRUCTURE.UNION, config: [D1] },
    })

    it('always deletes the session before its device list', () => {
        const b = byUuid()
        expect(delete_plan(b[SESSION], b).order).toEqual([SESSION, HELPER])
        // Opened from the device list: the session is found up front, so
        // nothing is sent for the device list first.
        expect(owner_of_helper(b[HELPER], b)).toBe(b[SESSION])
        expect(owner_of_helper(b[SESSION], b)).toBe(null)
    })

    it('gives up on a delete that never answers', async () => {
        const client = { DataAccess: { fetch: () => new Promise(() => {}) } }
        const res = await delete_in_order(client, [SESSION, HELPER], { timeout: 10 })
        expect(res.ok).toBe(false)
        expect(res.timedOut).toBe(true)
        expect(res.failed).toBe(SESSION)
        expect(res.deleted).toEqual([])
    })

    it('retries when the only referrer no longer exists', async () => {
        const answers = [[409, { referrers: [{ dataset: SESSION }] }], [409, { referrers: [{ dataset: SESSION }] }], [200, null]]
        const sent = []
        const client = { DataAccess: { fetch: async path => { sent.push(path); return answers.shift() } } }
        const res = await delete_in_order(client, [HELPER], { wait: async () => {}, gone: async r => r === SESSION })
        expect(res.ok).toBe(true)
        expect(sent).toEqual([`v1/delete/${HELPER}`, `v1/delete/${HELPER}`, `v1/delete/${HELPER}`])
    })

    it('does not retry while a referrer still exists, and says which are gone', async () => {
        const OTHER = 'cccccccc-0000-4000-8000-000000000009'
        const client = { DataAccess: { fetch: async () => [409, { referrers: [{ dataset: SESSION }, { dataset: OTHER }] }] } }
        const res = await delete_in_order(client, [HELPER], { wait: async () => {}, gone: async r => r === SESSION })
        expect(res.ok).toBe(false)
        expect(res.gone).toEqual([SESSION])
    })

    it('stops when cancelled', async () => {
        let n = 0
        const client = { DataAccess: { fetch: async () => { n++; return [204, null] } } }
        const res = await delete_in_order(client, [SESSION, HELPER], { cancelled: () => n > 0 })
        expect(res.cancelled).toBe(true)
        expect(n).toBe(1)
    })

    it('reads a 404 for the metadata as gone', async () => {
        expect(await dataset_exists({ DataAccess: { fetch: async () => [404] } }, SESSION)).toBe(false)
        expect(await dataset_exists({ DataAccess: { fetch: async () => [403] } }, SESSION)).toBe(true)
    })
})
