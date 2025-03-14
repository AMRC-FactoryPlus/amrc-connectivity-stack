/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { serviceClientReady } from '@store/useServiceClientReady.js'

export const useGroupStore = defineStore('group', {
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
    async fetchGroup(uuid) {
      let groupDetails = {
        uuid,
      }

      // Let's get the name of the group
      try {
        let groupObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, uuid)
        groupDetails.name = groupObjectResponse.name
      } catch (err) {
        console.error(`Can't read group details`, err)
      }

      // Let's get the class of the group
      try {
        let groupRegistrationResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, uuid);
        let classUUID = groupRegistrationResponse.class
        try {
          let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
          let className = classObjectResponse.name
          groupDetails.class = {
            uuid: classUUID,
            name: className
          }
        } catch (err) {
          console.error(`Can't read group class details`, err)
          groupDetails.class = {
            uuid: classUUID
          }
        }
      } catch(err) {
        console.error(`Can't read group class details`, err)
      }

      // Let's get the list of group members
      try {
        groupDetails.members = await this.fetchMembers(groupDetails)
      } catch(err) {
        console.error(`Can't read group members`, err)
      }

      return groupDetails
    },
    async fetchMembers (group) {
      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      // Let's get the list of group members
      try {
        const groupMembersResponse = await useServiceClientStore().client.ConfigDB.fetch(`v2/class/${group.uuid}/member`)
        return groupMembersResponse[1]
      } catch(err) {
        console.error(`Can't read group members`, err)
      }
    },
    async getGroup(uuid) {
      await this.storeReady()

      const existingGroup = this.data.find(item => item.uuid === uuid) ?? null
      if (existingGroup) return existingGroup

      useServiceClientStore().client.Fetch.cache = 'reload'
      await this.fetch()
      useServiceClientStore().client.Fetch.cache = 'reload'

      // Give it another try
      const existingGroup2 = this.data.find(item => item.uuid === uuid) ?? null
      if (existingGroup2) return existingGroup2
    },
    async fetch () {
      this.loading = true

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      this.data = []
      try {
        const roleResponse = await useServiceClientStore().client.ConfigDB.fetch(`v2/class/f1fabdd1-de90-4399-b3da-ccf6c2b2c08b/member`)
        const roles = roleResponse[1]
        // Check if the return object is an array and if not, return
        if (!Array.isArray(roles)) {
          this.loading = false
          return
        }
        const compositePermissionResponse = await useServiceClientStore().client.ConfigDB.fetch(`v2/class/1c567e3c-5519-4418-8682-6086f22fbc13/member`)
        const compositePermissions = compositePermissionResponse[1]
        // Check if the return object is an array and if not, return
        if (!Array.isArray(compositePermissions)) {
          this.loading = false
          return
        }
        const servicePermissionSetResponse = await useServiceClientStore().client.ConfigDB.fetch(`v2/class/b7f0c2f4-ccf5-11ef-be77-777cd4e8cb41/member`)
        const servicePermissionSet = servicePermissionSetResponse[1]
        // Check if the return object is an array and if not, return
        if (!Array.isArray(servicePermissionSet)) {
          this.loading = false
          return
        }
        const allGroups = roles.concat(compositePermissions).concat(servicePermissionSet)

        // Make a fetch call for each group to get details, and then one
        // to get all members of the group
        for (const uuid of allGroups) {
          const groupDetails = await this.fetchGroup(uuid)
          this.data.push(groupDetails)
        }

        this.loading = false

      } catch (err){
        console.error(`Can't read groups`, err)
      }
    },
  },
})
