/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client'

export const useServiceClientStore = defineStore('service-client', {
  state: () => {
    return {
      username: null,
      client: null,
      loaded: false,
      scheme: null,
      baseUrl: null,
      urls: {},
      ready: false
    }
  },
  actions: {
    // since we rely on `this`, we cannot use an arrow function
    async login (opts) {

      const client = new RxClient(opts);
      // Try an auth lookup to check client authentication.
      try{
        this.urls.MQTT = await client.service_urls(UUIDs.Service.MQTT);
        // save opts to local storage
        localStorage.setItem('opts', JSON.stringify(opts))
        localStorage.setItem('clientLoaded', JSON.stringify(true));
        this.username = opts.username;
        this.client  = client;
        this.loaded = true;
        this.scheme  = import.meta.env.SCHEME;
        this.baseUrl = import.meta.env.BASEURL;

      this.ready = true
      } catch (e) {
        this.$reset();
        localStorage.removeItem('clientLoaded')
        throw e;
      }
    },

    logout () {
      // Delete the opts local storage item
      localStorage.removeItem('opts');
      localStorage.removeItem('clientLoaded')
      // Reset the local state
      this.$reset();
    },
  },
})
