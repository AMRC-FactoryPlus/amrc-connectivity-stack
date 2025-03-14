/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { serviceClientReady } from '@store/useServiceClientReady.js'

export const usePermissionStore = defineStore('permission', {
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
    async fetchPermission (uuid) {
      const permission = {
        uuid
      }
      try {
        let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, uuid);
        permission.name = permissionObjectResponse.name
      }
      catch (err) {
        console.error(`Can't read permission details`, err)
      }
      try {
        let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, uuid);
        if (!permissionObjectResponse) {
          console.error(`Can't read permission class details for:`, uuid)
          permission.class = {
            name: "UNKNOWN"
          }
        }
        let classUUID = permissionObjectResponse.class
        try {
          let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
          let className = classObjectResponse.name
          permission.class = {
            uuid: classUUID,
            name: className
          }
        } catch (err) {
          console.error(`Can't read permission class details for:`, uuid, err)
          permission.class = {
            name: "UNKNOWN"
          }
        }
      } catch(err) {
        console.error(`Can't read permission class details for:`, uuid, err)
        permission.class = {
          name: "UNKNOWN"
        }
      }
      return permission
    },
    async getPermission (uuid) {
      await this.storeReady()

      const existingPermission = this.data.find(item => item.uuid === uuid) ?? null
      if (existingPermission) return existingPermission

      useServiceClientStore().client.Fetch.cache = 'reload'
      await this.fetch()
      useServiceClientStore().client.Fetch.cache = 'reload'

      const existingPermission2 = this.data.find(item => item.uuid === uuid) ?? null
      if (existingPermission2) return existingPermission2

      return {
        uuid,
        name: "UNKNOWN"
      }
    },
    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      useServiceClientStore().client.ConfigDB.fetch(`/v1/class/${UUIDs.Class.Permission}`).then(async (permissionListResponse) => {

        if (!Array.isArray(permissionListResponse[1])) {
          this.loading = false
          return
        }

        // Fill in the permission names
        this.data = await Promise.all(permissionListResponse[1].map(async (permissionUUID) => this.fetchPermission(permissionUUID)))

        this.loading = false
      }).catch((err) => {
        console.error(`Can't read principals`, err)
      })
    },
  },
})
