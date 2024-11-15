/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { defineStore } from 'pinia'
import { UUIDs } from '@amrc-factoryplus/service-client'
import * as rx from 'rxjs'

export const useAlertStore = defineStore('alert', {
  state: () => ({
    alerts: [],
  }),
  actions: {
    async fetchAlerts (fplus) {
      const res = await fplus.Directory.fetch({
        url: 'v1/alert/active',
        cache: 'reload',
      })
      if (res[0] !== 200) return

      const info    = o => fplus.ConfigDB.get_config(UUIDs.App.Info, o)
      const name    = o => info(o).then(v => v?.name)
      const addr    = o => fplus.Directory.get_device_address(o).then(a => a.toString())
      const link    = u => fplus.Directory.fetch(`v1/link/${u}`).then(([st, rv]) => st === 200 ? rv : null)
      const unknown = u => `Unknown (${u})`
      const first   = async (v, ...fs) => {
        for (const f of fs) {
          const rv = await f(v)
          if (rv != null) return rv
        }
      }

      const rv = []
      for (const alrt of res[1]) {
        const inf = await info(alrt.device)
        if (inf?.deleted) continue

        const links = []
        for (const uuid of alrt.links ?? []) {
          const l = await link(uuid)
          if (!l) continue
          const rv = {
            relation: await first(l.relation, name, unknown),
            target: await first(l.target, name, addr, unknown),
          }
          links.push(rv)

        }

        rv.push({
          uuid: alrt.uuid,
          device: await first(alrt.device, name, addr, unknown),
          type: await first(alrt.type, name, unknown),
          since: new Date(alrt.last_change),
          links,
        })
      }
      return rv
    },

    watchAlerts (fplus) {
      if (fplus == null) return

      const from_dir = rx.defer(async () => {
        const spa = await fplus.MQTT.sparkplug_app()
        const inf = await fplus.Directory.get_service_info(UUIDs.Service.Directory)
        const dev = await spa.device({ device: inf.device })
        return dev.metric('Last_Changed/Alert_Type')
      }).pipe(rx.mergeAll())

      /* This does not currently work correctly, as if we refresh because
       * of a CDB notification the CDB fetches all get stale cached
       * responses. We need a better change-notify interface that allows
       * us to make appropriate 'reload' requests, or (better) provides
       * the information we need directly. Disabling the cache altogether
       * makes the app unacceptably slow (unsurprisingly). */
      //const from_cdb = rx.defer(async () => {
      //    const cdbw = await fplus.ConfigDB.watcher();
      //    return cdbw.application(UUIDs.App.Info);
      //}).pipe(rx.mergeAll());

      const sub = rx.merge(rx.timer(0, 5 * 60 * 1000), from_dir /*from_cdb*/).
        pipe(rx.throttleTime(1000, undefined, {
          leading: true,
          trailing: true,
        }), rx.switchMap(() => this.fetchAlerts(fplus))).
        subscribe(res => res && (this.alerts = res))

      return () => sub.unsubscribe()
    },

  },
})
