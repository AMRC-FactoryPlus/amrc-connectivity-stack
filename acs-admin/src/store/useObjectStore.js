/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import * as imm from "immutable";
import { defineStore } from 'pinia'
import * as rx from 'rxjs'

import * as rxu from '@amrc-factoryplus/rx-util'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {UUIDs} from "@amrc-factoryplus/service-client";
import {serviceClientReady} from "@store/useServiceClientReady.js";

export const useObjectStore = defineStore('object', {
  state: () => ({
    ready: false,
    maps: null,
    data: [],
    rxsub: null,
  }),
  actions: {
    async start () {
      if (this.rxsub)
        throw new Error("Object store start() called twice!");

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
            }));
        }),
        /* Allow multiple consumers without duplicating work */
        rx.share(),
      );

      /* Update our data */
      maps.subscribe(map => {
        this.data = map.valueSeq().toArray();
        this.ready = true;
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
