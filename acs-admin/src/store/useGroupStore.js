/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import * as imm from 'immutable'
import { defineStore } from 'pinia'
import * as rx from 'rxjs'

import { UUIDs } from '@amrc-factoryplus/service-client'
import * as rxu from '@amrc-factoryplus/rx-util'

import { useObjectStore } from '@store/useObjectStore.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'

// We track all classes which are members of one of these metaclasses.
const GROUPS = [
  `f1fabdd1-de90-4399-b3da-ccf6c2b2c08b`,     // Role
  `1c567e3c-5519-4418-8682-6086f22fbc13`,     // Composite permission
  `b7f0c2f4-ccf5-11ef-be77-777cd4e8cb41`,     // Service permission set
];

export const useGroupStore = defineStore('group', {
  state: () => ({
    data: [],
    loading: true,
    rxsub: null,
  }),
  actions: {
    async start () {
      this.loading = true;

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      const cdb = useServiceClientStore().client.ConfigDB;
      const objs = useObjectStore().maps;

      // This gives an Observable of Maps from group UUID to Set.
      const groups = rxu.rx(
        GROUPS,
        rx.map(g => cdb.watch_members(g)),
        rx.combineLatestAll(),
        rx.map(imm.Set.union),
        cdb.expand_members(),
      );

      const details = rxu.rx(
        rx.combineLatest(objs, groups),
        rx.map(([objs, groups]) => 
          groups.entrySeq()
            .map(([uuid, members]) => ({
              ...objs.get(uuid, {}),
              uuid,
              members:  members.toJS(),
            }))
            .toArray()),
      );

      this.rxsub = details.subscribe(grps => {
        console.log("GROUPS UPDATE: %o", grps);
        this.data = grps;
        this.loading = false;
      });
    },
    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },

    async getGroup (uuid) {
      const grps = rx.firstValueFrom(this.groups);

    },

    /* This is called in lots of places but now does nothing */
    fetch () {},

    async storeReady () {
      await serviceClientReady()

      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },

    /* XXX This could be done better with rx.firstValueFrom */
    async getGroup(uuid) {
      /* This will now not return until we've got an update */
      await this.storeReady()

      return this.data.find(item => item.uuid === uuid);
    },

//    /* Only meant to be internal */
//    async fetchGroup(uuid) {
//      let groupDetails = {
//        uuid,
//      }
//
//      // Let's get the name of the group
//      try {
//        let groupObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, uuid)
//        groupDetails.name = groupObjectResponse.name
//      } catch (err) {
//        console.error(`Can't read group details`, err)
//      }
//
//      // Let's get the class of the group
//      try {
//        let groupRegistrationResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, uuid);
//        let classUUID = groupRegistrationResponse.class
//        try {
//          let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
//          let className = classObjectResponse.name
//          groupDetails.class = {
//            uuid: classUUID,
//            name: className
//          }
//        } catch (err) {
//          console.error(`Can't read group class details`, err)
//          groupDetails.class = {
//            uuid: classUUID
//          }
//        }
//      } catch(err) {
//        console.error(`Can't read group class details`, err)
//      }
//
//      // Let's get the list of group members
//      try {
//        groupDetails.members = await this.fetchMembers(groupDetails)
//      } catch(err) {
//        console.error(`Can't read group members`, err)
//      }
//
//      return groupDetails
//    },
//    async fetchMembers (group) {
//      // Wait until the store is ready before attempting to fetch data
//      await serviceClientReady();
//
//      // Let's get the list of group members
//      try {
//        return await useServiceClientStore().client.ConfigDB.class_members(group.uuid)
//      } catch(err) {
//        console.error(`Can't read group members`, err)
//      }
//    },
//    async fetch () {
//      this.loading = true
//
//      // Wait until the store is ready before attempting to fetch data
//      await serviceClientReady();
//
//      this.data = []
//      try {
//        const roles = await useServiceClientStore().client.ConfigDB.class_members(`f1fabdd1-de90-4399-b3da-ccf6c2b2c08b`)
//        // Check if the return object is an array and if not, return
//        if (!Array.isArray(roles)) {
//          this.loading = false
//          return
//        }
//        const compositePermissions = await useServiceClientStore().client.ConfigDB.class_members(`1c567e3c-5519-4418-8682-6086f22fbc13`)
//        // Check if the return object is an array and if not, return
//        if (!Array.isArray(compositePermissions)) {
//          this.loading = false
//          return
//        }
//        const servicePermissionSet = await useServiceClientStore().client.ConfigDB.class_members(`b7f0c2f4-ccf5-11ef-be77-777cd4e8cb41`)
//        // Check if the return object is an array and if not, return
//        if (!Array.isArray(servicePermissionSet)) {
//          this.loading = false
//          return
//        }
//        const allGroups = roles.concat(compositePermissions).concat(servicePermissionSet)
//
//        // Make a fetch call for each group to get details, and then one
//        // to get all members of the group
//        for (const uuid of allGroups) {
//          const groupDetails = await this.fetchGroup(uuid)
//          this.data.push(groupDetails)
//        }
//
//        this.loading = false
//
//      } catch (err){
//        console.error(`Can't read groups`, err)
//      }
//    },
  },
})
