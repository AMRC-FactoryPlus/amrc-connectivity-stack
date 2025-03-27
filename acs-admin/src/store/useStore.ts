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
  ready: boolean  // Added ready state
  // Add a map to store additional bindings per UUID
  additionalBindings: Map<string, { bindings: AppBindings, subscription: rx.Subscription }>
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
      ready: false,
      // Add a map to store additional bindings per UUID
      additionalBindings: new Map<string, { bindings: AppBindings, subscription: rx.Subscription }>
    }),
    actions: {
      async start() {
        this.loading = true
        this.ready = false  // Reset ready state when starting
        await useObjectStore().start()
        await serviceClientReady()

        const cdb = useServiceClientStore().client.ConfigDB
        const objectsObservable = useObjectStore().maps
        const uuidsObservable = cdb.watch_members(classUUID)

        // Create observables for each app binding
        const createAppObservables = (bindings: AppBindings): Record<string, rx.Observable<ImmutableMap<string, any>>> => {
          return Object.entries(bindings).reduce((acc, [key, value]) => {
            if (typeof value === 'object') {
              acc[key] = cdb.search_app(value.app)
              if (value.appBindings) {
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
                  const baseData = v[key]?.get(baseObj.uuid) || {}
                  
                  if (value.appBindings) {
                    const resolvedData = { ...baseData }
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
          this.ready = true  // Set ready state when data is loaded
        })
      },
      async loadAdditionalBindings(uuid: string, extraBindings: AppBindings) {
        this.loading = true;
        
        const cdb = useServiceClientStore().client.ConfigDB;
        const baseObj = this.data.find(obj => obj.uuid === uuid);
        
        if (!baseObj) {
          this.loading = false;
          return;
        }

        // Helper to validate UUID format
        const isUUID = (str: any): boolean => {
          if (typeof str !== 'string') return false;
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        };

        // Create observables for the additional bindings
        const appObservables = Object.entries(extraBindings).reduce((acc, [path, value]) => {
          if (typeof value !== 'string') return acc;

          const refUuid = getNestedValue(baseObj, path);
          // Only proceed if we have a valid UUID
          if (refUuid && isUUID(refUuid)) {
            acc[path] = cdb.search_app(value);
          }
          return acc;
        }, {} as Record<string, rx.Observable<ImmutableMap<string, any>>>);

        // If no valid bindings were found, return early
        if (Object.keys(appObservables).length === 0) {
          this.loading = false;
          return;
        }

        const details = rx.combineLatest(appObservables);

        const subscription = details.subscribe(values => {
          const boundData = Object.entries(extraBindings).reduce((acc, [path, value]) => {
            if (typeof value !== 'string') return acc;

            const refUuid = getNestedValue(baseObj, path);
            if (refUuid && isUUID(refUuid)) {
              const resolvedValue = values[path]?.get(refUuid) || null;
              const parts = path.split('.');
              const key = parts.pop()!;
              const parentPath = parts.join('.');
              
              if (parentPath) {
                setNestedValue(acc, parentPath, {
                  ...getNestedValue(baseObj, parentPath),
                  [key]: resolvedValue
                });
              } else {
                acc[key] = resolvedValue;
              }
            }
            return acc;
          }, {} as Record<string, any>);

          const index = this.data.findIndex(obj => obj.uuid === uuid);
          if (index !== -1) {
            this.data[index] = {
              ...this.data[index],
              ...boundData
            };
          }

          this.loading = false;
        });

        this.additionalBindings.set(uuid, {
          bindings: extraBindings,
          subscription
        });
      },

      async clearAdditionalBindings(uuid: string) {
        const binding = this.additionalBindings.get(uuid);
        if (binding) {
          binding.subscription?.unsubscribe();
          this.additionalBindings.delete(uuid);
          
          // Reset the object to its original state
          const index = this.data.findIndex(obj => obj.uuid === uuid);
          if (index !== -1) {
            const keys = Object.keys(binding.bindings);
            const cleanedObj = { ...this.data[index] };
            keys.forEach(key => delete cleanedObj[key]);
            this.data[index] = cleanedObj;
          }
        }
      },

      stop() {
        this.rxsub?.unsubscribe();
        this.rxsub = null;
        // Clean up additional bindings
        for (const [uuid, binding] of this.additionalBindings) {
          binding.subscription?.unsubscribe();
        }
        this.additionalBindings.clear();
        this.ready = false;
      },

      async storeReady() {
        await serviceClientReady()
        while (!this.ready || this.loading) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      },
    },
  })

  stores.set(name, store)
  return store
}