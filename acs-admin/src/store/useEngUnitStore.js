/*
 * ACS Admin
 * Pinia store for the engineering unit vocabulary
 * Copyright 2026 University of Sheffield AMRC
 */

import { defineStore } from 'pinia'
import * as rx          from 'rxjs'
import * as rxu         from '@amrc-factoryplus/rx-util'
import { UUIDs, eng_unit_resolver } from '@amrc-factoryplus/service-client'

import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady }    from '@store/useServiceClientReady.js'

export const useEngUnitStore = defineStore('eng-units', {
  state: () => ({
    /* Each unit: { uuid, code, symbol, aliases, name }. */
    data:   [],
    ready:  false,
    rxsub:  null,
  }),

  getters: {
    /* The unit an Eng_Unit string means, or undefined. */
    resolve: (state) => eng_unit_resolver(state.data),

    by_uuid: (state) => (uuid) => state.data.find(u => u.uuid === uuid),
  },

  actions: {
    async start () {
      if (this.rxsub) return

      await serviceClientReady()
      const cdb = useServiceClientStore().client.ConfigDB

      this.rxsub = rxu.rx(
        rx.combineLatest({
          units: cdb.search_app(UUIDs.App.EngineeringUnit),
          info:  cdb.search_app(UUIDs.App.Info),
        }),
        rx.map(({ units, info }) => [...units.entries()]
          .filter(([, u]) => u && typeof u.symbol === 'string')
          .map(([uuid, u]) => ({
            uuid,
            code:     u.code,
            symbol:   u.symbol,
            aliases:  u.aliases ?? [],
            name:     info.get(uuid)?.name ?? u.code,
          }))),
      ).subscribe(units => {
        this.data  = units
        this.ready = true
      })
    },

    stop () {
      this.rxsub?.unsubscribe()
      this.rxsub = null
      this.ready = false
    },
  },
})
