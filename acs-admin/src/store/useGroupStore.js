/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'

export const useGroupStore = defineStore('group', {
  state: () => ({
    data: [],
    loading: false,
  }),
  actions: {

    fetch () {
      this.loading = true
      useServiceClientStore().client.Auth.fetch('authz/group').then((returnObject) => {

        // Check if the return object is an array and if not, return
        if (!Array.isArray(returnObject[1])) {
          this.loading = false
          return
        }

        // Make a fetch call for each group to get details, and then one
        // to get all members of the group
        returnObject[1].forEach((uuid) => {

          let groupDetails = {
            uuid: uuid,
          }

          useServiceClientStore().client.ConfigDB.fetch(`/v1/app/64a8bfa9-7772-45c4-9d1a-9e6290690957/object/${uuid}`).then((returnObject) => {
            groupDetails.name = returnObject[1].name
          }).catch((err) => {
            console.error(`Can't read group details`, err)
          })

          useServiceClientStore().client.Auth.fetch(`authz/group/${uuid}`).then((returnObject) => {
            groupDetails.members = returnObject[1]
          }).catch((err) => {
            console.error(`Can't read group members`, err)
          })

          this.data.push(groupDetails)

        })

        this.loading = false

      }).catch((err) => {
        console.error(`Can't read groups`, err)
      })
    },
  },
})
