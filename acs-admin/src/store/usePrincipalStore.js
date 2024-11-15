/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'

export const usePrincipalStore = defineStore('principal', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {

    fetch () {
      this.loading = true
      useServiceClientStore().client.Auth.fetch('authz/principal').then((returnObject) => {

        this.data    = returnObject[1].map((p) => {
          return {
            uuid: p.uuid,
            kerberos: p.kerberos,
          }
        })
        this.loading = false

      }).catch((err) => {
        console.error(`Can't read principals`, err)
      })
    },
  },
})
