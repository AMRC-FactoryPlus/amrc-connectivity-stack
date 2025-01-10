/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { ServiceClient, UUIDs } from '@amrc-factoryplus/service-client'

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
    login (opts) {

      (new ServiceClient(opts)).init().then((client) => {

        // save opts to local storage
        localStorage.setItem('opts', JSON.stringify(opts))

        this.username = opts.username
        this.client  = client
        this.loaded  = true
        this.scheme  = import.meta.env.SCHEME
        this.baseUrl = import.meta.env.BASEURL

        client.service_urls(UUIDs.Service.MQTT).then((urls) => {
          this.urls.mqtt = urls
        })
      })
    },

    logout () {

      // Delete the opts local storage item
      localStorage.removeItem('opts')

      // Refresh the page
      location.reload()
    },
  },
})
