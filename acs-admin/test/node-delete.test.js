/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { describe, it, expect } from 'vitest'

import { delete_lines, delete_node, node_delete_plan } from '@/lib/node-delete.js'

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

describe('delete_lines', () => {
  it('names the connections and devices that go too', () => {
    const lines = delete_lines({
      connections: [{ uuid: 'c1', name: 'PLC' }],
      devices: [{ uuid: 'd1', name: 'Press' }, { uuid: 'd2', name: '' }],
    })
    expect(lines[0]).toBe('Its connection (PLC) and their stored passwords are deleted too.')
    expect(lines[1]).toBe('Its 2 devices (Press, d2) are deleted too.')
    expect(lines.at(-1)).toMatch(/cluster itself is not changed/)
  })

  it('says only what applies to a bare node', () => {
    expect(delete_lines({ connections: [], devices: [] })).toHaveLength(1)
  })
})
