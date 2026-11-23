/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Before a dialog lets someone type a password that will be sealed into
 * an edge cluster's secret, it asks the Cluster Manager whether they may
 * save secrets there. The connection dialog needs to add a new key
 * (create), the bridge dialog to overwrite one (manage). Only a definite
 * no turns the fields off: an older Cluster Manager without the route,
 * or any other failure, is unknown and the fields stay on.
 */

import { describe, it, expect } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { load_secret_access, secret_access } from '../src/lib/edge-secrets.js'

const CLUSTER = '29d7cfc4-4a10-4041-adf6-03e79b45328a'

describe('reading the Cluster Manager\'s answer', () => {
  it.each([
    ['create', { manage: false, create: true }, true],
    ['create', { manage: false, create: false }, false],
    ['manage', { manage: true, create: true }, true],
    ['manage', { manage: false, create: true }, false],
  ])('%s from %o is %s', (need, body, want) => {
    expect(secret_access(200, body, need)).toBe(want)
  })

  it.each([0, 403, 404, 500, 503])('can\'t tell from a %i', status => {
    expect(secret_access(status, { manage: true, create: true }, 'create')).toBe(null)
  })

  it('can\'t tell from a body without the answer', () => {
    expect(secret_access(200, {}, 'create')).toBe(null)
    expect(secret_access(200, null, 'manage')).toBe(null)
    expect(secret_access(200, { create: 'yes' }, 'create')).toBe(null)
  })
})

function fake_client (answer) {
  const calls = []
  return {
    calls,
    Fetch: {
      async fetch (opts) {
        calls.push(opts)
        if (answer instanceof Error) throw answer
        return {
          status: answer.status,
          async json () {
            if (answer.body instanceof Error) throw answer.body
            return answer.body
          },
        }
      },
    },
  }
}

describe('asking the Cluster Manager', () => {
  it('asks about the cluster for the signed-in user', async () => {
    const client = fake_client({ status: 200, body: { manage: false, create: true } })
    expect(await load_secret_access(client, CLUSTER, 'create')).toBe(true)
    expect(client.calls).toEqual([{
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${CLUSTER}/secret-access`,
    }])
  })

  it('gives a definite no', async () => {
    const client = fake_client({ status: 200, body: { manage: false, create: true } })
    expect(await load_secret_access(client, CLUSTER, 'manage')).toBe(false)
  })

  it.each([404, 403, 500])('can\'t tell when the route answers %i', async status => {
    expect(await load_secret_access(fake_client({ status }), CLUSTER, 'create')).toBe(null)
  })

  it('can\'t tell when the request throws', async () => {
    const client = fake_client(new TypeError('offline'))
    expect(await load_secret_access(client, CLUSTER, 'create')).toBe(null)
  })

  it('can\'t tell when the body isn\'t JSON', async () => {
    const client = fake_client({ status: 200, body: new SyntaxError('bad JSON') })
    expect(await load_secret_access(client, CLUSTER, 'create')).toBe(null)
  })

  it('doesn\'t ask without a cluster', async () => {
    const client = fake_client({ status: 200, body: { create: true } })
    expect(await load_secret_access(client, null, 'create')).toBe(null)
    expect(client.calls).toEqual([])
  })
})
