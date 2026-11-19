/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * One store for the Gateway Depot pages. The service has no change
 * notification, so the list of gateways is fetched every few seconds
 * while a Gateway Depot page is open and the tab is visible.
 *
 * What a person has typed lives here too, apart from the polled data,
 * so a refresh never disturbs a form. This store is not persisted: the
 * one-time admin passwords are held in memory only, for as long as the
 * tab is open.
 */

import { defineStore } from 'pinia'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import * as api from '@/lib/gateway-depot/api.js'
import { CLUSTERS_MAX_AGE_MS, POLL_MS } from '@/lib/gateway-depot/constants.js'
import { clean, group_gateways, track_links } from '@/lib/gateway-depot/model.js'

let timer = null
let onVisible = null
let polling = false
let fails = 0
/* Bumped by every change made from this page, so a poll that was
 * already on its way cannot put the older list back. */
let epoch = 0
/* The last list as text, to skip a poll that changed nothing. */
let lastJson = null
/* "id|mac" -> the cable and address last seen, to spot changes. */
const links = new Map()
let clustersAt = 0
let settingsAsked = false
let guarding = false

const client = () => useServiceClientStore().client
const with_id = gw => (gw && gw.id != null && typeof gw.id !== 'string' ? { ...gw, id: String(gw.id) } : gw)

export const useGatewayDepotStore = defineStore('gateway-depot', {
  state: () => ({
    gateways: [],
    loaded: false,
    /* The person lacks the Provision gateways permission. */
    forbidden: false,
    /* Why the first load failed, if it did. */
    error: null,
    /* Two polls in a row have failed. */
    lost: false,
    users: 0,
    /* { defaults: { admin_user }, k3s_version } */
    settings: null,
    /* What GET v1/cluster returned, or null before it answers. */
    clusters: null,
    /* id -> { name, user, password, ack }. In memory only. */
    secrets: {},
    /* id -> { approve, onboard }: what the person has typed so far,
     * without secrets. */
    forms: {},
    /* "id|mac" -> { text, at }: cables and addresses that just changed. */
    linkEvents: {},
  }),

  getters: {
    byId: s => new Map(s.gateways.map(g => [g.id, g])),
    groups: s => group_gateways(s.gateways),
    k3sVersion: s => clean(s.settings && s.settings.k3s_version),
    defaultAdminUser: s => clean(s.settings && s.settings.defaults && s.settings.defaults.admin_user),
  },

  actions: {
    /** Called by each Gateway Depot page as it mounts. */
    start () {
      this.users++
      this.begin()
    },

    begin () {
      if (timer) return
      timer = setInterval(() => {
        if (document.visibilityState !== 'hidden') this.poll()
      }, POLL_MS)
      onVisible = () => { if (document.visibilityState === 'visible') this.poll() }
      document.addEventListener('visibilitychange', onVisible)
      this.poll()
    },

    /** Called by each page as it unmounts. Polling stops with the last. */
    stop () {
      this.users = Math.max(0, this.users - 1)
      if (this.users > 0) return
      this.halt()
    },

    halt () {
      clearInterval(timer)
      timer = null
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
      onVisible = null
    },

    async poll () {
      if (polling || !this.users || this.forbidden) return
      polling = true
      const was = epoch
      try {
        await serviceClientReady()
        const list = await api.list_gateways(client())
        fails = 0
        this.lost = false
        this.error = null
        if (was === epoch) this.setGateways(list)
        this.loadSettings()
      }
      catch (err) {
        if (err.forbidden) {
          /* Asking again every few seconds will not change the answer. */
          this.forbidden = true
          this.halt()
        }
        else {
          if (++fails >= 2) this.lost = true
          if (!this.loaded) this.error = err.message
        }
      }
      finally {
        polling = false
      }
    },

    /** Ask again after the service refused, or after a failed first load. */
    retry () {
      this.forbidden = false
      this.error = null
      if (this.users && !timer) this.begin()
      else this.poll()
    },

    setGateways (list) {
      const json = JSON.stringify(list)
      if (this.loaded && json === lastJson) return
      lastJson = json
      const now = Date.now()
      track_links(links, list, now)
      const events = {}
      for (const [key, rec] of links) if (rec.ev) events[key] = rec.ev
      this.linkEvents = events
      this.gateways = list
      this.loaded = true
    },

    /* Put one gateway the service just returned into the list. */
    putGateway (gw) {
      gw = with_id(gw)
      epoch++
      lastJson = null
      if (!gw || gw.id == null) return
      const i = this.gateways.findIndex(g => g.id === gw.id)
      if (i >= 0) this.gateways.splice(i, 1, gw)
      else this.gateways.unshift(gw)
    },

    async loadSettings () {
      if (settingsAsked) return
      settingsAsked = true
      try { this.settings = await api.get_settings(client()) }
      catch { settingsAsked = false }
    },

    /** Fetch the edge clusters, unless the list is still fresh. */
    async loadClusters () {
      if (this.clusters && Date.now() - clustersAt < CLUSTERS_MAX_AGE_MS) return
      if (Date.now() - clustersAt < POLL_MS) return
      clustersAt = Date.now()
      try { this.clusters = await api.list_clusters(client()) }
      catch { /* optional, so say nothing */ }
    },

    /** The form state for a gateway, made on first use. */
    form (id) {
      if (!this.forms[id]) this.forms[id] = {}
      return this.forms[id]
    },

    /**
     * Approve a gateway. The admin password comes back once and is
     * kept in memory under the gateway's id.
     *
     * @param name  what to call the gateway beside its password
     */
    async approve (id, body, name) {
      const out = await api.approve_gateway(client(), id, body)
      if (out && typeof out.password === 'string' && out.password) {
        this.secrets[id] = {
          name,
          user: clean(out.admin_user) || clean(body.admin_user),
          password: out.password,
          ack: false,
        }
        this.guardUnload()
      }
      if (this.forms[id]) delete this.forms[id].approve
      this.putGateway(out && out.gateway)
      this.poll()
    },

    async onboard (id, body) {
      const out = await api.onboard_gateway(client(), id, body)
      this.putGateway(out && out.gateway)
      this.poll()
    },

    async remove (id) {
      await api.remove_gateway(client(), id)
      epoch++
      lastJson = null
      this.gateways = this.gateways.filter(g => g.id !== id)
      delete this.forms[id]
    },

    /* Warn before the tab closes with a password nobody has recorded. */
    guardUnload () {
      if (guarding) return
      guarding = true
      window.addEventListener('beforeunload', e => {
        for (const sec of Object.values(this.secrets)) {
          if (!sec.ack) { e.preventDefault(); e.returnValue = ''; return }
        }
      })
    },
  },
})
