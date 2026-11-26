/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { describe, it, expect } from 'vitest'

import { cluster_delete_message, cluster_delete_plan, delete_cluster } from '@/lib/cluster-delete.js'

const client = (status, body, fail = false) => ({
  Fetch: {
    fetch: async opts => {
      client.last = opts
      if (fail) throw new Error('offline')
      return { status, json: async () => body }
    },
  },
})

describe('cluster_delete_plan', () => {
  it('reads what the Cluster Manager says would go', async () => {
    const body = { allowed: true, name: 'Line 1', online: [], nodes: [{ uuid: 'n1', name: 'Signals' }], deployments: [] }
    const plan = await cluster_delete_plan(client(200, body), 'cl')
    expect(plan).toEqual(body)
    expect(client.last.url).toBe('v1/cluster/cl/delete')
  })

  it('passes on which nodes are still online', async () => {
    const plan = await cluster_delete_plan(client(200, { allowed: true, online: ['m1'] }), 'cl')
    expect(plan.online).toEqual(['m1'])
    expect(plan.nodes).toEqual([])
  })

  it('offers no delete when refused, missing or unreachable', async () => {
    expect((await cluster_delete_plan(client(200, { allowed: false }), 'cl')).allowed).toBe(false)
    expect((await cluster_delete_plan(client(404, null), 'cl')).allowed).toBe(false)
    expect((await cluster_delete_plan(client(0, null, true), 'cl')).allowed).toBe(false)
    expect((await cluster_delete_plan(client(200, {}), '')).allowed).toBe(false)
  })
})

describe('delete_cluster', () => {
  it('accepts a started delete', async () => {
    await expect(delete_cluster(client(202), 'cl')).resolves.toBeUndefined()
    expect(client.last.method).toBe('DELETE')
    expect(client.last.url).toBe('v1/cluster/cl')
  })

  it('explains a refusal', async () => {
    await expect(delete_cluster(client(403), 'cl')).rejects.toThrow(/Delete clusters permission/)
    await expect(delete_cluster(client(409), 'cl')).rejects.toThrow(/still online/)
    await expect(delete_cluster(client(404), 'cl')).rejects.toThrow(/no longer exists/)
    await expect(delete_cluster(client(0, null, true), 'cl')).rejects.toThrow(/did not answer/)
  })
})

describe('cluster_delete_message', () => {
  it('names an empty cluster', () => {
    expect(cluster_delete_message('Line 1', { nodes: [], deployments: [] }))
      .toBe('Line 1. Its accounts, repository and settings are deleted too. You cannot undo this.')
  })

  it('names one node and one deployment', () => {
    expect(cluster_delete_message('Line 1', {
      nodes: [{ uuid: 'n1', name: 'Signals' }],
      deployments: [{ uuid: 'd1', name: 'Bridge' }],
    })).toBe('Line 1, with its node Signals and deployment Bridge. Its accounts, repository and settings are deleted too. You cannot undo this.')
  })

  it('counts several nodes', () => {
    expect(cluster_delete_message('Line 1', {
      nodes: [{ uuid: 'n1', name: 'A' }, { uuid: 'n2', name: 'B' }],
      deployments: [],
    })).toBe('Line 1, with its 2 nodes A and B. Its accounts, repository and settings are deleted too. You cannot undo this.')
  })
})
