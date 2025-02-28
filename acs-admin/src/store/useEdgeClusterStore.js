/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { storeReady } from '@store/useStoreReady.js'

export const useEdgeClusterStore = defineStore('edge-cluster', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {

    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await storeReady();

      useServiceClientStore().client.ConfigDB.fetch(`/v1/app/${UUIDs.App.EdgeClusterConfiguration}/object`).then(async (edgeClusterResponse) => {

        const payload = edgeClusterResponse[1];

        // We expect an array here, so if it isn't, we can't continue
        if (!Array.isArray(payload)) {
          this.loading = false
          return
        }

        // Hydrate the edge cluster details from the UUIDs provided from the response
        this.data = await Promise.all(payload.map(async (edgeClusterUUID) => {
          try {
            let edgeClusterObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, edgeClusterUUID);
            return {
              uuid: edgeClusterUUID,
              name: edgeClusterObjectResponse.name
            }
          }
          catch (err) {
            console.error(`Can't read edge cluster details`, err)
            return {
              uuid: edgeClusterUUID,
              name: "Unknown"
            }
          }
        }))

        this.loading = false
      }).catch((err) => {
        console.error(`Can't fetch edge clusters`, err)
      })
    },
  },
})
