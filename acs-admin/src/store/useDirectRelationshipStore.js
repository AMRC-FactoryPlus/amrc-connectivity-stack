/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {defineStore} from 'pinia'
import {useServiceClientStore} from '@/store/serviceClientStore.js'
import {serviceClientReady} from '@store/useServiceClientReady.js'
import {useObjectStore} from "@store/useObjectStore.js";

export const useDirectRelationshipStore = defineStore('directrelationship', {
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
    async fetchDirectRelationships(uuid) {
      const obj = { uuid }

      obj.directMembers = await useServiceClientStore().client.ConfigDB.class_direct_members(uuid)
      obj.directSubclasses = await useServiceClientStore().client.ConfigDB.class_direct_subclasses(uuid)

      return obj
    },
    async fetch () {
      this.loading = true

      console.log("fetch direct relationship")

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady()
      await useObjectStore().readyPromise
      const objs = useObjectStore().data
      const uuids = objs.map((obj) => obj.uuid)

      this.data = []
      try {
        if (!Array.isArray(uuids)) {
          return
        }
        this.data = await Promise.all(uuids.map(async uuid => this.fetchDirectRelationships(uuid)))

        this.loading = false
      } catch (err){
        console.error(`Can't read grants`, err)
      }
    },
  },
})
