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

export const useApplicationStore = defineStore('application', {
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
      const App = UUIDs.Class.App;
      const apps = cdb.watch_members(App);

      const details = rxu.rx(
          rx.combineLatest(objs, apps),
          rx.map(([objs, apps]) =>
              apps.map(uuid =>
                  objs.get(uuid, { name: "UNKNOWN", class: { name: "UNKNOWN" } }))
                  .toArray()),
      );

      this.rxsub = details.subscribe(apps => {
        console.debug("APPS UPDATE: %o", apps);
        // Sort applications alphabetically by name
        this.data = apps.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );
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
