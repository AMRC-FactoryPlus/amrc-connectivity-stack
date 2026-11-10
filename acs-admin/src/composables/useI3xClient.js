/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { openI3xStream } from '@composables/useI3xSSE.js'

async function fetch_body (client, opts) {
  const res = await client.Fetch.fetch({
    service: UUIDs.Service.i3x,
    ...opts,
  })
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    throw new Error(body?.error?.message || `i3X request failed: ${res.status}`)
  }
  return { status: res.status, body: await res.json() }
}

async function request (client, opts) {
  const { body } = await fetch_body(client, opts)
  if (body.success === false) {
    throw new Error(body.error?.message || 'i3X request failed')
  }
  return body.result
}

// Bulk endpoints answer with one { success, elementId, result | error }
// per id, and `success: false` at the top when any id failed. Return the
// per-id results, with the HTTP status, and leave the caller to handle
// the failures.
async function bulk (client, url, body) {
  const res = await fetch_body(client, {
    url,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return { status: res.status, results: res.body.results ?? [] }
}

/**
 * Sort the per-id results of a subscription register into the ids that
 * registered, the ids i3X does not show this principal (404: no access,
 * or not served) and the ids that failed for another reason. An id with
 * no result counts as failed.
 *
 * @param results  [{ success, elementId, error: { code } }]
 * @param ids      the ids that were sent, if known
 * @returns { ok, missing, failed }, each an array of ids
 */
export function register_outcome (results, ids = null) {
  const ok = [], missing = [], failed = []
  const seen = new Set()
  for (const r of results ?? []) {
    if (r?.elementId == null || seen.has(r.elementId)) continue
    seen.add(r.elementId)
    if (r.success) ok.push(r.elementId)
    else if (r.error?.code === 404) missing.push(r.elementId)
    else failed.push(r.elementId)
  }
  for (const id of ids ?? []) if (!seen.has(id)) failed.push(id)
  return { ok, missing, failed }
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
    async getInfo () {
      const { body } = await fetch_body(c(), { url: 'v1/info', method: 'GET' })
      return body?.result
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
      return bulk(c(), 'v1/objects/related', body).then(r => r.results)
    },

    getValue (elementId) {
      return get(c(), `v1/objects/${encodeURIComponent(elementId)}/value`)
    },

    // `partial` is set when the server's maxDepthCap cut maxDepth short
    // (HTTP 206): leaves below the cap are then missing from the answer.
    async getValueBulk (elementIds, maxDepth) {
      const body = { elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      const { status, results } = await bulk(c(), 'v1/objects/value', body)
      return { results, partial: status === 206 }
    },

    getHistory (elementId, startTime, endTime) {
      return get(c(), `v1/objects/${encodeURIComponent(elementId)}/history`,
        { startTime, endTime })
    },

    getHistoryBulk (params) {
      return bulk(c(), 'v1/objects/history', params).then(r => r.results)
    },

    createSubscription (clientId, displayName) {
      return post(c(), 'v1/subscriptions', { clientId, displayName })
    },

    deleteSubscription (clientId, subscriptionIds) {
      return post(c(), 'v1/subscriptions/delete', { clientId, subscriptionIds })
    },

    // Throws when any id fails. The monitor registers one id at a
    // time and relies on that.
    registerItems (clientId, subscriptionId, elementIds, maxDepth) {
      const body = { clientId, subscriptionId, elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post(c(), 'v1/subscriptions/register', body)
    },

    unregisterItems (clientId, subscriptionId, elementIds) {
      return post(c(), 'v1/subscriptions/unregister',
        { clientId, subscriptionId, elementIds })
    },

    // As registerItems, but returns the per-id results instead of
    // throwing when some ids fail: one unknown id must not stop the
    // others. Sort them with register_outcome.
    registerEach (clientId, subscriptionId, elementIds, maxDepth) {
      const body = { clientId, subscriptionId, elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return bulk(c(), 'v1/subscriptions/register', body).then(r => r.results)
    },

    unregisterEach (clientId, subscriptionId, elementIds) {
      return bulk(c(), 'v1/subscriptions/unregister',
        { clientId, subscriptionId, elementIds }).then(r => r.results)
    },

    syncSubscription (clientId, subscriptionId, lastSequenceNumber) {
      const body = { clientId, subscriptionId }
      if (lastSequenceNumber != null) body.lastSequenceNumber = lastSequenceNumber
      return post(c(), 'v1/subscriptions/sync', body)
    },

    /**
     * Resolve the i3X service base URL (including `/v1`) via Directory.
     * Async because Directory lookup may hit the network on first call.
     * SSE streams need this — fetchEventSource takes an absolute URL and
     * can't go through the service-client's Fetch wrapper.
     */
    async getBaseUrl () {
      const url = await c().service_url(UUIDs.Service.i3x)
      return new URL('v1', url).toString().replace(/\/$/, '')
    },

    /**
     * Open an authenticated SSE stream against i3X's subscriptions/stream
     * endpoint. Resolves the service URL and a Bearer token via the
     * service-client (same path Fetch.fetch uses), then opens an SSE
     * connection with the token in the Authorization header.
     *
     * Returns a controller with .close(). If the token expires mid-
     * stream, fetchEventSource's auto-reconnect will fail; the caller
     * should treat that as a signal to re-open the stream from scratch.
     */
    async streamSubscription (clientId, subscriptionId, onMessage, onClose, opts = {}) {
      const client = c()
      const serviceUrl = await client.service_url(UUIDs.Service.i3x)
      const token = await client.Fetch.service_token(serviceUrl)
      const baseUrl = new URL('v1', serviceUrl).toString().replace(/\/$/, '')
      return openI3xStream(
        baseUrl,
        { Authorization: `Bearer ${token}` },
        clientId,
        subscriptionId,
        onMessage,
        onClose,
        opts,
      )
    },
  }
}
