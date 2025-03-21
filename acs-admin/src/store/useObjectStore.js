/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import * as rx from 'rxjs'
import * as rxu from '@amrc-factoryplus/rx-util'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {UUIDs} from "@amrc-factoryplus/service-client";
import {serviceClientReady} from "@store/useServiceClientReady.js";

export const useObjectStore = defineStore('object', {
  state: () => ({
    data: [],
    loading: true,
    rxsub: null,
  }),
  actions: {
    async storeReady () {
      if (!this.loading)
        return;

      await serviceClientReady();
      const cdb = useServiceClientStore().client.ConfigDB;

      const info = cdb.search_app(UUIDs.App.Info);
      const registration = cdb.search_app(UUIDs.App.Registration);

      /* XXX We never unsubscribe this subscription. */
      this.rxsub = rxu.rx(
        rx.combineLatest(info, registration),
        rx.map(([infos, regs]) => {
          const name_of = u => infos.get(u)?.name ?? "UNKNOWN";
          return regs.entrySeq()
            .map(([uuid, reg]) => ({
              uuid,
              name: name_of(uuid),
              rank: reg.rank,
              class: {
                uuid: reg.class,
                name: name_of(uuid),
              },
            }))
            .toArray();
        }),
      ).subscribe(list => {
        this.loading = false;
        this.data = list;
      });
    },
//    /* Only meant to be internal */
//    async fetchObject(uuid) {
//      const object = {
//        uuid
//      }
//
//      // Fill in the object name
//      try {
//        const objectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, uuid);
//        object.name = objectResponse?.name ?? "UNKNOWN"
//      } catch(err) {
//        console.error(`Can't read principal details`, err)
//        object.name = "UNKNOWN"
//      }
//
//      // Fill in the object class
//      try {
//        let objectClassResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Registration, uuid);
//        if (!objectClassResponse) {
//          console.error(`Can't read principal class details for:`, uuid)
//          object.class = {
//            name: "UNKNOWN"
//          }
//        }
//        let classUUID = objectClassResponse.class
//        try {
//          let classObjectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, classUUID);
//          let className = classObjectResponse.name
//          object.class = {
//            uuid: classUUID,
//            name: className
//          }
//        } catch (err) {
//          console.error(`Can't read principal class details for:`, uuid, err)
//          object.class = {
//            name: "UNKNOWN"
//          }
//        }
//      } catch(err) {
//        console.error(`Can't read principal class details for:`, uuid, err)
//        object.class = {
//          name: "UNKNOWN"
//        }
//      }
//
//      return object
//    },
//    async getObject(uuid) {
//      await this.storeReady()
//
//      const existingObject = this.data.find(item => item.uuid === uuid) ?? null
//      if (existingObject) return existingObject
//
//      useServiceClientStore().client.Fetch.cache = 'reload'
//      await this.fetch()
//      useServiceClientStore().client.Fetch.cache = 'reload'
//
//      // Give it another try
//      const existingObject2 = this.data.find(item => item.uuid === uuid) ?? null
//      if (existingObject2) return existingObject2
//    },
//    async fetch () {
//      this.loading = true
//
//      // Wait until the store is ready before attempting to fetch data
//      await serviceClientReady();
//
//      try {
//        const objectResponse = await useServiceClientStore().client.ConfigDB.fetch('v2/object')
//
//        if (!Array.isArray(objectResponse[1])) {
//          this.loading = false
//          return
//        }
//
//        this.data = await Promise.all(objectResponse[1].map(async (p) => this.fetchObject(p)))
//
//        this.loading = false
//      } catch(err) {
//        console.error(`Can't read principals`, err)
//      }
//    },
  },
})
