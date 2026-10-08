/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Review fixes, second round: empty dataset windows, gaps folded into
 * shared stretches, power reported by exception, guessed units, zero
 * energy, recordings bound to the entry as read, and saves that carry
 * on after a part-way failure.
 */

import { describe, it, expect } from 'vitest'
import { parse_series } from '../src/lib/datasets/series.js'
import { window_gaps } from '../src/lib/datasets/gaps.js'
import { find_power_series, power_to_register, reports_by_exception, energy_and_carbon } from '../src/lib/datasets/energy.js'
import { update_recording, stop_recording, create_from_spec, ensure_device_datasets, void_resumed } from '../src/lib/datasets/api.js'
import { DA } from '../src/lib/datasets/constants.js'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const T0 = Date.parse('2026-10-08T08:00:00.000Z')
const EQ = 'eeeeeeee-0000-4000-8000-000000000001'

describe('dataset windows', () => {
    it('keeps an empty list of windows empty, and none as null', () => {
        const s = parse_series({ from: T0, to: T0 + HOUR, every: '5m', devices: { a: { windows: [], count: [] }, b: { count: [] } } })
        expect(s.devices.a.windows).toEqual([])
        expect(s.devices.b.windows).toBe(null)
    })
})

describe('gaps shared by most devices', () => {
    const W = { from: T0, to: T0 + 2 * HOUR, every: '5m' }
    const rows = idx => idx.map(i => [T0 + i * 5 * MIN, 300])
    const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i)

    it('keeps what is left of a long outage outside a short shared gap', () => {
        // b and c miss 20 to 30 min; a misses 20 min to 1 h 40.
        const r = window_gaps({
            a: rows([...range(0, 4), ...range(20, 24)]),
            b: rows([...range(0, 4), ...range(6, 24)]),
            c: rows([...range(0, 4), ...range(6, 24)]),
        }, W)
        expect(r.shared).toEqual([expect.objectContaining({ from: T0 + 20 * MIN, to: T0 + 30 * MIN })])
        expect(r.own.a).toEqual([{ from: T0 + 30 * MIN, to: T0 + 100 * MIN }])
        expect(r.total).toBe(2)
    })

    it('drops a leftover too short to be a gap', () => {
        const r = window_gaps({
            a: rows([...range(0, 4), ...range(7, 24)]),
            b: rows([...range(0, 4), ...range(6, 24)]),
            c: rows([...range(0, 4), ...range(6, 24)]),
        }, W)
        expect(r.own.a).toEqual([])
        expect(r.total).toBe(1)
    })
})

describe('power reported by exception', () => {
    // Changes now and then: quiet stretches of 5 to 20 minutes at a steady 10 kW.
    const changes = [0, 1, 2, 7, 8, 28, 29, 30, 45, 46, 60].map(m => ({ t: T0 + m * MIN, v: 10 }))

    it('holds the last value across quiet stretches', () => {
        expect(reports_by_exception(changes)).toBe(true)
        const reg = power_to_register({ device: 'M', metric: 'Active_Power', unit: 'kW', power_scale: 1, points: changes })
        expect(reg.held).toBe(true)
        expect(reg.gaps).toEqual([])
        expect(reg.points.at(-1).v).toBeCloseTo(10, 6)
        expect(reg.held_ms).toBeGreaterThan(0)
    })

    it('does not hold for a meter on a clock that stopped once', () => {
        const pts = []
        for (let t = T0; t <= T0 + 10 * MIN; t += SEC) if (t <= T0 + 4 * MIN || t >= T0 + 6 * MIN) pts.push({ t, v: 60 })
        expect(reports_by_exception(pts)).toBe(false)
        expect(power_to_register({ device: 'M', metric: 'P', unit: 'kW', power_scale: 1, points: pts }).gaps).toHaveLength(1)
    })

    it('never holds beyond the longest bridge', () => {
        const pts = [...changes, { t: T0 + 5 * HOUR, v: 10 }]
        const reg = power_to_register({ device: 'M', metric: 'P', unit: 'kW', power_scale: 1, points: pts })
        expect(reg.gaps).toEqual([{ from: T0 + 60 * MIN, to: T0 + 5 * HOUR }])
    })
})

describe('guessed units and zero energy', () => {
    const steady = () => {
        const pts = []
        for (let t = T0; t <= T0 + HOUR; t += MIN) pts.push({ t, v: 6 })
        return pts
    }

    it('flags a meter with no unit and caps confidence at low', () => {
        const [s] = find_power_series([{ device: 'M', metric: 'Active_Power', unit: '', points: steady() }])
        expect(s.unit_guessed).toBe(true)
        const reg = power_to_register(s)
        const r = energy_and_carbon({ meters: [reg], from: T0, to: T0 + HOUR })
        expect(r.coverage).toBeCloseTo(1)
        expect(r.unit_guessed).toBe(true)
        expect(r.confidence).toBe('low')
    })

    it('does not mark zero energy as low confidence', () => {
        const pts = steady().map(p => ({ ...p, v: 0 }))
        const reg = power_to_register({ device: 'M', metric: 'P', unit: 'kW', power_scale: 1, points: pts })
        const intensity = [{ t: T0 - HOUR, v: 200 }, { t: T0 + 2 * HOUR, v: 200 }]
        const r = energy_and_carbon({ meters: [reg], intensity, from: T0, to: T0 + HOUR })
        expect(r.kwh).toBe(0)
        expect(r.kg_grid).toBe(0)
        expect(r.intensity_coverage).toBe(1)
        expect(r.confidence).toBe('high')
        const plain = energy_and_carbon({ meters: [reg], from: T0, to: T0 + HOUR })
        expect(plain.intensity_coverage).toBe(null)
        expect(plain.kg_grid).toBe(null)
    })
})

/* A ConfigDB with one Recording entry and ETags. `onRead` can change
 * the entry after a read, as another screen would. */
function fake_cdb (entry, { onRead = () => {} } = {}) {
    const state = { entry, etag: 'aaaaaaaa-0000-4000-8000-000000000001', n: 1, writes: [] }
    const bump = () => { state.n++; state.etag = `aaaaaaaa-0000-4000-8000-${String(state.n).padStart(12, '0')}` }
    const client = {
        state,
        ConfigDB: {
            get_config_with_etag: async (app, obj) => {
                const out = state.entry ? [structuredClone(state.entry), state.etag] : []
                onRead(state, bump)
                return out
            },
            get_config: async () => ({}),
            put_config: async () => {},
            class_add_member: async () => {},
            delete_config: async () => { state.entry = null },
            fetch: async ({ method, body, headers }) => {
                state.writes.push({ method, body, headers })
                const im = headers['If-Match']
                if (!state.entry) return [im ? 412 : 404]
                if (im && im !== '*' && im !== `"${state.etag}"`) return [412]
                if (method === 'PATCH') { state.entry = { ...state.entry, ...body }; bump() }
                if (method === 'DELETE') state.entry = null
                return [204]
            },
        },
        DataAccess: { create_dataset: async () => 'ffffffff-0000-4000-8000-000000000001' },
    }
    return client
}

describe('recordings bound to the entry as read', () => {
    const rec = () => ({ startedAt: new Date(T0).toISOString(), tags: [], devices: [] })

    it('applies an edit to what another screen just wrote', async () => {
        let once = true
        const client = fake_cdb(rec(), {
            onRead: (state, bump) => {
                if (!once) return
                once = false
                state.entry = { ...state.entry, note: 'from the other screen' }
                bump()
            },
        })
        await update_recording(client, EQ, r => { r.tags = ['a']; return r })
        expect(client.state.entry).toEqual(expect.objectContaining({ note: 'from the other screen', tags: ['a'] }))
        expect(client.state.writes[0].headers['If-Match']).toMatch(/^"/)
    })

    it('does not save a second run when another screen stops first', async () => {
        const client = fake_cdb(rec(), {
            onRead: (state, bump) => {
                if (state.entry && !state.entry.stoppedAt) {
                    state.entry = { ...state.entry, stoppedAt: new Date(T0 + HOUR).toISOString(), stoppedBy: 'someone' }
                    bump()
                }
            },
        })
        await expect(stop_recording(client, { uuid: EQ, name: 'Lathe' }, { by: 'me' }))
            .rejects.toMatchObject({ status: 409 })
    })

    it('stops and saves when nothing else is writing', async () => {
        const client = fake_cdb(rec())
        const res = await stop_recording(client, { uuid: EQ, name: 'Lathe' }, { by: 'me', stoppedAt: T0 + HOUR })
        expect(res.run).toBe('ffffffff-0000-4000-8000-000000000001')
        expect(client.state.writes[0].body.stoppedAt).toBe(new Date(T0 + HOUR).toISOString())
    })
})

describe('saves that carry on after a part-way failure', () => {
    const client = () => {
        let n = 0
        const made = []
        return {
            made,
            DataAccess: {
                create_dataset: async (structure) => {
                    const u = `dddddddd-0000-4000-8000-${String(++n).padStart(12, '0')}`
                    made.push([structure, u])
                    return u
                },
            },
            ConfigDB: {
                get_config: async () => ({}),
                put_config: async () => {},
                class_add_member: async () => {},
                fetch: async () => [204],
            },
        }
    }

    it('reuses the union and session made before the failure', async () => {
        const c = client()
        const spec = { name: 'Trial', items: ['x', 'y'], window: { from: T0, to: T0 + HOUR }, kind: null, createdBy: 'me' }
        const progress = {}
        // Fail on the metadata write.
        let calls = 0
        c.ConfigDB.put_config = async (app) => { if (app === DA.App.RunMetadata && calls++ === 0) throw new Error('down') }
        await expect(create_from_spec(c, spec, progress)).rejects.toThrow()
        expect(c.made).toHaveLength(2)
        const uuid = await create_from_spec(c, spec, progress)
        expect(c.made).toHaveLength(2)
        expect(uuid).toBe(c.made[1][1])
    })

    it('starts again when the items change', async () => {
        const c = client()
        const progress = { key: 'old', union: 'u', session: 's' }
        await create_from_spec(c, { name: 'T', items: ['x', 'y'], window: null, createdBy: 'me' }, progress)
        expect(c.made).toHaveLength(1)
        expect(progress.union).toBe(c.made[0][1])
    })

    it('reuses device datasets made before the failure', async () => {
        const c = client()
        const created = {}
        let names = 0
        c.ConfigDB.put_config = async () => { if (names++ === 1) throw new Error('down') }
        await expect(ensure_device_datasets(c, ['d1', 'd2'], {}, () => 'Name', created)).rejects.toThrow()
        expect(Object.keys(created)).toEqual(['d1', 'd2'])
        const out = await ensure_device_datasets(c, ['d1', 'd2'], {}, () => 'Name', created)
        expect(c.made).toHaveLength(2)
        expect(out).toEqual(created)
    })
})

describe('resuming a run', () => {
    it('tries again to void the earlier run', async () => {
        let tries = 0
        const client = {
            ConfigDB: {
                get_config: async () => ({}),
                fetch: async () => (++tries < 2 ? [500] : [204]),
            },
        }
        expect(await void_resumed(client, 'r', 'me', 3)).toBe(true)
        expect(tries).toBe(2)
    })
})
