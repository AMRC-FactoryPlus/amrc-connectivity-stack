/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { storeReady } from '@store/useStoreReady.js'

export const useHelmChartTemplateStore = defineStore('helm-chart-template', {
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

    async fetch (fresh = false, includePrivate = false) {

      // If we have already loaded the data, don't fetch it again unless
      // the fresh flag is set to true
      if (this.loaded && !fresh) {
        return
      }

      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await storeReady(useServiceClientStore())

      useServiceClientStore().client.ConfigDB.fetch(`/v1/app/${UUIDs.App.HelmChartTemplate}/object`).then(async (helmChartTemplateResponse) => {

        let payload = helmChartTemplateResponse[1]

        if (!includePrivate) {
          // Filter out private Helm chart templates
          payload = payload.filter((helmChartTemplate) => {
            return !['7bee50ba-7cdf-4203-8d6b-74740fe87ec3', 'f077417f-60d5-455e-be90-ef2827ce5b16'].includes(helmChartTemplate)
          })
        }

        // We expect an array here, so if it isn't, we can't continue
        if (!Array.isArray(payload)) {
          this.loading = false
          return
        }

        // Hydrate the edge cluster details from the UUIDs provided from the response
        this.data = await Promise.all(payload.map(async (helmChartTemplateUUID) => {
          try {

            return {
              uuid: helmChartTemplateUUID,
              name: (await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, helmChartTemplateUUID)).name,
            }
          }
          catch (err) {
            console.error(`Can't read Helm chart template details`, err)
            return {
              uuid: helmChartTemplateUUID,
              name: 'Unknown',
            }
          }
        }))

        this.loaded  = true
        this.ready   = true
        this.loading = false
      }).catch((err) => {
        this.loading = false
        console.error(`Can't fetch Helm chart template list`, err)
      })
    },
  },
})
