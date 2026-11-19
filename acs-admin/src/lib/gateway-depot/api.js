/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Calls to the Gateway Depot service. The service is found through the
 * Directory by its UUID, and the service client signs each request as
 * the person who is signed in to the Admin UI. */

import { GatewayDepot } from './constants.js'

/** A request the service refused, with a message for a person. */
export class DepotError extends Error {
  constructor (status, message) {
    super(message)
    this.name = 'DepotError'
    this.status = status
  }

  /** True when the person lacks the Provision gateways permission. */
  get forbidden () { return this.status === 403 }
}

export const NO_ANSWER = 'The Gateway Depot service did not answer. Check your network connection and try again.'

/**
 * Make one request. Resolves with the parsed JSON body, or null when
 * there is none. Rejects with a DepotError carrying the service's own
 * message when it gave one.
 *
 * @param client  the service client
 * @param method  the HTTP method
 * @param url     the path under the service's URL, with no leading slash
 * @param body    an object to send as JSON, if any
 */
export async function depot_request (client, method, url, body) {
  const opts = { service: GatewayDepot.Service, url, method }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
    opts.headers = { 'Content-Type': 'application/json' }
  }
  let res
  try { res = await client.Fetch.fetch(opts) }
  catch { throw new DepotError(0, NO_ANSWER) }
  /* The service client answers a network failure with status 0. */
  if (!res || !res.status) throw new DepotError(0, NO_ANSWER)
  let data = null
  try { data = await res.json() }
  catch { /* no body */ }
  if (!res.ok) {
    const said = data && typeof data.error === 'string' ? data.error.trim() : ''
    throw new DepotError(res.status, said || 'The request failed with status ' + res.status + '.')
  }
  return data
}

const path = id => 'v1/gateway/' + encodeURIComponent(id)

/** Every gateway, newest first, with ids as strings. */
export async function list_gateways (client) {
  const list = await depot_request(client, 'GET', 'v1/gateway')
  return (Array.isArray(list) ? list : [])
    .filter(g => g && typeof g === 'object' && g.id != null)
    .map(g => (typeof g.id === 'string' ? g : { ...g, id: String(g.id) }))
}

/** { defaults: { admin_user }, k3s_version } */
export const get_settings = client => depot_request(client, 'GET', 'v1/settings')

/** The edge clusters: [{ uuid, name, reported, hosts, gateway }]. */
export async function list_clusters (client) {
  const list = await depot_request(client, 'GET', 'v1/cluster')
  return Array.isArray(list) ? list : []
}

/** Approve a waiting gateway. Resolves with { gateway, admin_user, password }. */
export const approve_gateway = (client, id, body) => depot_request(client, 'POST', path(id) + '/approve', body)

/** Start onboarding. Resolves with { gateway }. */
export const onboard_gateway = (client, id, body) => depot_request(client, 'POST', path(id) + '/onboard', body)

/** Remove a gateway's record. This does not change the gateway. */
export const remove_gateway = (client, id) => depot_request(client, 'DELETE', path(id))
