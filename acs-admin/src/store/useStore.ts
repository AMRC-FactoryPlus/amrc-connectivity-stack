/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import * as rx from 'rxjs'
import * as rxu from '@amrc-factoryplus/rx-util'
import { Map as ImmutableMap } from 'immutable'

import { useObjectStore } from '@store/useObjectStore.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'

interface BaseObject {
  uuid: string
  name: string
  class: {
    name: string
  }
}

type NestedPath = string // represents dot-notation paths like 'topology.cluster'

interface AppBinding {
  app: string
  appBindings?: Record<NestedPath, string>
}

type AppBindings = Record<string, string | AppBinding>

interface StoreData extends BaseObject {
  [key: string]: any // for dynamic bound data
}

interface StoreState {
  data: StoreData[]
  loading: boolean
  rxsub: rx.Subscription | null
}

interface ObservableMap {
  get(key: string, defaultValue?: any): any
}

interface CombinedObservables {
  objects: ObservableMap
  uuids: string[]
  [key: string]: ObservableMap | string[]
}

const stores = new Map<string, ReturnType<typeof defineStore>>()

// Helper to get nested object value using dot notation
const getNestedValue = (obj: Record<string, any>, path: string): any => {
  return path.split('.').reduce((acc, part) => acc?.[part], obj)
}

// Helper to set nested object value using dot notation
const setNestedValue = (obj: Record<string, any>, path: string, value: any): Record<string, any> => {
  const parts = path.split('.')
  const lastPart = parts.pop()!
  const target = parts.reduce((acc, part) => {
    acc[part] = acc[part] || {}
    return acc[part]
  }, obj)
  target[lastPart] = value
  return obj
}

export const useStore = (name: string, classUUID: string, appBindings: AppBindings = {}) => {
  if (stores.has(name)) {
    return stores.get(name)!
  }

  const store = defineStore(name, {
    state: (): StoreState => ({
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
        const createAppObservables = (bindings: AppBindings): Record<string, rx.Observable<ImmutableMap<string, any>>> => {
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
          }, {} as Record<string, rx.Observable<ImmutableMap<string, any>>>)
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

            const resolveBindings = (bindings: AppBindings): Record<string, any> => {
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
              }, {} as Record<string, any>)
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