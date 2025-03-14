/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'

export const useGrantStore = defineStore('grant', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {
    async storeReady () {
      await serviceClientReady()

      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },
    /* Only meant to be internal */
    async fetchGrant(uuid) {
      const grantResponse = await useServiceClientStore().client.Auth.fetch(`v2/grant/${uuid}`)
      return grantResponse[1];
    },
    async getGrant(uuid) {
      await this.storeReady()

      const existingGrant = this.data.find(item => item.uuid === uuid) ?? null
      if (existingGrant) return existingGrant

      useServiceClientStore().client.Fetch.cache = 'reload'
      await this.fetch()
      useServiceClientStore().client.Fetch.cache = 'reload'

      // Give it another try
      const existingGrant2 = this.data.find(item => item.uuid === uuid) ?? null
      if (existingGrant2) return existingGrant2
    },
    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      this.data = []
      try {
        const grantUUIDsResponse = await useServiceClientStore().client.Auth.fetch(`v2/grant`)
        if (!Array.isArray(grantUUIDsResponse[1])) {
          return
        }
        const grantUUIDs = grantUUIDsResponse[1]
        this.data = await Promise.all(grantUUIDs.map(async uuid => this.fetchGrant(uuid)))

        this.loading = false
      } catch (err){
        console.error(`Can't read grants`, err)
      }
    },
  },
})
