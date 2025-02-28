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
  }),
  actions: {

    async fetch () {
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

        <!-- Rebase on v4-dev amrcimg.slack.com/archives/D022ZMQETA8/p1739970136775339 -->

        // Hydrate the node details from the UUIDs provided from the response
        this.data = await Promise.all(payload.map(async (edgeAgentUUID) => {
          try {
            let edgeAgentObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, edgeAgentUUID)
            return {
              uuid: edgeAgentUUID,
              name: edgeAgentObjectResponse.name,
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

        this.loading = false
      }).catch((err) => {
        console.error(`Can't fetch nodes`, err)
      })
    },
  },
})
