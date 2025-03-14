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

        // Get the kerberos principal
        let principalsWithKerberos = await Promise.all(principalResponse[1].map(async (p) => {
          try {
            const principalKerberosObjectResponse = await useServiceClientStore().client.Auth.fetch(`v2/principal/${p}`)
            const principalKerberosObject = principalKerberosObjectResponse[1]
            return {
              uuid: p,
              kerberos: principalKerberosObject.kerberos,
            }
          } catch(err) {
            console.error(`Can't read principal details`, err)
            return {
              uuid: p,
              kerberos: "UNKNOWN",
            }
          }
        }))

        // Fill in the principal names
        let principalsWithNames = await Promise.all(principalsWithKerberos.map(async (p) => {
          try {
            const principalObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, p.uuid);
            return {
              ...p,
              name: principalObjectResponse?.name ?? "UNKNOWN"
            }
          } catch(err) {
            console.error(`Can't read principal details`, err)
            return {
              ...p,
              name: "UNKNOWN"
            }
          }
        }))

        // Fill in the principal classes
        this.data = await Promise.all(principalsWithNames.map(async (existingPrincipal) => {
          try {
            let principalObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, existingPrincipal.uuid);
            if (!principalObjectResponse) {
              console.error(`Can't read principal class details for:`, existingPrincipal.uuid)
              return {
                ...existingPrincipal,
                class: {
                  name: "UNKNOWN"
                }
              }
            }
            let classUUID = principalObjectResponse.class
            try {
              let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
              let className = classObjectResponse.name
              return {
                ...existingPrincipal,
                class: {
                  uuid: classUUID,
                  name: className
                }
              }
            } catch (err) {
              console.error(`Can't read principal class details for:`, existingPrincipal.uuid, err)
              return {
                ...existingPrincipal,
                class: {
                  name: "UNKNOWN"
                }
              }
            }
          } catch(err) {
            console.error(`Can't read principal class details for:`, existingPrincipal.uuid, err)
            return {
              ...existingPrincipal,
              class: {
                name: "UNKNOWN"
              }
            }
          }
        }))

        this.loading = false
      } catch(err) {
        console.error(`Can't read principals`, err)
      }
    },
  },
})
