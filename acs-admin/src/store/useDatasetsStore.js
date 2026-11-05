/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * One store for the Datasets pages: every dataset you can see, merged
 * from the two Data Access searches, plus the devices they are built
 * from. Data Access pushes changes, so lists, the timeline and
 * recordings update without a refresh.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useISA95Store } from '@store/useISA95Store.js'
import { placement_path } from '@/lib/isa95-placement.js'
import { merge_datasets, historised_metrics, display_name, resolve_devices } from '@/lib/datasets/model.js'
import { DA } from '@/lib/datasets/constants.js'

const STATUS_POLL_MS = 60 * 1000
// Keep the subscriptions this long after the last page leaves, so moving
// between Datasets pages does not empty and refetch everything.
const LINGER_MS = 30 * 1000

// The device and node stores are shared with the rest of the app and
// have no stop, so start them once.
let subStoresStarted = false
// A failed search subscription is tried again after this long.
const RESUBSCRIBE_MS = 15 * 1000
const retryTimers = new Set()
let onVisible = null

export const useDatasetsStore = defineStore('datasets', {
    state: () => ({
        metadata: [],
        structures: [],
        metadataReady: false,
        structureReady: false,
        error: null,
        // device uuid -> { online, last_change }
        status: {},
        // dataset uuid -> owner principal uuid, and principal -> name
        owners: {},
        ownerNames: {},
        statusReady: false,
        users: 0,
        running: false,
        subs: [],
        statusTimer: null,
        lingerTimer: null,
    }),

    getters: {
        ready: s => s.metadataReady,

        byUuid: s => merge_datasets(s.metadata, s.structures, s.ownerNameOf),

        /** Dataset UUID -> its owner's name, where we know it. */
        ownerNameOf: s => {
            const out = {}
            for (const [ds, p] of Object.entries(s.owners)) if (s.ownerNames[p]) out[ds] = s.ownerNames[p]
            return out
        },

        /** Every dataset, device datasets included. */
        all () { return Object.values(this.byUuid) },

        /** Datasets people work with: everything but bare device datasets. */
        visible () { return this.all.filter(r => r.kind !== 'device') },

        equipment () { return this.all.filter(r => r.kind === 'equipment') },

        /** Equipment UUID -> recording in progress. */
        recordings () {
            const out = {}
            for (const r of this.equipment) if (r.recording?.startedAt) out[r.uuid] = r.recording
            return out
        },

        /** Runs of each piece of equipment, newest first. */
        runsByEquipment () {
            const out = {}
            for (const r of this.all) {
                if (r.kind !== 'run') continue
                const eq = r.run?.equipment ?? (r.config?.source && this.byUuid[r.config.source]?.kind === 'equipment' ? r.config.source : null)
                if (!eq) continue
                ;(out[eq] ??= []).push(r)
            }
            for (const list of Object.values(out)) list.sort((a, b) => Date.parse(b.from ?? 0) - Date.parse(a.from ?? 0))
            return out
        },

        /** Every tag in use, most used first. */
        allTags () {
            const n = new Map()
            for (const r of this.all) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1)
            return [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t)
        },

        /**
         * Devices from the ConfigDB, with what the pages need:
         * { uuid, name, sparkplug, address, site, area, metrics, originMap, status }.
         * The origin map is kept for working out i3X IDs on demand.
         * Status is merged last, so a status poll does not re-walk every
         * origin map.
         */
        devices () {
            return this.deviceInfo.map(d => ({ ...d, status: this.status[d.uuid] ?? null }))
        },

        deviceInfo () {
            const ds = useDeviceStore()
            const nodes = useNodeStore()
            const nodeByUuid = Object.fromEntries((nodes.data ?? []).map(n => [n.uuid, n]))
            const vocab = useISA95Store().vocabulary
            return (ds.data ?? []).map(d => {
                const info = d.deviceInformation ?? {}
                const om = info.originMap ?? {}
                // Enterprise, Site, Area... from the device's placement.
                const path = placement_path(vocab, d.placement)
                const node = nodeByUuid[info.node]
                const addr = node?.sparkplugAddress
                const metrics = historised_metrics(om)
                const sparkplug = info.sparkplugName ?? null
                return {
                    uuid: d.uuid,
                    name: d.name && d.name !== 'UNKNOWN' ? d.name : (sparkplug ?? d.uuid.slice(0, 8)),
                    sparkplug,
                    address: addr && sparkplug ? `${addr.group_id}/${addr.node_id}/${sparkplug}` : null,
                    site: path[1] ?? null,
                    area: path[2] ?? null,
                    metrics,
                    originMap: om,
                }
            })
        },

        deviceByUuid () { return Object.fromEntries(this.devices.map(d => [d.uuid, d])) },

        /** Sparkplug device ID -> device, for reading CSV rows. */
        deviceBySparkplug () {
            const out = {}
            for (const d of this.devices) if (d.sparkplug) (out[d.sparkplug] ??= d)
            return out
        },

        devicesReady: () => useDeviceStore().ready,
    },

    actions: {
        async start () {
            this.users++
            clearTimeout(this.lingerTimer)
            this.lingerTimer = null
            if (this.running) return
            this.running = true
            try {
                await serviceClientReady()
                // Every page may have left while we waited.
                if (!this.running) return

                if (!subStoresStarted) {
                    subStoresStarted = true
                    useDeviceStore().start()
                    useNodeStore().start()
                }
                // Device sites and areas come from the ISA-95 vocabulary.
                // Its start is idempotent, and the ISA-95 page stops it
                // when it leaves, so start it every time.
                useISA95Store().start()

                this.subscribe('metadata', da => da.search_metadata(), {
                    next: map => {
                        this.metadata = map ? map.valueSeq().toArray().map(m => m?.toJS ? m.toJS() : m) : []
                        this.metadataReady = true
                        this.error = null
                    },
                    error: err => {
                        console.error('Datasets: metadata search failed', err)
                        this.error = 'Could not load datasets from the Data Access service.'
                        this.metadataReady = true
                    },
                })
                this.subscribe('structure', da => da.search_structure(), {
                    next: map => {
                        this.structures = map
                            ? map.entrySeq().map(([uuid, v]) => ({ ...(v?.toJS ? v.toJS() : v), uuid })).toArray()
                            : []
                        this.structureReady = true
                    },
                    error: err => {
                        console.error('Datasets: structure search failed', err)
                        this.structureReady = true
                    },
                })

                this.watchOwners()
                this.pollStatus()
                // Directory status is polled only while the page is seen.
                this.statusTimer = setInterval(() => {
                    if (document.visibilityState !== 'hidden') this.pollStatus()
                }, STATUS_POLL_MS)
                onVisible = () => { if (document.visibilityState === 'visible' && this.running) this.pollStatus() }
                document.addEventListener('visibilitychange', onVisible)
            }
            catch (err) {
                // Let the next page that needs the store start it again.
                console.error('Datasets: the store did not start', err)
                this.error = 'Could not load datasets from the Data Access service.'
                this.running = false
            }
        },

        /**
         * Subscribe to a Data Access search. A subscription that fails
         * is tried again after a while, for as long as the store runs.
         */
        subscribe (name, make, { next, error }) {
            // `let`: an error can arrive before subscribe() returns.
            let sub = null
            sub = make(useServiceClientStore().client.DataAccess).subscribe({
                next,
                error: err => {
                    error(err)
                    if (sub) this.subs = this.subs.filter(x => x !== sub)
                    const retry = setTimeout(() => {
                        retryTimers.delete(retry)
                        if (this.running) this.subscribe(name, make, { next, error })
                    }, RESUBSCRIBE_MS)
                    retryTimers.add(retry)
                },
            })
            if (!sub.closed) this.subs.push(sub)
        },

        /**
         * The ConfigDB owner of each dataset, for datasets made without
         * the Admin UI's run details. This needs ReadConfig on the
         * Registration app; without it the search emits nothing and
         * those datasets keep showing no author.
         */
        watchOwners () {
            const cdb = useServiceClientStore().client.ConfigDB
            const sub = cdb.search_app(DA.Core.Registration, { class: DA.Class.Dataset }).subscribe({
                next: regs => {
                    const owners = {}
                    for (const [uuid, reg] of regs ?? []) {
                        if (reg?.owner && reg.owner !== DA.Core.Unowned) owners[uuid] = reg.owner
                    }
                    this.owners = owners
                    this.nameOwners(new Set(Object.values(owners)))
                },
                error: err => console.warn('Datasets: owner search failed', err),
            })
            if (!sub.closed) this.subs.push(sub)
        },

        async nameOwners (principals) {
            const cdb = useServiceClientStore().client.ConfigDB
            for (const p of principals) {
                if (p in this.ownerNames) continue
                // Mark it first so a second emit does not fetch it again.
                this.ownerNames[p] = null
                try {
                    const info = await cdb.get_config(DA.Core.Info, p)
                    if (this.running) this.ownerNames[p] = info?.name ?? null
                }
                catch (err) {
                    console.warn('Datasets: no name for owner %s', p, err)
                }
            }
        },

        stop () {
            this.users = Math.max(0, this.users - 1)
            if (this.users > 0 || this.lingerTimer) return
            this.lingerTimer = setTimeout(() => this.teardown(), LINGER_MS)
        },

        teardown () {
            if (this.users > 0) return
            for (const s of this.subs) s.unsubscribe()
            clearInterval(this.statusTimer)
            for (const t of retryTimers) clearTimeout(t)
            retryTimers.clear()
            if (onVisible) document.removeEventListener('visibilitychange', onVisible)
            onVisible = null
            this.$reset()
        },

        /**
         * Online or offline per device, from the Directory. This is the
         * device's Sparkplug session, not whether data is arriving.
         */
        async pollStatus () {
            try {
                const client = useServiceClientStore().client
                const [st, rows] = await client.Directory.fetch('v1/search')
                if (!this.running || st !== 200 || !Array.isArray(rows)) return
                const out = {}
                for (const r of rows) {
                    if (!r?.uuid) continue
                    out[r.uuid] = { online: !!r.online, last_change: r.last_change ?? null }
                }
                // Skip unchanged polls so nothing downstream recomputes.
                if (JSON.stringify(out) !== JSON.stringify(this.status)) this.status = out
                this.statusReady = true
            }
            catch (err) {
                console.warn('Datasets: device status poll failed', err)
            }
        },

        name (uuid) { return display_name(this.byUuid[uuid]) },

        devicesOf (uuid) { return resolve_devices(uuid, this.byUuid) },
    },
})
