/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Calls to the Gateway Depot service go through the service client to
 * the service's UUID, with the paths docs/services/gateway-depot.md
 * gives. A refusal carries the service's own message, written for a
 * person, and a 403 is told apart so the page can explain the missing
 * permission.
 */

import { describe, it, expect } from 'vitest'

import {
  DepotError, NO_ANSWER, approve_gateway, depot_request, get_settings, list_clusters, list_gateways,
  onboard_gateway, remove_gateway,
} from '../src/lib/gateway-depot/api.js'
import { GatewayDepot } from '../src/lib/gateway-depot/constants.js'

/* A service client whose Fetch answers from a script and records calls. */
function fake_client (answer) {
  const calls = []
  return {
    calls,
    Fetch: {
      async fetch (opts) {
        calls.push(opts)
        return typeof answer === 'function' ? answer(opts) : answer
      },
    },
  }
}

const json = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => { if (body === undefined) throw new SyntaxError('no body'); return body },
})

describe('the Gateway Depot API', () => {
  it('uses the UUIDs acs-service-setup gives the depot', () => {
    expect(GatewayDepot).toEqual({
      Service: '4e298f74-4ae9-4da6-ba80-7a08de4036a6',
      Class: { Gateway: 'e763cbcd-157c-40d5-8e54-87c0647d9e07' },
      App: { Gateway: 'a67ed556-80e0-43d2-bd6e-3d25122b9a80' },
      Perm: { Provision: 'f8a2ad0a-6a2f-4b1a-b8fe-958e7b01fd94' },
    })
  })

  it('lists the gateways, with ids as strings', async () => {
    const client = fake_client(json(200, [{ id: 7, state: 'pending' }, null, { state: 'no id' }, { id: 'b', state: 'ready' }]))
    expect(await list_gateways(client)).toEqual([{ id: '7', state: 'pending' }, { id: 'b', state: 'ready' }])
    expect(client.calls).toEqual([{ service: GatewayDepot.Service, url: 'v1/gateway', method: 'GET' }])
  })

  it('treats an answer that is not a list as no gateways', async () => {
    expect(await list_gateways(fake_client(json(200, { oops: true })))).toEqual([])
    expect(await list_clusters(fake_client(json(200, null)))).toEqual([])
  })

  it('reads the settings and the clusters', async () => {
    const settings = fake_client(json(200, { defaults: { admin_user: 'fplus' }, k3s_version: 'v1.34.13+k3s1' }))
    expect(await get_settings(settings)).toEqual({ defaults: { admin_user: 'fplus' }, k3s_version: 'v1.34.13+k3s1' })
    expect(settings.calls[0]).toMatchObject({ url: 'v1/settings', method: 'GET' })

    const clusters = fake_client(json(200, [{ uuid: 'c', name: 'Tapeline', gateway: 'a' }]))
    expect(await list_clusters(clusters)).toEqual([{ uuid: 'c', name: 'Tapeline', gateway: 'a' }])
    expect(clusters.calls[0]).toMatchObject({ url: 'v1/cluster', method: 'GET' })
  })

  it('approves with a JSON body and hands back the one-time password', async () => {
    const out = { gateway: { id: 'a', state: 'approved' }, admin_user: 'fplus', password: 'correct horse' }
    const client = fake_client(json(200, out))
    const body = { north_mac: 'aa', south_mac: '', south_addr: '', disk: '/dev/sda', admin_user: 'fplus', label: '', ssh_keys: '' }
    expect(await approve_gateway(client, 'a', body)).toEqual(out)
    expect(client.calls).toEqual([{
      service: GatewayDepot.Service, url: 'v1/gateway/a/approve', method: 'POST',
      body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }])
  })

  it('onboards and removes by the gateway\'s id, escaped for the path', async () => {
    const client = fake_client(json(200, { gateway: { id: 'a/b' } }))
    await onboard_gateway(client, 'a/b', { mode: 'create', cluster_name: 'Tapeline' })
    await remove_gateway(client, 'a/b')
    expect(client.calls.map(c => [c.method, c.url])).toEqual([
      ['POST', 'v1/gateway/a%2Fb/onboard'],
      ['DELETE', 'v1/gateway/a%2Fb'],
    ])
    expect(client.calls[1]).not.toHaveProperty('body')
  })

  it('carries no sign-in of its own', async () => {
    const client = fake_client(json(200, []))
    await list_gateways(client)
    await remove_gateway(client, 'a')
    for (const call of client.calls) {
      expect(call.headers ?? {}).not.toHaveProperty('X-Gateway-Depot')
      expect(call).not.toHaveProperty('credentials')
    }
  })

  it('shows the message the service wrote for a person', async () => {
    const client = fake_client(json(409, { error: ' That gateway is not waiting for approval. ' }))
    const err = await approve_gateway(client, 'a', {}).catch(e => e)
    expect(err).toBeInstanceOf(DepotError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('That gateway is not waiting for approval.')
    expect(err.forbidden).toBe(false)
  })

  it('tells a missing permission apart', async () => {
    const err = await list_gateways(fake_client(json(403, { error: 'You need the Provision gateways permission.' }))).catch(e => e)
    expect(err.forbidden).toBe(true)
    expect(err.message).toBe('You need the Provision gateways permission.')
  })

  it('still says something when the service gives no message', async () => {
    const err = await depot_request(fake_client(json(502)), 'GET', 'v1/gateway').catch(e => e)
    expect(err.message).toBe('The request failed with status 502.')
    const odd = await depot_request(fake_client(json(500, { error: { nested: true } })), 'GET', 'v1/gateway').catch(e => e)
    expect(odd.message).toBe('The request failed with status 500.')
  })

  it('says the service did not answer on a network failure', async () => {
    /* The service client answers a network failure with status 0. */
    const dead = await list_gateways(fake_client({ status: 0, ok: false, json: () => Promise.reject('Network error') })).catch(e => e)
    expect(dead).toBeInstanceOf(DepotError)
    expect(dead.status).toBe(0)
    expect(dead.message).toBe(NO_ANSWER)
    const thrown = await list_gateways(fake_client(() => { throw new Error('boom') })).catch(e => e)
    expect(thrown.message).toBe(NO_ANSWER)
  })

  it('accepts an answer with no body', async () => {
    expect(await remove_gateway(fake_client(json(204)), 'a')).toBe(null)
  })
})
