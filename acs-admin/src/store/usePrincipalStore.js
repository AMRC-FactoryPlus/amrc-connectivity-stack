/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import * as rx from 'rxjs'

import {UUIDs, ServiceError} from "@amrc-factoryplus/service-client";
import * as rxu from "@amrc-factoryplus/rx-util";

import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {useObjectStore} from "@store/useObjectStore.js";

export const usePrincipalStore = defineStore('principal', {
  state: () => ({
    data: [],
    loading: false,
    fetchTrigger: null,
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
      // Create a Subject we can use to trigger an Auth fetch.
      // This is to work around the lack of notify interface.
      const trigger = this.fetchTrigger = new rx.Subject();

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      const client = useServiceClientStore().client;
      const auth = client.Auth;
      const fetch = client.Fetch;
      const objs = useObjectStore().maps;

      // Create a sequence tracking the principals.
      const krbs = rxu.rx(
        trigger,
        // Do an initial fetch immediately.
        rx.startWith(null),
        // switchMap means we abort an in-progress fetch if we get a new trigger.
        rx.switchMap(async () => {
          /* XXX This is stateful and will be unreliable */
          this.loading = true;
          /* XXX This API needs fixing */
          fetch.cache = "reload";
          const princs = await auth.list_principals();
          const rv = Promise.all(princs.map(uuid =>
            auth.get_identity(uuid, "kerberos")
              .catch(ServiceError.check(403, 404))
              .then(krb => [uuid, krb ?? "UNKNOWN"])));
          fetch.cache = "default";
          return rv;
        }),
        // Retry with delay on error
        rx.retry({
          delay: (err, n) => {
            console.error("Principals fetch failed (%s attempts): %o", n, err);
            return rx.timer(5000);
          },
          resetOnSuccess: true,
        }),
      );

      const seq = rxu.rx(
        rx.combineLatest(objs, krbs),
        rx.map(([objs, krbs]) => 
          krbs.map(([uuid, kerberos]) => ({
            ...objs.get(uuid, { name: "UNKNOWN", class: { name: "UNKNOWN" }}),
            uuid, kerberos,
          }))),
      );

      this.rxsub = seq.subscribe(princs => {
        this.data = princs;
        this.loading = false;
      });
    },

    stop () {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },

    // This just pushes a notification down the trigger sequence.
    fetch () { 
      // If start() hasn't been called yet we will fetch when it is.
      this.fetchTrigger?.next(null);
    },
  },
})
