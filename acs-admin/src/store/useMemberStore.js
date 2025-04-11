/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import * as rx from 'rxjs'
import * as rxu from '@amrc-factoryplus/rx-util'
import { useObjectStore } from '@store/useObjectStore.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'

export const useMemberStore = defineStore('members', {
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
      const members = rxu.rx(
        objs,
        rx.map(objList =>
          objList.filter(o => o.rank > 0).keySeq().toArray()
        ),
        cdb.expand_members(),
        rx.map(m => m.entrySeq().map(([uuid, members]) => ({uuid, members: members})).toJS())
      );

      this.rxsub = members.subscribe(members => {
        console.debug("MEMBERS UPDATE: %o", members);
        this.data = members;
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
