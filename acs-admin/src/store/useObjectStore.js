/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import * as rx from 'rxjs'

import * as rxu from '@amrc-factoryplus/rx-util'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {UUIDs} from "@amrc-factoryplus/service-client";
import {serviceClientReady} from "@store/useServiceClientReady.js";

export const useObjectStore = defineStore('object', {
  state: () => {
    const ready = Promise.withResolvers();
    return {
      ready: false,
      readyPromise: ready.promise,
      _set_ready: ready.resolve,
      maps: null,
      data: [],
      rxsub: null,

    }
  },
  actions: {
    async start () {

      if (this.rxsub)
        // Already started so just return
        return;

      await serviceClientReady();
      const cdb = useServiceClientStore().client.ConfigDB;

      const info = cdb.search_app(UUIDs.App.Info);
      const registration = cdb.search_app(UUIDs.App.Registration);

      /* Create an Observable of Maps from UUID to name info */
      const maps = this.maps = rxu.rx(
        rx.combineLatest(info, registration),
        rx.map(([infos, regs]) => {
          const name_of = u => infos.get(u)?.name ?? "UNKNOWN";
          return regs
            .map((reg, uuid) => ({
              uuid,
              name: name_of(uuid),
              rank: reg.rank,
              class: {
                uuid: reg.class,
                name: name_of(reg.class),
              },
              owner: {
                uuid: reg.owner,
                name: name_of(reg.owner),
              },
            }));
        }),
        /* Allow multiple consumers without duplicating work */
        rx.share(),
      );

      /* Update our data */
      maps.subscribe(map => {
        this.data = map.valueSeq().toArray();
        this.ready = true;
        this._set_ready();
      });
    },

    stop () {
      if (this.rxsub) {
        this.rxsub.unsubscribe();
        this.rxsub = null;
      }
    },
  },
})
