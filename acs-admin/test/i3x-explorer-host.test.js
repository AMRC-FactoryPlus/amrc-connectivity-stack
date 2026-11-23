/*
 * ACS Admin
 * Tests for the host the framed i3X Explorer uses
 * Copyright 2026 University of Sheffield
 */

import { describe, it, expect, vi } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { classify_selection, explorer_actions, mk_host, ISA95_LEVEL_TYPE } from '../src/lib/i3x-explorer-host.js'

const level = (elementId, displayName, parentId = null) =>
  ({ elementId, displayName, typeId: ISA95_LEVEL_TYPE, parentId })
const obj = (elementId, displayName, typeId, parentId) =>
  ({ elementId, displayName, typeId, parentId })

const enterprise = level('e', 'Example Co')
const site = level('s', 'North Site', 'e')
const device = obj('d', 'Lathe 1', 'device-type', 's')
const branch = obj('b', 'Spindle', 'branch-type', 'd')

/* The ISA-95 vocabulary the levels above resolve against. */
const VOCAB = [
  { uuid: 'n-e', name: 'Example Co', aliases: [], children: ['n-s'], level: 'Enterprise' },
  { uuid: 'n-s', name: 'North Site', aliases: [], children: [], level: 'Site' },
]

function fake_client () {
  return {
    service_url: vi.fn(async uuid => {
      expect(uuid).toBe(UUIDs.Service.i3x)
      return 'https://i3x.example/'
    }),
    Fetch: { service_token: vi.fn(async (url, bad) => bad ? 'new-token' : 'token') },
  }
}

describe('mk_host', () => {
  it('gives the i3X base URL with the version path', async () => {
    const host = mk_host({ client: fake_client() })
    expect(await host.serviceUrl()).toBe('https://i3x.example/v1')
  })

  it('waits for the service client', async () => {
    let ready
    const client = new Promise(r => { ready = r })
    const host = mk_host({ client })
    const url = host.serviceUrl()
    ready(fake_client())
    expect(await url).toBe('https://i3x.example/v1')
  })

  it('asks the service client for a token for the service URL, passing on a refused one', async () => {
    const client = fake_client()
    const host = mk_host({ client })
    expect(await host.token()).toBe('token')
    expect(client.Fetch.service_token).toHaveBeenLastCalledWith('https://i3x.example/', undefined)
    expect(await host.token('token')).toBe('new-token')
    expect(client.Fetch.service_token).toHaveBeenLastCalledWith('https://i3x.example/', 'token')
  })

  it('passes theme and new window through', () => {
    const open_window = vi.fn()
    const host = mk_host({ client: fake_client(), theme: () => 'dark', open_window })
    expect(host.theme()).toBe('dark')
    host.openNewWindow()
    expect(open_window).toHaveBeenCalledOnce()
  })

  it('tells the app only the id and label of each action', async () => {
    const actions = vi.fn(async () => explorer_actions(
      classify_selection({ object: device, ancestors: [enterprise, site] }), VOCAB))
    const host = mk_host({ client: fake_client(), actions })
    const selection = { object: device, ancestors: [enterprise, site] }
    expect(await host.actions(selection)).toEqual([
      { id: 'access', label: 'Manage access' },
      { id: 'dataset', label: 'Build dataset' },
    ])
    expect(actions).toHaveBeenCalledWith(selection)
  })

  it('runs the action the app names, worked out again for the selection', async () => {
    const run = vi.fn()
    const actions = async sel => explorer_actions(classify_selection(sel), VOCAB)
    const host = mk_host({ client: fake_client(), actions, run })
    const selection = { object: device, ancestors: [enterprise, site] }

    await host.runAction('dataset', selection)
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'dataset', route: { path: '/datasets/new', query: { devices: 'd' } } }),
      selection)

    await host.runAction('access', selection)
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'access' }), selection)
  })

  it('runs nothing the selection does not offer', async () => {
    const run = vi.fn()
    const actions = async sel => explorer_actions(classify_selection(sel), VOCAB)
    const host = mk_host({ client: fake_client(), actions, run })
    await host.runAction('dataset', { object: site, ancestors: [enterprise] })
    await host.runAction('access', { object: branch, ancestors: [enterprise, site, device] })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('explorer_actions', () => {
  it('offers access and a dataset for a device, naming the levels above it', () => {
    const actions = explorer_actions(classify_selection({ object: device, ancestors: [enterprise, site] }), VOCAB)
    expect(actions.map(a => a.id)).toEqual(['access', 'dataset'])
    expect(actions[0].access).toEqual({
      target: 'd', device: true, via: VOCAB, noun: 'device', name: 'Lathe 1', path: 'Example Co / North Site',
    })
    expect(actions[1].route).toEqual({ path: '/datasets/new', query: { devices: 'd' } })
  })

  it('offers access on a level whose names match the vocabulary, granted on its node', () => {
    const actions = explorer_actions(classify_selection({ object: site, ancestors: [enterprise] }), VOCAB)
    expect(actions).toEqual([{ id: 'access', label: 'Manage access', access: {
      target: 'n-s', device: false, via: [VOCAB[0]], noun: 'site', name: 'North Site', path: 'Example Co / North Site',
    } }])
  })

  it('offers nothing on a level the vocabulary does not hold', () => {
    const odd = level('o', 'Somewhere Else', 'e')
    expect(explorer_actions(classify_selection({ object: odd, ancestors: [enterprise] }), VOCAB)).toEqual([])
    expect(explorer_actions(classify_selection({ object: site, ancestors: [enterprise] }), [])).toEqual([])
  })

  it('offers nothing inside a device, or with nothing selected', () => {
    expect(explorer_actions(classify_selection({ object: branch, ancestors: [enterprise, site, device] }), VOCAB))
      .toEqual([])
    expect(explorer_actions(null, VOCAB)).toEqual([])
  })
})

describe('classify_selection', () => {
  it('is null with nothing selected', () => {
    expect(classify_selection(null)).toBe(null)
  })

  it('names the levels down to a selected level', () => {
    expect(classify_selection({ object: site, ancestors: [enterprise] }))
      .toEqual({ kind: 'level', object: site, levels: ['Example Co', 'North Site'] })
  })

  it('takes an object directly under a level as a device, with the levels above it', () => {
    expect(classify_selection({ object: device, ancestors: [enterprise, site] }))
      .toEqual({ kind: 'device', object: device, levels: ['Example Co', 'North Site'] })
  })

  it('gives anything inside a device no access actions', () => {
    expect(classify_selection({ object: branch, ancestors: [enterprise, site, device] }))
      .toEqual({ kind: 'other', object: branch, levels: [] })
  })

  it('does not take a level under a non-level as part of the ISA-95 tree', () => {
    const odd = level('x', 'Odd', 'd')
    expect(classify_selection({ object: odd, ancestors: [enterprise, site, device] }).kind).toBe('other')
  })

  it('copes with a selection that has no ancestors yet', () => {
    expect(classify_selection({ object: device }).kind).toBe('other')
    expect(classify_selection({ object: enterprise }).kind).toBe('level')
  })
})
