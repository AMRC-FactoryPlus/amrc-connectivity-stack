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

// We track all classes which are members of one of these metaclasses.
const GROUPS = [
  `f1fabdd1-de90-4399-b3da-ccf6c2b2c08b`,     // Role
  `1c567e3c-5519-4418-8682-6086f22fbc13`,     // Composite permission
  `b7f0c2f4-ccf5-11ef-be77-777cd4e8cb41`,     // Service permission set
];

export const useGroupStore = defineStore('group', {
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
      const groups = rxu.rx(
        GROUPS,
        rx.map(g => cdb.watch_members(g)),
        rx.combineLatestAll(),
        rx.map(imm.Set.union),
        cdb.expand_members(),
      );

      const details = rxu.rx(
        rx.combineLatest(objs, groups),
        rx.map(([objs, groups]) => 
          groups.entrySeq()
            .map(([uuid, members]) => ({
              ...objs.get(uuid, {}),
              uuid,
              members:  members.toJS(),
            }))
            .toArray()),
      );

      this.rxsub = details.subscribe(grps => {
        console.debug("GROUPS UPDATE: %o", grps);
        this.data = grps;
        this.loading = false;
      });
    },
    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },

    async getGroup (uuid) {
      const grps = rx.firstValueFrom(this.groups);

    },

    /* This is called in lots of places but now does nothing */
    fetch () {},

    async storeReady () {
      await serviceClientReady()

      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },

    /* XXX This could be done better with rx.firstValueFrom */
    async getGroup(uuid) {
      /* This will now not return until we've got an update */
      await this.storeReady()

      return this.data.find(item => item.uuid === uuid);
    },
  },
})
