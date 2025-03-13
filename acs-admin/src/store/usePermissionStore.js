/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { storeReady } from '@store/useStoreReady.js'

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {

    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await storeReady();

      useServiceClientStore().client.ConfigDB.fetch(`/v1/class/${UUIDs.Class.Permission}`).then(async (permissionListResponse) => {

        if (!Array.isArray(permissionListResponse[1])) {
          this.loading = false
          return
        }

        // Fill in the permission names
        const permissionsWithNames = await Promise.all(permissionListResponse[1].map(async (permissionsUUID) => {
          try {
            let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, permissionsUUID);
            return {
              uuid: permissionsUUID,
              name: permissionObjectResponse.name
            }
          }
          catch (err) {
            console.error(`Can't read permission details`, err)
            return {
              uuid: permissionsUUID,
              name: ""
            }
          }
        }))

        // Fill in the permission classes
        this.data = await Promise.all(permissionsWithNames.map(async (existingPermission) => {
          try {
            let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, existingPermission.uuid);
            if (!permissionObjectResponse) {
              console.error(`Can't read permission class details for:`, existingPermission.uuid)
              return {
                ...existingPermission,
                class: {
                  name: "UNKNOWN"
                }
              }
            }
            let classUUID = permissionObjectResponse.class
            try {
              let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
              let className = classObjectResponse.name
              return {
                ...existingPermission,
                class: {
                  uuid: classUUID,
                  name: className
                }
              }
            } catch (err) {
              console.error(`Can't read permission class details for:`, existingPermission.uuid, err)
              return {
                ...existingPermission,
                class: {
                  name: "UNKNOWN"
                }
              }
            }
          } catch(err) {
            console.error(`Can't read permission class details for:`, existingPermission.uuid, err)
            return {
              ...existingPermission,
              class: {
                name: "UNKNOWN"
              }
            }
          }
        }))

        this.loading = false
      }).catch((err) => {
        console.error(`Can't read principals`, err)
      })
    },
  },
})
