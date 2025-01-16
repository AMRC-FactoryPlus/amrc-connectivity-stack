/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {

    fetch () {
      this.loading = true
      useServiceClientStore().client.ConfigDB.fetch(`/v1/class/${UUIDs.Class.Permission}`).then(async (permissionListResponse) => {

        if (!Array.isArray(permissionListResponse[1])) {
          this.loading = false
          return
        }

        // Fill in the permission names
        let testData = await Promise.all(permissionListResponse[1].map(async (permissionsUUID) => {
          try {
            let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, permissionsUUID);
            return {
              uuid: permissionsUUID,
              name: permissionObjectResponse.name
            }
          } catch(err) {
            console.error(`Can't read permission details`, err)
            return {
              uuid: permissionsUUID,
              name: ""
            }
          }
        }))

        this.data = testData
        this.loading = false
      }).catch((err) => {
        console.error(`Can't read principals`, err)
      })
    },
  },
})
