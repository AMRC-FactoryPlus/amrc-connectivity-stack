/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The delete dialog's logic (delete-flow.js) against the real datasets
 * store, with a fake Data Access that logs what reaches it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useDatasetsStore } from '../src/store/useDatasetsStore.js'
import { createDeleteFlow } from '../src/components/Datasets/delete-flow.js'
import { STRUCTURE } from '../src/lib/datasets/constants.js'

const EQ = 'eeeeeeee-0000-4000-8000-000000000001'
const RUNS = [1, 2, 3].map(i => `ffffffff-0000-4000-8000-00000000000${i}`)
const SESSION = 'cccccccc-0000-4000-8000-000000000001'
const HELPER = 'cccccccc-0000-4000-8000-000000000002'
const D1 = 'aaaaaaaa-0000-4000-8000-000000000001'

/* Data Access as a set of datasets and who includes whom. Deletes are
 * refused while a referrer exists, or for `lag` more tries after the
 * last referrer went (its map catches up late). */
function fake_service (datasets, { lag = 0 } = {}) {
    const log = []
    const alive = new Set(Object.keys(datasets))
    let stale = 0
    const referrers = uuid => [...alive].filter(o => (datasets[o].includes ?? []).includes(uuid))
    const client = {
        log,
        alive,
        DataAccess: {
            fetch: async opts => {
                const url = typeof opts === 'string' ? opts : opts.url
                log.push(url)
                const [, kind, uuid] = /^v1\/(delete|metadata)\/(.+)$/.exec(url)
                if (kind === 'metadata') return [alive.has(uuid) ? 200 : 404, {}]
                if (!alive.has(uuid)) return [404, null]
                const refs = referrers(uuid)
                if (refs.length) return [409, { referrers: refs.map(dataset => ({ dataset })) }]
                if (stale > 0) { stale--; return [409, { referrers: [{ dataset: 'gone-but-listed' }] }] }
                alive.delete(uuid)
                return [200, null]
            },
        },
        // Something else (another page) deletes a dataset.
        remove (uuid) {
            alive.delete(uuid)
            stale = lag
        },
    }
    return client
}

/* The store as the subscriptions would fill it. */
function fill_store (ds, recs) {
    ds.structures = recs.map(r => ({ uuid: r.uuid, structure: r.structure, config: r.config }))
    ds.metadata = recs.map(r => ({ uuid: r.uuid, name: r.name }))
}

const fast = { retry: [1, 1, 1, 1, 1], wait: async () => {} }

describe('deleting an equipment while its runs are deleted elsewhere', () => {
    let ds
    beforeEach(() => {
        setActivePinia(createPinia())
        ds = useDatasetsStore()
    })

    const recs = () => [
        { uuid: EQ, name: 'CNC 1', structure: STRUCTURE.UNION, config: [D1] },
        ...RUNS.map((r, i) => ({ uuid: r, name: `Run ${i}`, structure: STRUCTURE.SESSION, config: { source: EQ } })),
    ]

    it('is refused while the runs exist, then deletes once they are gone', async () => {
        fill_store(ds, recs())
        const svc = fake_service({ [EQ]: { includes: [D1] }, ...Object.fromEntries(RUNS.map(r => [r, { includes: [EQ] }])) }, { lag: 2 })
        const deleted = []
        const flow = createDeleteFlow({ ds, client: () => svc, notify: { deleted: u => deleted.push(u) }, options: fast })

        flow.open(ds.byUuid[EQ])
        await flow.retry()
        expect(flow.blocked.value).toBe(true)
        expect(flow.remaining.value).toEqual(RUNS)

        // The runs are deleted from the Recordings list; the store follows.
        for (const r of RUNS) svc.remove(r)
        fill_store(ds, recs().filter(r => r.uuid === EQ))
        await nextTick()
        // The list is rebuilt from the store, and the delete goes again by itself.
        expect(flow.remaining.value).toEqual([])
        await new Promise(r => setTimeout(r, 20))

        const deletes = svc.log.filter(u => u === `v1/delete/${EQ}`)
        expect(deletes.length).toBeGreaterThanOrEqual(4)
        expect(svc.alive.has(EQ)).toBe(false)
        expect(deleted).toEqual([EQ])
        expect(flow.busy.value).toBe(false)
        expect(flow.waiting.value).toBe(false)
    })

    it('says it is waiting for the service, not deleting a device list', async () => {
        fill_store(ds, recs().filter(r => r.uuid === EQ))
        const svc = fake_service({ [EQ]: { includes: [D1] }, [RUNS[0]]: { includes: [EQ] } })
        svc.remove(RUNS[0])
        // The service still lists the run for one more try.
        let first = true
        const fetch = svc.DataAccess.fetch
        svc.DataAccess.fetch = async opts => {
            if (first && opts.url === `v1/delete/${EQ}`) { first = false; svc.log.push(opts.url); return [409, { referrers: [{ dataset: RUNS[0] }] }] }
            return fetch(opts)
        }
        const texts = []
        const flow = createDeleteFlow({ ds, client: () => svc, options: { ...fast, wait: async () => { texts.push(flow.waitingText.value) } } })
        flow.open(ds.byUuid[EQ])
        await flow.retry()
        expect(texts).toEqual(['Waiting for the service to catch up...'])
        expect(svc.alive.has(EQ)).toBe(false)
    })
})

describe('deleting a session and its device list', () => {
    let ds
    beforeEach(() => {
        setActivePinia(createPinia())
        ds = useDatasetsStore()
    })
    const recs = () => [
        { uuid: SESSION, name: 'Trial', structure: STRUCTURE.SESSION, config: { source: HELPER } },
        { uuid: HELPER, name: 'Trial (devices)', structure: STRUCTURE.UNION, config: [D1] },
    ]

    it('sends the session first, then the device list, from the session', async () => {
        fill_store(ds, recs())
        const svc = fake_service({ [SESSION]: { includes: [HELPER] }, [HELPER]: { includes: [D1] } }, { lag: 1 })
        const fetch = svc.DataAccess.fetch
        // Data Access sees the session for one more try after it goes.
        let lagged = false
        svc.DataAccess.fetch = async opts => {
            if (opts.url === `v1/delete/${HELPER}` && !lagged) { lagged = true; svc.log.push(opts.url); return [409, { referrers: [{ dataset: SESSION }] }] }
            return fetch(opts)
        }
        const texts = []
        const flow = createDeleteFlow({ ds, client: () => svc, options: { ...fast, wait: async () => { texts.push(flow.waitingText.value) } } })
        flow.open(ds.byUuid[SESSION])
        await flow.retry()
        expect(svc.log.filter(u => u.startsWith('v1/delete/'))).toEqual([`v1/delete/${SESSION}`, `v1/delete/${HELPER}`, `v1/delete/${HELPER}`])
        expect(texts).toEqual(['Deleting the device list...'])
        expect(svc.alive.size).toBe(0)
    })

    it('from the device list, offers both and sends nothing first', async () => {
        fill_store(ds, recs())
        const svc = fake_service({ [SESSION]: { includes: [HELPER] }, [HELPER]: { includes: [D1] } })
        const flow = createDeleteFlow({ ds, client: () => svc, options: fast })
        flow.open(ds.byUuid[HELPER])
        expect(flow.owner.value?.uuid).toBe(SESSION)
        expect(svc.log).toEqual([])
        await flow.deleteWithOwner()
        expect(svc.log.filter(u => u.startsWith('v1/delete/'))).toEqual([`v1/delete/${SESSION}`, `v1/delete/${HELPER}`])
        expect(svc.alive.size).toBe(0)
    })

    it('never hangs on a request that does not answer', async () => {
        fill_store(ds, recs())
        const svc = { DataAccess: { fetch: () => new Promise(() => {}) } }
        const flow = createDeleteFlow({ ds, client: () => svc, options: { ...fast, timeout: 5 } })
        flow.open(ds.byUuid[SESSION])
        await flow.retry()
        expect(flow.busy.value).toBe(false)
        expect(flow.waiting.value).toBe(false)
        expect(flow.error.value).toBeTruthy()
    })

    it('closing mid-run clears the spinner', async () => {
        fill_store(ds, recs())
        const svc = { DataAccess: { fetch: () => new Promise(() => {}) } }
        const flow = createDeleteFlow({ ds, client: () => svc, options: { ...fast, timeout: 50 } })
        flow.open(ds.byUuid[SESSION])
        const p = flow.retry()
        expect(flow.busy.value).toBe(true)
        flow.close()
        expect(flow.busy.value).toBe(false)
        await p
        expect(flow.busy.value).toBe(false)
    })
})
