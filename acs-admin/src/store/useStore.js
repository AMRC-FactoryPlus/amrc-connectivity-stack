/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import * as rx from 'rxjs'

import * as rxu from '@amrc-factoryplus/rx-util'

import { useObjectStore } from '@store/useObjectStore.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'

const stores = new Map()

export const useStore = (name, classUUID, appBindings = {}) => {
  if (stores.has(name)) {
    return stores.get(name)
  }

  const store = defineStore(name, {
    state: () => ({
      data: [],
      loading: true,
      rxsub: null,
    }),
    actions: {
      async start() {
        this.loading = true
        await useObjectStore().start()
        await serviceClientReady()

        const cdb = useServiceClientStore().client.ConfigDB
        const objectsObservable = useObjectStore().maps

        const uuidsObservable = cdb.watch_members(classUUID)

        // Create observables for each app binding
        const appObservables = Object.entries(appBindings).reduce((acc, [key, appUUID]) => {
          acc[key] = cdb.search_app(appUUID)
          return acc
        }, {})

        const details = rxu.rx(
          rx.combineLatest({
            objects: objectsObservable,
            uuids: uuidsObservable,
            ...appObservables,
          }),

          rx.map((v) => v.uuids.map(uuid => {
            const baseObj = v.objects.get(uuid, {
              name: 'UNKNOWN',
              class: { name: 'UNKNOWN' },
            })

            // Merge in any bound app data
            const boundData = Object.entries(appBindings).reduce((acc, [key]) => {
              acc[key] = v[key].get(baseObj.uuid)
              return acc
            }, {})

            return {
              ...baseObj,
              ...boundData,
            }
          }).toArray())
        )

        this.rxsub = details.subscribe(cs => {
          console.log(`${name.toUpperCase()} UPDATE: %o`, cs)
          this.data = cs
          this.loading = false
        })
      },
      stop() {
        this.rxsub?.unsubscribe()
        this.rxsub = null
      },

      async storeReady() {
        await serviceClientReady()
        while (this.loading) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      },
    },
  })

  stores.set(name, store)
  return store
}