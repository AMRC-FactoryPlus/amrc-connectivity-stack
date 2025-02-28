/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { storeReady } from '@store/useStoreReady.js'

export const useNodeStore = defineStore('node', {
  state: () => ({
    data: {},
    loading: false,
    loaded: false,
  }),
  actions: {

    // A convenience method to refresh the data
    async refresh () {
      await this.fetch(true)
    },

    async fetch (fresh = false) {

      // If we have already loaded the data, don't fetch it again unless
      // the fresh flag is set to true
      if (this.loaded && !fresh) {
        return
      }

      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await storeReady()

      useServiceClientStore().client.ConfigDB.fetch(`/v1/class/${UUIDs.Class.EdgeAgent}`).then(async (edgeAgentUUIDS) => {

        const payload = edgeAgentUUIDS[1]

        // We expect an array here, so if it isn't, we can't continue
        if (!Array.isArray(payload)) {
          this.loading = false
          return
        }

        // Hydrate the node details from the UUIDs provided from the response
        this.data = await Promise.all(payload.map(async (edgeAgentUUID) => {
          try {
            let edgeDeployment = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.EdgeAgentDeployment, edgeAgentUUID)
            return {
              ...edgeDeployment,
              uuid: edgeAgentUUID,
            }
          }
          catch (err) {
            console.error(`Can't read node details`, err)
            return {
              uuid: edgeAgentUUID,
              name: 'Unknown',
            }
          }
        }))

        this.loaded = true
        this.loading = false
      }).catch((err) => {
        console.error(`Can't fetch nodes`, err)
      })
    },
  },
})
