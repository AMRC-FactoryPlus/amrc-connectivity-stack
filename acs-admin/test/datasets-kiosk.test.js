/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Kiosk logic: which screen to show from the server's recording entry,
 * the offline Stop kept on the tablet, the resume window, and today's
 * lane in London time.
 */

import { describe, it, expect } from 'vitest'
import { RESUME_WINDOW_MS } from '../src/lib/datasets/constants.js'
import {
    derive_phase, saved_is_current, resume_left, fmt_minutes_left, SAVED_KEEP_MS,
    is_network_error,
    read_pending, write_pending, clear_pending, read_saved, write_saved,
    read_operator, write_operator, read_operators, write_operators, remember_name,
    lane_range, lane_ticks, lane_pct, lane_blocks,
    step_time, forgot_default, overlapping_runs, STEPS, MINUTE, HOUR,
    device_summary, main_area, suggest_tags,
} from '../src/lib/datasets/kiosk.js'

const EQ = 'cccccccc-0000-4000-8000-000000000001'
const RUN = 'dddddddd-0000-4000-8000-000000000001'
const RUN2 = 'dddddddd-0000-4000-8000-000000000002'

function memory_storage () {
    const m = new Map()
    return {
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
    }
}

const broken_storage = {
    getItem () { throw new Error('denied') },
    setItem () { throw new Error('denied') },
    removeItem () { throw new Error('denied') },
}

describe('derive_phase', () => {
    const rec = { startedAt: '2026-10-07T08:00:00.000Z' }

    it('asks for equipment first', () => {
        expect(derive_phase({ equipment: null, recording: rec })).toBe('choose')
    })

    it('is ready with no recording', () => {
        expect(derive_phase({ equipment: EQ, recording: null })).toBe('ready')
    })

    it('follows a recording on the server, so a reload or second tablet agrees', () => {
        expect(derive_phase({ equipment: EQ, recording: rec })).toBe('recording')
    })

    it('shows failed when the server has a stop time but the entry is still there', () => {
        expect(derive_phase({ equipment: EQ, recording: { ...rec, stoppedAt: '2026-10-07T09:00:00.000Z' } })).toBe('failed')
    })

    it('shows failed after a local failure that never reached the server', () => {
        expect(derive_phase({ equipment: EQ, recording: rec, failed: true })).toBe('failed')
    })

    it('shows saving while a stop is in flight, even with a stop time', () => {
        expect(derive_phase({ equipment: EQ, recording: { ...rec, stoppedAt: rec.startedAt }, saving: true })).toBe('saving')
    })

    it('waits to save when a Stop was pressed offline', () => {
        expect(derive_phase({ equipment: EQ, recording: rec, pending: { stoppedAt: 1 } })).toBe('queued')
    })

    it('drops a pending stop once the recording is gone', () => {
        expect(derive_phase({ equipment: EQ, recording: null, pending: { stoppedAt: 1 } })).toBe('ready')
    })

    it('shows the saved summary when there is no recording', () => {
        expect(derive_phase({ equipment: EQ, recording: null, saved: { run: RUN } })).toBe('saved')
    })

    it('shows saved, not failed, while the saved entry is still on the server', () => {
        const left = { ...rec, stoppedAt: '2026-10-07T09:00:00.000Z' }
        expect(derive_phase({ equipment: EQ, recording: left, saved: { run: RUN, recordStart: rec.startedAt } })).toBe('saved')
    })

    it('shows a resumed recording as recording, though it has the same start', () => {
        const resumed = { ...rec, resumes: RUN }
        expect(derive_phase({ equipment: EQ, recording: resumed, saved: { run: RUN, recordStart: rec.startedAt } })).toBe('recording')
    })

    it('prefers a new recording over an old saved summary', () => {
        expect(derive_phase({ equipment: EQ, recording: rec, saved: { run: RUN } })).toBe('recording')
    })
})

describe('saved summary and resume', () => {
    const now = Date.parse('2026-10-07T10:00:00.000Z')
    const saved = { run: RUN, from: now - HOUR, to: now - MINUTE, savedAt: now - MINUTE }

    it('is current right after a save', () => {
        expect(saved_is_current(saved, [{ uuid: RUN, from: new Date(saved.from).toISOString() }], now)).toBe(true)
    })

    it('expires', () => {
        expect(saved_is_current(saved, [], now + SAVED_KEEP_MS)).toBe(false)
    })

    it('is stale once a newer run exists', () => {
        const newer = { uuid: RUN2, from: new Date(now - 30 * 1000).toISOString() }
        expect(saved_is_current(saved, [newer], now)).toBe(false)
    })

    it('ignores a newer voided run', () => {
        const newer = { uuid: RUN2, from: new Date(now - 30 * 1000).toISOString(), voided: true }
        expect(saved_is_current(saved, [newer], now)).toBe(true)
    })

    it('offers resume for RESUME_WINDOW_MS after the stop', () => {
        expect(resume_left(saved, saved.to)).toBe(RESUME_WINDOW_MS)
        expect(resume_left(saved, saved.to + RESUME_WINDOW_MS)).toBe(0)
        expect(resume_left(saved, saved.to + RESUME_WINDOW_MS + 1)).toBe(0)
    })

    it('never offers resume for a recording added afterwards', () => {
        expect(resume_left({ ...saved, added: true }, saved.to)).toBe(0)
    })

    it('rounds minutes left up', () => {
        expect(fmt_minutes_left(4 * MINUTE + 1)).toBe('5 min left')
        expect(fmt_minutes_left(1000)).toBe('1 min left')
    })
})

describe('is_network_error', () => {
    it('treats offline as a network error', () => {
        expect(is_network_error(new Error('anything'), false)).toBe(true)
    })
    it('spots a fetch TypeError', () => {
        expect(is_network_error(new TypeError('Failed to fetch'))).toBe(true)
    })
    it('spots a wrapped fetch failure', () => {
        expect(is_network_error({ message: 'The dataset was not saved.', detail: 'NetworkError when attempting to fetch resource.' })).toBe(true)
    })
    it('does not treat an HTTP refusal as offline', () => {
        expect(is_network_error({ message: 'Failed to fetch', status: 403 })).toBe(false)
        expect(is_network_error(new Error('The service refused the definition.'))).toBe(false)
    })
})

describe('storage on the tablet', () => {
    it('keeps a pending stop per equipment', () => {
        const s = memory_storage()
        write_pending(s, EQ, { stoppedAt: 123, by: 'kiosk' })
        expect(read_pending(s, EQ)).toEqual({ stoppedAt: 123, by: 'kiosk' })
        expect(read_pending(s, 'other')).toBeNull()
        clear_pending(s, EQ)
        expect(read_pending(s, EQ)).toBeNull()
    })

    it('ignores a pending stop without a time', () => {
        const s = memory_storage()
        s.setItem(`acs-kiosk:pending-stop:${EQ}`, '{"by":"x"}')
        expect(read_pending(s, EQ)).toBeNull()
    })

    it('keeps the saved summary', () => {
        const s = memory_storage()
        write_saved(s, EQ, { run: RUN, from: 1, to: 2 })
        expect(read_saved(s, EQ).run).toBe(RUN)
    })

    it('keeps the operator and recent names', () => {
        const s = memory_storage()
        write_operator(s, 'Sam')
        write_operators(s, ['Sam', 'Kim'])
        expect(read_operator(s)).toBe('Sam')
        expect(read_operators(s)).toEqual(['Sam', 'Kim'])
    })

    it('never throws when storage is blocked', () => {
        expect(read_pending(broken_storage, EQ)).toBeNull()
        expect(write_pending(broken_storage, EQ, { stoppedAt: 1 })).toBe(false)
        expect(read_saved(broken_storage, EQ)).toBeNull()
        expect(read_operator(broken_storage)).toBe('')
        expect(write_operator(broken_storage, 'Sam')).toBe(false)
        expect(read_operators(broken_storage)).toEqual([])
        expect(read_operators(undefined)).toEqual([])
    })

    it('survives bad JSON', () => {
        const s = memory_storage()
        s.setItem('acs-kiosk:operators', '{not json')
        expect(read_operators(s)).toEqual([])
    })
})

describe('remember_name', () => {
    it('puts the name first without duplicates, ignoring case', () => {
        expect(remember_name(['Kim', 'sam', 'Lee'], ' Sam ')).toEqual(['Sam', 'Kim', 'Lee'])
    })
    it('keeps the list short', () => {
        expect(remember_name(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
    })
    it('ignores a blank name', () => {
        expect(remember_name(['a'], '  ')).toEqual(['a'])
    })
})

describe("today's lane", () => {
    it('runs 06:00 to 18:00 London time in summer (BST)', () => {
        const r = lane_range(Date.parse('2026-07-01T12:00:00.000Z'))
        expect(new Date(r.from).toISOString()).toBe('2026-07-01T05:00:00.000Z')
        expect(new Date(r.to).toISOString()).toBe('2026-07-01T17:00:00.000Z')
    })

    it('runs 06:00 to 18:00 London time in winter (GMT)', () => {
        const r = lane_range(Date.parse('2026-12-01T12:00:00.000Z'))
        expect(new Date(r.from).toISOString()).toBe('2026-12-01T06:00:00.000Z')
    })

    it('uses the London day just after midnight', () => {
        // 23:30 UTC on 7 Oct is 00:30 on 8 Oct in London.
        const r = lane_range(Date.parse('2026-10-07T23:30:00.000Z'))
        expect(new Date(r.from).toISOString()).toBe('2026-10-08T05:00:00.000Z')
    })

    it('has five ticks', () => {
        const t = lane_ticks(lane_range())
        expect(t.map(x => x.label)).toEqual(['06:00', '09:00', '12:00', '15:00', '18:00'])
        expect(t.map(x => x.left)).toEqual([0, 25, 50, 75, 100])
    })

    it('clamps positions', () => {
        const range = { from: 0, to: 100 }
        expect(lane_pct(-5, range)).toBe(0)
        expect(lane_pct(50, range)).toBe(50)
        expect(lane_pct(500, range)).toBe(100)
    })

    it('places runs, the live recording and the last save', () => {
        const now = Date.parse('2026-10-07T11:00:00.000Z')
        const range = lane_range(now)  // 05:00Z to 17:00Z
        const runs = [
            { uuid: RUN, from: '2026-10-07T05:00:00.000Z', to: '2026-10-07T08:00:00.000Z' },
            { uuid: RUN2, from: '2026-10-06T05:00:00.000Z', to: '2026-10-06T08:00:00.000Z' },
            { uuid: 'v', from: '2026-10-07T08:00:00.000Z', to: '2026-10-07T08:30:00.000Z', voided: true },
        ]
        const b = lane_blocks({ runs, recording: { startedAt: '2026-10-07T10:00:00.000Z' }, savedRun: RUN, range, now })
        expect(b).toHaveLength(3)
        expect(b[0]).toMatchObject({ kind: 'saved', left: 0, width: 25, label: 'Saved' })
        expect(b[1].kind).toBe('voided')
        expect(b[2]).toMatchObject({ key: 'live', kind: 'live' })
        expect(b[2].left).toBeCloseTo(41.67, 1)
    })
})

describe('dialog times', () => {
    const now = Date.parse('2026-10-07T10:07:30.000Z')

    it('never steps into the future', () => {
        expect(step_time(now - MINUTE, HOUR, now)).toBe(now)
        expect(step_time(now, -5 * MINUTE, now)).toBe(now - 5 * MINUTE)
    })

    it('has six steps', () => {
        expect(STEPS.map(s => s.delta)).toEqual([-HOUR, -5 * MINUTE, -MINUTE, MINUTE, 5 * MINUTE, HOUR])
    })

    it('guesses the last hour when nothing ran', () => {
        const w = forgot_default([], now)
        expect(new Date(w.to).toISOString()).toBe('2026-10-07T10:07:00.000Z')
        expect(w.to - w.from).toBe(HOUR)
    })

    it('starts after the last run', () => {
        const w = forgot_default([{ from: '2026-10-07T09:00:00.000Z', to: '2026-10-07T09:40:10.000Z' }], now)
        expect(new Date(w.from).toISOString()).toBe('2026-10-07T09:41:00.000Z')
    })

    it('keeps at least five minutes', () => {
        const w = forgot_default([{ from: '2026-10-07T09:00:00.000Z', to: '2026-10-07T10:06:00.000Z' }], now)
        expect(w.to - w.from).toBe(5 * MINUTE)
    })

    it('finds overlapping runs, not voided ones', () => {
        const runs = [
            { uuid: 'a', from: '2026-10-07T09:00:00.000Z', to: '2026-10-07T09:30:00.000Z' },
            { uuid: 'b', from: '2026-10-07T09:30:00.000Z', to: '2026-10-07T10:00:00.000Z' },
            { uuid: 'c', from: '2026-10-07T09:10:00.000Z', to: '2026-10-07T09:20:00.000Z', voided: true },
        ]
        const hits = overlapping_runs(runs, Date.parse('2026-10-07T09:15:00.000Z'), Date.parse('2026-10-07T09:30:00.000Z'))
        expect(hits.map(r => r.uuid)).toEqual(['a'])
    })
})

describe('equipment and devices', () => {
    const devs = [
        { name: 'Spindle', area: 'Machining', status: { online: true } },
        { name: 'Meter', area: 'Machining', status: { online: false } },
        { name: 'Coolant', area: 'Utilities', status: null },
    ]

    it('counts online devices and names the rest', () => {
        const s = device_summary(devs)
        expect(s.text).toBe('1 of 3 devices online')
        expect(s.offline).toEqual(['Meter', 'Coolant'])
        expect(s.none_online).toBe(false)
    })

    it('flags equipment with no device online', () => {
        expect(device_summary([devs[1]]).none_online).toBe(true)
        expect(device_summary([devs[1]]).text).toBe('0 of 1 device online')
    })

    it('says nothing about offline before the first status poll', () => {
        const s = device_summary(devs, false)
        expect(s.offline).toEqual([])
        expect(s.none_online).toBe(false)
        expect(s.text).toBe('3 devices')
    })

    it('picks the most common area', () => {
        expect(main_area(devs)).toBe('Machining')
        expect(main_area([])).toBeNull()
    })

    it('suggests the equipment tags first, without ones already chosen', () => {
        const runs = [{ tags: ['job-1', 'trial'] }, { tags: ['trial'] }]
        expect(suggest_tags(runs, ['other', 'Job-1', 'more'], ['TRIAL'], 3)).toEqual(['job-1', 'other', 'more'])
    })
})
