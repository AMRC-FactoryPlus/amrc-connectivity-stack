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

// Helper to get nested object value using dot notation
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((acc, part) => acc?.[part], obj)
}

// Helper to set nested object value using dot notation
const setNestedValue = (obj, path, value) => {
  const parts = path.split('.')
  const lastPart = parts.pop()
  const target = parts.reduce((acc, part) => {
    acc[part] = acc[part] || {}
    return acc[part]
  }, obj)
  target[lastPart] = value
  return obj
}

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
        const createAppObservables = (bindings) => {
          return Object.entries(bindings).reduce((acc, [key, value]) => {
            if (typeof value === 'object') {
              // Handle nested binding
              acc[key] = cdb.search_app(value.app)
              if (value.appBindings) {
                // For each nested binding, create an observable to resolve the referenced UUID
                Object.entries(value.appBindings).forEach(([nestedKey, nestedApp]) => {
                  acc[`${key}.${nestedKey}`] = cdb.search_app(nestedApp)
                })
              }
            } else {
              acc[key] = cdb.search_app(value)
            }
            return acc
          }, {})
        }

        const appObservables = createAppObservables(appBindings)

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

            const resolveBindings = (bindings) => {
              return Object.entries(bindings).reduce((acc, [key, value]) => {
                if (typeof value === 'object') {
                  // Get the base configuration data
                  const baseData = v[key]?.get(baseObj.uuid) || {}
                  
                  if (value.appBindings) {
                    const resolvedData = { ...baseData }
                    // For each nested binding, resolve the referenced UUID
                    Object.entries(value.appBindings).forEach(([nestedKey, nestedApp]) => {
                      const refUuid = getNestedValue(baseData, nestedKey)
                      if (refUuid) {
                        const resolvedValue = v[`${key}.${nestedKey}`]?.get(refUuid) || null
                        setNestedValue(resolvedData, nestedKey, resolvedValue)
                      }
                    })
                    acc[key] = resolvedData
                  } else {
                    acc[key] = baseData
                  }
                } else {
                  acc[key] = v[key]?.get(baseObj.uuid) || null
                }
                return acc
              }, {})
            }

            const boundData = resolveBindings(appBindings)

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