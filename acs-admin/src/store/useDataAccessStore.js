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
        loading: true,
        ready: false,
        rxsub: null,
        structureSub: null,
    }),

    actions: {
        async start () {
            this.loading = true
            this.ready = false
            await serviceClientReady()

            const da = useServiceClientStore().client.DataAccess

            this.rxsub = da.search_metadata().subscribe({
                next: map => {
                    this.datasets = map ? map.valueSeq().toArray() : []
                    this.loading = false
                    this.ready = true
                    console.log(map?.toJS())
                    console.log(this.datasets)
                },
                error: err => {
                    console.error('DataAccess metadata subscription error:', err)
                    this.loading = false
                    this.ready = true
                },
            })

            this.structureSub = da.search_structure().subscribe({
                next: map => {
                    this.structures = map ? map.valueSeq().toArray() : []
                },
                error: err => {
                    console.error('DataAccess structure subscription error:', err)
                },
            })
        },

        stop () {
            this.rxsub?.unsubscribe()
            this.structureSub?.unsubscribe()
            this.$reset()
        },
    },
})
