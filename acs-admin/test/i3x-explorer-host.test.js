/*
 * ACS Admin
 * Tests for the host the framed i3X Explorer uses
 * Copyright 2026 University of Sheffield
 */

import { describe, it, expect, vi } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { classify_selection, mk_host, ISA95_LEVEL_TYPE } from '../src/lib/i3x-explorer-host.js'

const level = (elementId, displayName, parentId = null) =>
  ({ elementId, displayName, typeId: ISA95_LEVEL_TYPE, parentId })
const obj = (elementId, displayName, typeId, parentId) =>
  ({ elementId, displayName, typeId, parentId })

const enterprise = level('e', 'Example Co')
const site = level('s', 'North Site', 'e')
const device = obj('d', 'Lathe 1', 'device-type', 's')
const branch = obj('b', 'Spindle', 'branch-type', 'd')

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

  it('passes theme, new window and selection through', () => {
    const open_window = vi.fn()
    const selected = vi.fn()
    const host = mk_host({ client: fake_client(), theme: () => 'dark', open_window, selected })
    expect(host.theme()).toBe('dark')
    host.openNewWindow()
    expect(open_window).toHaveBeenCalledOnce()
    host.selected(undefined)
    expect(selected).toHaveBeenLastCalledWith(null)
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
