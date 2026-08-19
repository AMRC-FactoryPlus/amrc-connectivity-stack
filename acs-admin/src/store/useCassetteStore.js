/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Cassettes: recordings for the simulator driver, stored in the
 * ConfigDB as objects of the Cassette class with the recording JSON as
 * their Cassette-recording config entry.
 *
 * The class membership tracks live through the generic store. The
 * recording documents themselves are large (hundreds of KB), so they
 * are fetched once on demand and only their metadata is kept.
 */

import { defineStore } from 'pinia'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { useStore } from '@store/useStore.ts'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { EdgeSim } from '@/lib/edge-sim-uuids.js'

/* Live list of cassette objects (uuid + name via the object store). */
export const useCassetteObjectStore = () => useStore(
  'cassette',
  EdgeSim.CassetteClass,
)()

/* Metadata sidecar: duration, channels, description per cassette. */
export const useCassetteMetaStore = defineStore('cassette-meta', {
  state: () => ({
    meta: {},       // uuid -> { name, description, duration_ms, channels, source }
    loading: {},    // uuid -> boolean
  }),

  actions: {
    /* Read one recording and keep only its metadata. */
    async fetchMeta (uuid) {
      if (this.meta[uuid] || this.loading[uuid]) return
      this.loading[uuid] = true
      try {
        const client = useServiceClientStore().client
        const doc = await client.ConfigDB.get_config(EdgeSim.CassetteApp, uuid)
        if (!doc?.cassette) return
        this.meta[uuid] = {
          name: doc.cassette.name,
          description: doc.cassette.description ?? '',
          duration_ms: doc.cassette.duration_ms ?? 0,
          channels: doc.channels?.length ?? 0,
          source: doc.cassette.source ?? 'unknown',
          deviceSchema: doc.cassette.deviceSchema ?? null,
        }
      }
      catch (err) {
        console.error(`Failed to read cassette ${uuid}`, err)
      }
      finally {
        this.loading[uuid] = false
      }
    },

    /* Store a new recording: create the object in the Cassette class,
     * name it, and write the document as its recording entry. Returns
     * the new object UUID. The document must already be validated. */
    async upload (doc, description) {
      const client = useServiceClientStore().client
      if (description) doc.cassette.description = description
      const uuid = await client.ConfigDB.create_object(EdgeSim.CassetteClass)
      await client.ConfigDB.put_config(UUIDs.App.Info, uuid,
        { name: doc.cassette.name })
      await client.ConfigDB.put_config(EdgeSim.CassetteApp, uuid, doc)
      this.meta[uuid] = {
        name: doc.cassette.name,
        description: doc.cassette.description ?? '',
        duration_ms: doc.cassette.duration_ms
          ?? doc.samples?.at(-1)?.[0] ?? 0,
        channels: doc.channels?.length ?? 0,
        source: doc.cassette.source ?? 'unknown',
        deviceSchema: doc.cassette.deviceSchema ?? null,
      }
      return uuid
    },
  },
})
