/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

const BASE_URL = import.meta.env.I3X_BASE_URL || 'http://localhost:8080/v1'

async function request (path, options = {}) {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message || `i3X request failed: ${res.status}`)
  }
  const body = await res.json()
  if (body.success === false) {
    throw new Error(body.error?.message || 'i3X request failed')
  }
  return body.result
}

async function get (path) {
  return request(path)
}

async function post (path, body) {
  return request(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function useI3xClient () {
  return {
    getInfo () {
      return get('/info')
    },

    getObjects (params = {}) {
      const qs = new URLSearchParams()
      if (params.root != null) qs.set('root', String(params.root))
      if (params.typeElementId) qs.set('typeElementId', params.typeElementId)
      if (params.includeMetadata) qs.set('includeMetadata', 'true')
      const query = qs.toString()
      return get(`/objects${query ? '?' + query : ''}`)
    },

    getObject (elementId) {
      return get(`/objects/${encodeURIComponent(elementId)}`)
    },

    getRelated (elementId, relationshipType) {
      const qs = relationshipType
        ? `?relationshiptype=${encodeURIComponent(relationshipType)}`
        : ''
      return get(`/objects/${encodeURIComponent(elementId)}/related${qs}`)
    },

    getRelatedBulk (elementIds, relationshipType) {
      const body = { elementIds }
      if (relationshipType) body.relationshiptype = relationshipType
      return post('/objects/related', body)
    },

    getValue (elementId) {
      return get(`/objects/${encodeURIComponent(elementId)}/value`)
    },

    getValueBulk (elementIds, maxDepth) {
      const body = { elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post('/objects/value', body)
    },

    getHistory (elementId, startTime, endTime) {
      const qs = new URLSearchParams({ startTime, endTime })
      return get(`/objects/${encodeURIComponent(elementId)}/history?${qs}`)
    },

    getHistoryBulk (params) {
      return post('/objects/history', params)
    },

    createSubscription (clientId, displayName) {
      return post('/subscriptions', { clientId, displayName })
    },

    deleteSubscription (clientId, subscriptionIds) {
      return post('/subscriptions/delete', { clientId, subscriptionIds })
    },

    registerItems (clientId, subscriptionId, elementIds, maxDepth) {
      const body = { clientId, subscriptionId, elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post('/subscriptions/register', body)
    },

    unregisterItems (clientId, subscriptionId, elementIds) {
      return post('/subscriptions/unregister', { clientId, subscriptionId, elementIds })
    },

    syncSubscription (clientId, subscriptionId, lastSequenceNumber) {
      const body = { clientId, subscriptionId }
      if (lastSequenceNumber != null) body.lastSequenceNumber = lastSequenceNumber
      return post('/subscriptions/sync', body)
    },

    get baseUrl () {
      return BASE_URL
    },
  }
}
