/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { UUIDs } from "@amrc-factoryplus/service-client";

export const useGroupStore = defineStore('group', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {
    async getMembers (group) {
      // Let's get the list of group members
      try {
        let groupMembersResponse = await useServiceClientStore().client.Auth.fetch(`authz/group/${group.uuid}`)
        return groupMembersResponse[1]
      } catch(err) {
        console.error(`Can't read group members`, err)
      }
    },

    fetch () {
      this.loading = true
      this.data = []
      useServiceClientStore().client.Auth.fetch('authz/group').then(async (groupListResponse) => {

        // Check if the return object is an array and if not, return
        if (!Array.isArray(groupListResponse[1])) {
          this.loading = false
          return
        }

        // Make a fetch call for each group to get details, and then one
        // to get all members of the group
        for (const uuid of groupListResponse[1]) {
          let groupDetails = {
            uuid: uuid,
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
            groupDetails.members = await this.getMembers(groupDetails)
          } catch(err) {
            console.error(`Can't read group members`, err)
          }

          this.data.push(groupDetails)
        }

        this.loading = false

      }).catch((err) => {
        console.error(`Can't read groups`, err)
      })
    },
  },
})
