/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {defineStore} from 'pinia'
import {useServiceClientStore} from '@/store/serviceClientStore.js'
import {serviceClientReady} from '@store/useServiceClientReady.js'
import {useObjectStore} from "@store/useObjectStore.js";
import * as rxu from "@amrc-factoryplus/rx-util";
import * as rx from "rxjs";
import * as rxx from "@amrc-factoryplus/rx-util";
import * as imm from "immutable";

export const useDirectMembersStore = defineStore('directmembers', {
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

      // This gives an Observable of Maps from group UUID to Set.
      const directMembers = rxu.rx(
          objs,
          rx.map(objList =>
              objList.filter(o => o.rank > 0).keySeq()
          ),
          cdb.expand_direct_members(),
          rx.map(m => m.entrySeq().map(([uuid, members]) => ({uuid, directMembers: members})).toJS())
      );

      this.rxsub = directMembers.subscribe(members => {
        console.log("MEMBERS UPDATE: %o", members);
        this.data = members;
        this.loading = false;
      });
    },
    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },
  },
})
