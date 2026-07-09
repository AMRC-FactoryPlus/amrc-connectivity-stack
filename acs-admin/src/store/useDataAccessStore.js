/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'

export const useDataAccessStore = defineStore('data-access', {
    state: () => ({
        datasets: [],    // from search_metadata — readable datasets
        structures: [],  // from search_structure — editable datasets
        union_sources: [],   // from watch_union_sources_list — datasets permitted for use in a Union
        session_sources: [], // from watch_session_sources_list — datasets permitted for use as a Session source
        loading: true,
        ready: false,
        metadataSub: null,
        structureSub: null,
        unionSourcesSub: null,
        sessionSourcesSub: null,
    }),

    actions: {
        async start () {
            this.loading = true
            this.ready = false
            await serviceClientReady()

            const da = useServiceClientStore().client.DataAccess

            this.metadataSub = da.search_metadata().subscribe({
                next: map => {
                    this.datasets = map ? map.valueSeq().toArray() : []
                    this.loading = false
                    this.ready = true
                    console.log("Metadata map:", map?.toJS())
                },
                error: err => {
                    console.error('DataAccess metadata subscription error:', err)
                    this.loading = false
                    this.ready = true
                },
            })

            this.structureSub = da.search_structure().subscribe({
                next: map => {
                    this.structures = map
                        ? map.entrySeq().map(([uuid, v]) => ({ ...v, uuid })).toArray()
                        : []
                    console.log("Structure map:", map?.toJS())
                },
                error: err => {
                    console.error('DataAccess structure subscription error:', err)
                },
            })

            this.unionSourcesSub = da.watch_union_sources_list().subscribe({
                next: uuids => {
                    this.union_sources = uuids ?? []
                },
                error: err => {
                    console.error('DataAccess union sources subscription error:', err)
                },
            })

            this.sessionSourcesSub = da.watch_session_sources_list().subscribe({
                next: uuids => {
                    this.session_sources = uuids ?? []
                },
                error: err => {
                    console.error('DataAccess session sources subscription error:', err)
                },
            })
        },

        stop () {
            this.metadataSub?.unsubscribe()
            this.structureSub?.unsubscribe()
            this.unionSourcesSub?.unsubscribe()
            this.sessionSourcesSub?.unsubscribe()
            this.$reset()
        },
    },
})
