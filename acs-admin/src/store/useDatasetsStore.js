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
import { ISA95_HIERARCHY_KEY } from '@store/useISA95Store.js'
import { merge_datasets, historised_metrics, display_name, resolve_devices } from '@/lib/datasets/model.js'

const STATUS_POLL_MS = 60 * 1000
// Keep the subscriptions this long after the last page leaves, so moving
// between Datasets pages does not empty and refetch everything.
const LINGER_MS = 30 * 1000

// The device and node stores are shared with the rest of the app and
// have no stop, so start them once.
let subStoresStarted = false

export const useDatasetsStore = defineStore('datasets', {
    state: () => ({
        metadata: [],
        structures: [],
        metadataReady: false,
        structureReady: false,
        error: null,
        // device uuid -> { online, last_change }
        status: {},
        statusReady: false,
        users: 0,
        running: false,
        subs: [],
        statusTimer: null,
        lingerTimer: null,
    }),

    getters: {
        ready: s => s.metadataReady,

        byUuid: s => merge_datasets(s.metadata, s.structures),

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
         * { uuid, name, sparkplug, address, site, area, metrics, status }.
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
            return (ds.data ?? []).map(d => {
                const info = d.deviceInformation ?? {}
                const om = info.originMap ?? {}
                const h = om?.Device_Information?.[ISA95_HIERARCHY_KEY] ?? {}
                const node = nodeByUuid[info.node]
                const addr = node?.sparkplugAddress
                const metrics = historised_metrics(om)
                const sparkplug = info.sparkplugName ?? null
                return {
                    uuid: d.uuid,
                    name: d.name && d.name !== 'UNKNOWN' ? d.name : (sparkplug ?? d.uuid.slice(0, 8)),
                    sparkplug,
                    address: addr && sparkplug ? `${addr.group_id}/${addr.node_id}/${sparkplug}` : null,
                    site: String(h.Site?.Value ?? '').trim() || null,
                    area: String(h.Area?.Value ?? '').trim() || null,
                    metrics,
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
            await serviceClientReady()
            // Every page may have left while we waited.
            if (!this.running) return
            const client = useServiceClientStore().client
            const da = client.DataAccess

            if (!subStoresStarted) {
                subStoresStarted = true
                useDeviceStore().start()
                useNodeStore().start()
            }

            this.subs.push(da.search_metadata().subscribe({
                next: map => {
                    this.metadata = map ? map.valueSeq().toArray().map(m => m?.toJS ? m.toJS() : m) : []
                    this.metadataReady = true
                },
                error: err => {
                    console.error('Datasets: metadata search failed', err)
                    this.error = 'Could not load datasets from the Data Access service.'
                    this.metadataReady = true
                },
            }))
            this.subs.push(da.search_structure().subscribe({
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
            }))

            this.pollStatus()
            this.statusTimer = setInterval(() => this.pollStatus(), STATUS_POLL_MS)
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
