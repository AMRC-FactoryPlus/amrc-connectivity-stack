/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@store/serviceClientStore.js'

async function request (client, opts) {
  const res = await client.Fetch.fetch({
    service: UUIDs.Service.i3x,
    ...opts,
  })
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    throw new Error(body?.error?.message || `i3X request failed: ${res.status}`)
  }
  const body = await res.json()
  if (body.success === false) {
    throw new Error(body.error?.message || 'i3X request failed')
  }
  return body.result
}

function get (client, url, query) {
  return request(client, { url, method: 'GET', query })
}

function post (client, url, body) {
  return request(client, {
    url,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

export function useI3xClient () {
  // Lazy: the service-client may not be initialised at composable
  // construction time (e.g. composable read in a setup() that runs
  // before login). Resolve on each call.
  const store = useServiceClientStore()
  const c = () => {
    if (!store.client) {
      throw new Error('Service client not ready — log in first')
    }
    return store.client
  }

  return {
    getInfo () {
      return get(c(), 'v1/info')
    },

    getObjects (params = {}) {
      const query = {}
      if (params.root != null) query.root = String(params.root)
      if (params.typeElementId) query.typeElementId = params.typeElementId
      if (params.includeMetadata) query.includeMetadata = 'true'
      return get(c(), 'v1/objects', query)
    },

    getObject (elementId) {
      return get(c(), `v1/objects/${encodeURIComponent(elementId)}`)
    },

    getRelated (elementId, relationshipType) {
      const query = relationshipType ? { relationshiptype: relationshipType } : undefined
      return get(c(), `v1/objects/${encodeURIComponent(elementId)}/related`, query)
    },

    getRelatedBulk (elementIds, relationshipType) {
      const body = { elementIds }
      if (relationshipType) body.relationshiptype = relationshipType
      return post(c(), 'v1/objects/related', body)
    },

    getValue (elementId) {
      return get(c(), `v1/objects/${encodeURIComponent(elementId)}/value`)
    },

    getValueBulk (elementIds, maxDepth) {
      const body = { elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post(c(), 'v1/objects/value', body)
    },

    getHistory (elementId, startTime, endTime) {
      return get(c(), `v1/objects/${encodeURIComponent(elementId)}/history`,
        { startTime, endTime })
    },

    getHistoryBulk (params) {
      return post(c(), 'v1/objects/history', params)
    },

    createSubscription (clientId, displayName) {
      return post(c(), 'v1/subscriptions', { clientId, displayName })
    },

    deleteSubscription (clientId, subscriptionIds) {
      return post(c(), 'v1/subscriptions/delete', { clientId, subscriptionIds })
    },

    registerItems (clientId, subscriptionId, elementIds, maxDepth) {
      const body = { clientId, subscriptionId, elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post(c(), 'v1/subscriptions/register', body)
    },

    unregisterItems (clientId, subscriptionId, elementIds) {
      return post(c(), 'v1/subscriptions/unregister',
        { clientId, subscriptionId, elementIds })
    },

    syncSubscription (clientId, subscriptionId, lastSequenceNumber) {
      const body = { clientId, subscriptionId }
      if (lastSequenceNumber != null) body.lastSequenceNumber = lastSequenceNumber
      return post(c(), 'v1/subscriptions/sync', body)
    },

    /**
     * Resolve the i3x service base URL (including `/v1`) via Directory.
     * Async because Directory lookup may hit the network on first call.
     * SSE streams need this — fetchEventSource takes an absolute URL and
     * can't go through the service-client's Fetch wrapper.
     */
    async getBaseUrl () {
      const url = await c().service_url(UUIDs.Service.i3x)
      return new URL('v1', url).toString().replace(/\/$/, '')
    },
  }
}
