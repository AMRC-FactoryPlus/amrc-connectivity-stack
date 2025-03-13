/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { storeReady } from '@store/useStoreReady.js'

export const useGrantStore = defineStore('grant', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {
    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await storeReady();

      this.data = []
      try {
        const grantUUIDsResponse = await useServiceClientStore().client.Auth.fetch(`v2/grant`)
        if (!Array.isArray(grantUUIDsResponse[1])) {
          return
        }
        const grantUUIDs = grantUUIDsResponse[1]
        this.data = await Promise.all(
            grantUUIDs.map(async uuid => {
              const grantResponse = await useServiceClientStore().client.Auth.fetch(`v2/grant/${uuid}`)
              return grantResponse[1];
            })
        )

        this.loading = false
      } catch (err){
        console.error(`Can't read groups`, err)
      }
    },
  },
})
