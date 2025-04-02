/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import * as imm from "immutable";
import {defineStore} from 'pinia'
import * as rx from "rxjs";

import * as rxu from "@amrc-factoryplus/rx-util";

import {useServiceClientStore} from '@/store/serviceClientStore.js'
import {serviceClientReady} from '@store/useServiceClientReady.js'
import {useObjectStore} from "@store/useObjectStore.js";

export const useDirectStore = defineStore('direct', {
  state: () => ({
    data: [],
    loading: false,
    rxsub: null,
  }),
  actions: {
    async storeReady () {
      await serviceClientReady()

      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },
    async start () {
      this.loading = true;

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      const cdb = useServiceClientStore().client.ConfigDB;
      const objs = useObjectStore().maps;

      console.log(cdb)

      // Find all classes
      const classes = rxu.rx(objs,
        rx.map(objList => 
          objList.filter(o => o.rank > 0).keySeq()),
        rx.share());

      // Track direct relations of these classes
      const direct = rxu.rx(
        rx.combineLatest({
          classes,
          members:    rxu.rx(classes, cdb.expand_direct_members()),
          subclasses: rxu.rx(classes, cdb.expand_direct_subclasses()),
        }),
        rx.map(update => update.classes
          .map(uuid => ({
            uuid,
            directMembers:    update.members.get(uuid, imm.Set()),
            directSubclasses: update.subclasses.get(uuid, imm.Set()),
          }))
          .toJS()),
      );

      this.rxsub = direct.subscribe(classes => {
        console.log("DIRECT UPDATE: %o", classes);
        this.data = classes;
        this.loading = false;
      });
    },
    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },
  },
})
