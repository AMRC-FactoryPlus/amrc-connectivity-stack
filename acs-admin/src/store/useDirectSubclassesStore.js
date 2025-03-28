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

export const useDirectSubclassesStore = defineStore('directsubclasses', {
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

      // This gives an Observable of Maps from group UUID to Set.
      const directSubclasses = rxu.rx(
          objs,
          rx.map(objList =>
              objList.filter(o => o.rank > 0).keySeq()
          ),
          cdb.expand_direct_subclasses(),
          rx.map(m => m.entrySeq().map(([uuid, subclasses]) => ({uuid, directSubclasses: subclasses})).toJS())
      );

      this.rxsub = directSubclasses.subscribe(subclasses => {
        console.log("SUBCLASSES UPDATE: %o", subclasses);
        this.data = subclasses;
        this.loading = false;
      });
    },
    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },
  },
})
