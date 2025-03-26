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
  },
})
