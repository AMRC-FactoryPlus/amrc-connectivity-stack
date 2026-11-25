/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { describe, it, expect } from 'vitest'

import { delete_message, delete_node, node_delete_plan } from '@/lib/node-delete.js'

const client = (status, body, fail = false) => ({
  Fetch: {
    fetch: async opts => {
      client.last = opts
      if (fail) throw new Error('offline')
      return { status, json: async () => body }
    },
  },
})

describe('node_delete_plan', () => {
  it('reads what the Cluster Manager says would go', async () => {
    const c = client(200, { allowed: true, name: 'Signals', connections: [{ uuid: 'c1', name: 'PLC' }], devices: [] })
    const plan = await node_delete_plan(c, 'cl', 'nd')
    expect(plan).toEqual({ allowed: true, name: 'Signals', connections: [{ uuid: 'c1', name: 'PLC' }], devices: [] })
    expect(client.last.url).toBe('v1/cluster/cl/node/nd/delete')
  })

  it('offers no delete when refused, missing or unreachable', async () => {
    expect((await node_delete_plan(client(200, { allowed: false }), 'cl', 'nd')).allowed).toBe(false)
    expect((await node_delete_plan(client(404, null), 'cl', 'nd')).allowed).toBe(false)
    expect((await node_delete_plan(client(0, null, true), 'cl', 'nd')).allowed).toBe(false)
    expect((await node_delete_plan(client(200, {}), '', 'nd')).allowed).toBe(false)
  })
})

describe('delete_node', () => {
  it('accepts a started delete', async () => {
    await expect(delete_node(client(202), 'cl', 'nd')).resolves.toBeUndefined()
    expect(client.last.method).toBe('DELETE')
    expect(client.last.url).toBe('v1/cluster/cl/node/nd')
  })

  it('explains a refusal', async () => {
    await expect(delete_node(client(403), 'cl', 'nd')).rejects.toThrow(/Manage clusters/)
    await expect(delete_node(client(409), 'cl', 'nd')).rejects.toThrow(/different cluster/)
    await expect(delete_node(client(0, null, true), 'cl', 'nd')).rejects.toThrow(/did not answer/)
  })
})

describe('delete_message', () => {
  it('names a bare node and its cluster', () => {
    expect(delete_message('Signals', 'Line 1', { connections: [], devices: [] }))
      .toBe('Signals on Line 1. You cannot undo this.')
  })

  it('falls back when the cluster name is unknown', () => {
    expect(delete_message('Signals', undefined, { connections: [], devices: [] }))
      .toBe('Signals on its cluster. You cannot undo this.')
  })

  it('names one connection and one device', () => {
    expect(delete_message('Signals', 'Line 1', {
      connections: [{ uuid: 'c1', name: 'PLC' }],
      devices: [{ uuid: 'd1', name: 'Press' }],
    })).toBe('Signals on Line 1, with its connection PLC and device Press. You cannot undo this.')
  })

  it('counts several, and uses the UUID when a name is missing', () => {
    expect(delete_message('Signals', 'Line 1', {
      connections: [{ uuid: 'c1', name: 'PLC' }],
      devices: [{ uuid: 'd1', name: 'Press' }, { uuid: 'd2', name: '' }],
    })).toBe('Signals on Line 1, with its connection PLC, and 2 devices Press and d2. You cannot undo this.')
  })

  it('names devices alone', () => {
    expect(delete_message('Signals', 'Line 1', {
      connections: [],
      devices: [{ uuid: 'd1', name: 'Press' }],
    })).toBe('Signals on Line 1, with its device Press. You cannot undo this.')
  })

  it('shortens a long list', () => {
    const devices = ['A', 'B', 'C', 'D', 'E'].map(n => ({ uuid: n, name: n }))
    expect(delete_message('Signals', 'Line 1', { connections: [], devices }))
      .toBe('Signals on Line 1, with its 5 devices A, B, C and 2 more. You cannot undo this.')
  })
})
