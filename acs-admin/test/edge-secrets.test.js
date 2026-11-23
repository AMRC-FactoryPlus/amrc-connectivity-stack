/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Saving a password into an edge cluster's sealed secret goes to the
 * Cluster Manager, which can refuse. The service client doesn't throw on
 * a refusal, so a refused save used to look like a success: the
 * connection saved with a key for a secret that didn't exist, and the
 * edge agent later failed with ENOENT. A refusal now rejects with a
 * message that says why.
 */

import { describe, it, expect } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'

import {
  SecretSaveError, save_edge_secret, secret_save_message,
} from '../src/lib/edge-secrets.js'

function fake_client (answer) {
  const calls = []
  return {
    calls,
    Fetch: {
      async fetch (opts) {
        calls.push(opts)
        if (answer instanceof Error) throw answer
        return answer
      },
    },
  }
}

const secret = {
  cluster: '29d7cfc4-4a10-4041-adf6-03e79b45328a',
  namespace: 'fplus-edge',
  name: 'edge-agent-sensitive-information-8710c446-747d-4198-861c-dcaaa9051788',
  key: '__FPSI__21708ea1-76ef-4e8d-a8cf-3fd1d7bbffd2',
  value: 'hunter2',
}

describe('saving an edge secret', () => {
  it('sends the value to the Cluster Manager', async () => {
    const client = fake_client({ status: 204 })
    await save_edge_secret(client, secret)
    expect(client.calls).toEqual([{
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${secret.cluster}/secret/${secret.namespace}/${secret.name}/${secret.key}`,
      method: 'PUT',
      body: 'hunter2',
      headers: { 'Content-Type': 'application/octet-stream' },
    }])
  })

  it.each([
    [403, /permission to save secrets/],
    [404, /doesn't know this cluster/],
    [500, /status 500/],
    [503, /sealing certificate/],
  ])('rejects a %i with a message that says why', async (status, said) => {
    const err = await save_edge_secret(fake_client({ status }), secret)
      .catch(e => e)
    expect(err).toBeInstanceOf(SecretSaveError)
    expect(err.status).toBe(status)
    expect(err.message).toMatch(said)
    expect(err.message).toMatch(/not saved|could not save/)
  })

  it('rejects when the service client gives status 0', async () => {
    const err = await save_edge_secret(fake_client({ status: 0 }), secret)
      .catch(e => e)
    expect(err.status).toBe(0)
    expect(err.message).toMatch(/did not answer/)
  })

  it('rejects when the request itself throws', async () => {
    const err = await save_edge_secret(fake_client(new TypeError('offline')), secret)
      .catch(e => e)
    expect(err).toBeInstanceOf(SecretSaveError)
    expect(err.status).toBe(0)
  })

  it('names the Create secrets permission on a refusal', () => {
    expect(secret_save_message(403)).toMatch(/Create secrets permission/)
  })

  it('never puts the value in the message', () => {
    for (const st of [0, 401, 403, 404, 500, 503])
      expect(secret_save_message(st)).not.toContain('hunter2')
  })
})
