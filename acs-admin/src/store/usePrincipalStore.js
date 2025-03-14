/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {UUIDs} from "@amrc-factoryplus/service-client";
import {serviceClientReady} from "@store/useServiceClientReady.js";

export const usePrincipalStore = defineStore('principal', {
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
    async fetchPrincipal(uuid) {
      const principal = {
        uuid
      }

      // Get the kerberos principal
      try {
        const principalKerberosObjectResponse = await useServiceClientStore().client.Auth.fetch(`v2/principal/${uuid}`)
        const principalKerberosObject = principalKerberosObjectResponse[1]
        principal.kerberos = principalKerberosObject.kerberos
      } catch(err) {
        console.error(`Can't read principal details`, err)
        principal.kerberos = "UNKNOWN"
      }

      // Fill in the principal names
      try {
        const principalObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, uuid);
        principal.name = principalObjectResponse?.name ?? "UNKNOWN"
      } catch(err) {
        console.error(`Can't read principal details`, err)
        principal.name = "UNKNOWN"
      }

      // Fill in the principal classes
      try {
        let principalObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, uuid);
        if (!principalObjectResponse) {
          console.error(`Can't read principal class details for:`, uuid)
          principal.class = {
            name: "UNKNOWN"
          }
        }
        let classUUID = principalObjectResponse.class
        try {
          let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
          let className = classObjectResponse.name
          principal.class = {
            uuid: classUUID,
            name: className
          }
        } catch (err) {
          console.error(`Can't read principal class details for:`, uuid, err)
          principal.class = {
            name: "UNKNOWN"
          }
        }
      } catch(err) {
        console.error(`Can't read principal class details for:`, uuid, err)
        principal.class = {
          name: "UNKNOWN"
        }
      }

      return principal
    },
    async getPrincipal(uuid) {
      await this.storeReady()

      const existingPrincipal = this.data.find(item => item.uuid === uuid) ?? null
      if (existingPrincipal) return existingPrincipal

      useServiceClientStore().client.Fetch.cache = 'reload'
      await this.fetch()
      useServiceClientStore().client.Fetch.cache = 'reload'

      // Give it another try
      const existingPrincipal2 = this.data.find(item => item.uuid === uuid) ?? null
      if (existingPrincipal2) return existingPrincipal2
    },
    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      try {
        const principalResponse = await useServiceClientStore().client.Auth.fetch('v2/principal')

        if (!Array.isArray(principalResponse[1])) {
          this.loading = false
          return
        }

        this.data = await Promise.all(principalResponse[1].map(async (p) => this.fetchPrincipal(p)))

        this.loading = false
      } catch(err) {
        console.error(`Can't read principals`, err)
      }
    },
  },
})
