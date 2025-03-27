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
    }
  },
  actions: {
    // since we rely on `this`, we cannot use an arrow function
    async login (opts) {

      const client = new RxClient(opts);

      // Try an auth lookup to check client authentication.
      await client.Auth.whoami_uuid()

      // save opts to local storage
      localStorage.setItem('opts', JSON.stringify(opts))

      this.username = opts.username
      this.client  = client
      this.loaded  = true
      this.scheme  = import.meta.env.SCHEME
      this.baseUrl = import.meta.env.BASEURL

      this.urls.MQTT = await client.service_urls(UUIDs.Service.MQTT);

      client.Fetch.cache = 'reload';
    },

    logout () {

      // Delete the opts local storage item
      localStorage.removeItem('opts')

      // Refresh the page
      location.reload()
    },
  },
})
