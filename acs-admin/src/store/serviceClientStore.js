/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client'
import { save_login, clear_login } from '@/lib/saved-login.js'

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
      try {
        this.urls.MQTT = await client.service_urls(UUIDs.Service.MQTT);
        this.username = opts.username;
        this.client  = client;
        this.loaded = true;
        this.scheme  = import.meta.env.SCHEME;
        this.baseUrl = import.meta.env.BASEURL;
        // Keep opts for this tab so a page reload stays signed in
        save_login(opts);
        // client.Fetch.cache = 'reload';
        this.ready = true;
      } catch (e) {
        this.logout();
        throw e;
      }
    },

    logout () {
      // Forget the saved sign-in details
      clear_login();
      // Reset the local state
      this.$reset();
      this.ready = false;
    },
  },
})
