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

export const usePermissionStore = defineStore('permission', {
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

      // This gives an Observable of Sets
      const Perm = UUIDs.Class.Permission;
      const perms = rxu.rx(
        rx.combineLatest(
          cdb.watch_members(Perm),
          cdb.watch_subclasses(Perm)),
        rx.map(imm.Set.union),
        rx.map(ps => ps.filter(p => p != Perm)),
      );

      const details = rxu.rx(
        rx.combineLatest(objs, perms),
        rx.map(([objs, perms]) => 
          perms.map(uuid => 
              objs.get(uuid, { name: "UNKNOWN", class: { name: "UNKNOWN" } }))
            .toArray()),
      );

      this.rxsub = details.subscribe(ps => {
        console.log("PERMS UPDATE: %o", ps);
        this.data = ps;
        this.loading = false;
      });
    },
    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },

    async storeReady () {
      await serviceClientReady()

      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },

//    /* Only meant to be internal */
//    async fetchPermission (uuid) {
//      const permission = {
//        uuid
//      }
//      try {
//        let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, uuid);
//        permission.name = permissionObjectResponse.name
//      }
//      catch (err) {
//        console.error(`Can't read permission details`, err)
//      }
//      try {
//        let permissionObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, uuid);
//        if (!permissionObjectResponse) {
//          console.error(`Can't read permission class details for:`, uuid)
//          permission.class = {
//            name: "UNKNOWN"
//          }
//        }
//        let classUUID = permissionObjectResponse.class
//        try {
//          let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
//          let className = classObjectResponse.name
//          permission.class = {
//            uuid: classUUID,
//            name: className
//          }
//        } catch (err) {
//          console.error(`Can't read permission class details for:`, uuid, err)
//          permission.class = {
//            name: "UNKNOWN"
//          }
//        }
//      } catch(err) {
//        console.error(`Can't read permission class details for:`, uuid, err)
//        permission.class = {
//          name: "UNKNOWN"
//        }
//      }
//      return permission
//    },
//    async getPermission (uuid) {
//      await this.storeReady()
//
//      const existingPermission = this.data.find(item => item.uuid === uuid) ?? null
//      if (existingPermission) return existingPermission
//
//      useServiceClientStore().client.Fetch.cache = 'reload'
//      await this.fetch()
//      useServiceClientStore().client.Fetch.cache = 'reload'
//
//      const existingPermission2 = this.data.find(item => item.uuid === uuid) ?? null
//      if (existingPermission2) return existingPermission2
//
//      return {
//        uuid,
//        name: "UNKNOWN"
//      }
//    },
//    async fetch () {
//      this.loading = true
//
//      // Wait until the store is ready before attempting to fetch data
//      await serviceClientReady();
//
//      try {
//        const permissions = await useServiceClientStore().client.ConfigDB.class_members(UUIDs.Class.Permission)
//        // Check if the return object is an array and if not, return
//        if (!Array.isArray(permissions)) {
//          this.loading = false
//          return
//        }
//        const permissionClasses = await useServiceClientStore().client.ConfigDB.class_subclasses(UUIDs.Class.Permission)
//        // Check if the return object is an array and if not, return
//        if (!Array.isArray(permissionClasses)) {
//          this.loading = false
//          return
//        }
//        const servicePermissionSet = await useServiceClientStore().client.ConfigDB.class_members('b7f0c2f4-ccf5-11ef-be77-777cd4e8cb41')
//        // Check if the return object is an array and if not, return
//        if (!Array.isArray(servicePermissionSet)) {
//          this.loading = false
//          return
//        }
//        const allPermissions = permissions.concat(servicePermissionSet).concat(permissionClasses)
//        const uniquePermissions = [...new Set(allPermissions)]
//        const filteredPermissions = uniquePermissions.filter(item => item !== UUIDs.Class.Permission)
//
//        // Fill in the permission names
//        this.data = await Promise.all(filteredPermissions.map(async (permissionUUID) => this.fetchPermission(permissionUUID)))
//
//        this.loading = false
//      } catch (err) {
//        console.error(`Can't read permissions`, err)
//      }
//    },
  },
})
