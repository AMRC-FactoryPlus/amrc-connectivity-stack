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
    loaded: false,
    ready: false,
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
      await storeReady(useServiceClientStore())

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

            let cluster = {
              uuid: edgeClusterUUID,
              name: (await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, edgeClusterUUID)).name,
            }

            // Get the cluster details here and merge them with the cluster
            // object. We need:
            // - Name & Deployed Helm Chart (we get this from bdb13634-0b3d-4e38-a065-9d88c12ee78d Edge cluster configuration)
            // - The hosts that are assigned to this cluster and their details (we get this from 747a62c9-1b66-4a2e-8dd9-0b70a91b6b75 Edge cluster status)
            // - The Nodes in this cluster, their name, status and\ other information (we get this from useNodeStore)

            const edgeClusterConfigResponse = await useServiceClientStore().
              client.
              ConfigDB.
              fetch(`/v1/app/${UUIDs.App.EdgeClusterConfiguration}/object/${cluster.uuid}`)

            const edgeClusterConfig = edgeClusterConfigResponse[1]
            cluster.sparkplug       = edgeClusterConfig.name
            cluster.namespace       = edgeClusterConfig.namespace

            // Get the name of the deployed helm chart from its UUID using the
            // Helm Chart Template App
            const helmChartTemplateAppResponse = await useServiceClientStore().
              client.
              ConfigDB.
              fetch(`/v1/app/${UUIDs.App.HelmChartTemplate}/object/${edgeClusterConfig.chart}`)

            const helmChartTemplate = helmChartTemplateAppResponse[1]

            cluster.helmChart = {
              chart: helmChartTemplate.chart,
              source: helmChartTemplate.source,
            }

            // Get the hosts assigned to this cluster and their details using
            // the Edge cluster status app
            cluster.status = (await useServiceClientStore().client.ConfigDB.fetch(`/v1/app/${UUIDs.App.EdgeClusterStatus}/object/${edgeClusterUUID}`))[1] ?? {
              hosts: [],
              kubeseal_cert: null,
            }
            cluster.setupStatus = (await useServiceClientStore().client.ConfigDB.fetch(`/v1/app/${UUIDs.App.EdgeClusterSetupStatus}/object/${edgeClusterUUID}`))[1]

            return cluster
          }
          catch (err) {
            console.error(`Can't read edge cluster details`, err)
            return {
              uuid: edgeClusterUUID,
              name: "Unknown"
            }
          }
        }))

        this.loaded = true
        this.ready = true
        this.loading = false
      }).catch((err) => {
        this.loading = false
        console.error(`Can't fetch edge clusters`, err)
      })
    },
  },
})
