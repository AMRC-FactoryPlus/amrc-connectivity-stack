/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'
import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client'
import { OidcClient } from '@/lib/oidc.js'

function directoryUrl () {
  return import.meta.env.SCHEME + '://directory.' + import.meta.env.BASEURL
}

export const useServiceClientStore = defineStore('service-client', {
  state: () => {
    return {
      username: null,
      client: null,
      oidc: null,
      loaded: false,
      scheme: null,
      baseUrl: null,
      urls: {},
      ready: false
    }
  },
  actions: {
    // since we rely on `this`, we cannot use an arrow function

    // Logs in via Keycloak (Authorization Code + PKCE) when OIDC is
    // configured for this deployment; falls back to the username/password
    // form (`opts`) otherwise. The OIDC branch may navigate away to
    // Keycloak and never resolve.
    async login (opts = {}) {
      const discoveryUrl = import.meta.env.OIDC_DISCOVERY_URL;
      let clientOpts;

      if (discoveryUrl) {
        const oidc = await new OidcClient({
          discovery_url: discoveryUrl,
          client_id: import.meta.env.OIDC_CLIENT_ID,
        }).init();
        await oidc.ensure_login();
        this.oidc = oidc;
        clientOpts = {
          directory_url: directoryUrl(),
          bearer_jwt: bad => oidc.token(bad),
          browser: true,
          verbose: opts.verbose,
        };
      } else {
        clientOpts = opts;
      }

      const client = new RxClient(clientOpts);
      // Try an auth lookup to check client authentication.
      try {
        this.urls.MQTT = await client.service_urls(UUIDs.Service.MQTT);
        this.username = discoveryUrl ? this.oidc.username : opts.username;
        this.client  = client;
        this.loaded = true;
        this.scheme  = import.meta.env.SCHEME;
        this.baseUrl = import.meta.env.BASEURL;
        if (!discoveryUrl) {
          // Dev/non-OIDC fallback only: save opts to local storage for
          // use on page reload.
          localStorage.setItem('opts', JSON.stringify(opts));
        }
        this.ready = true;
      } catch (e) {
        this.logout();
        throw e;
      }
    },

    logout () {
      // Delete the opts local storage item
      localStorage.removeItem('opts');
      const oidc = this.oidc;
      // Reset the local state
      this.$reset();
      this.ready = false;
      // Navigates away to Keycloak's RP-initiated logout.
      oidc?.logout();
    },
  },
})
