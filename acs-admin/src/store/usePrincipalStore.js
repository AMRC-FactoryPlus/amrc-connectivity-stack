/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {UUIDs} from "@amrc-factoryplus/service-client";

export const usePrincipalStore = defineStore('principal', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {
    async fetch () {
      this.loading = true
      try {
        const principalResponse = await useServiceClientStore().client.Auth.fetch('authz/principal')

        if (!Array.isArray(principalResponse[1])) {
          this.loading = false
          return
        }

        // Fill in the principal names
        let principalsWithNames = await Promise.all(principalResponse[1].map(async (p) => {
          try {
            let principalObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, p.uuid);
            return {
              uuid: p.uuid,
              kerberos: p.kerberos,
              name: principalObjectResponse.name
            }
          } catch(err) {
            console.error(`Can't read principal details`, err)
            return {
              uuid: p.uuid,
              kerberos: p.kerberos,
              name: ""
            }
          }
        }))

        // Fill in the principal classes
        this.data = await Promise.all(principalsWithNames.map(async (existingPrincipal) => {
          try {
            let principalObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, existingPrincipal.uuid);
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
              console.error(`Can't read principal class details`, err)
              return {
                ...existingPrincipal,
                class: {}
              }
            }
          } catch(err) {
            console.error(`Can't read principal details`, err)
            return {
              ...existingPrincipal,
              name: "",
              class: {}
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
