/*
 * ACS Admin
 * Tests for the seam between the vendored i3X Explorer and the Manager UI
 * Copyright 2026 University of Sheffield
 */

import { describe, expect, it, vi } from 'vitest'
import { HostTokenProvider, hostSelection } from './host'
import type { ObjectInstance } from '../api/types'
import type { SelectedItem } from '../stores/explorer'

const object = (elementId: string, parentId: string | null): ObjectInstance => ({
  elementId,
  displayName: elementId.toUpperCase(),
  typeId: 'type',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
})

describe('HostTokenProvider', () => {
  it('asks the host once and reuses the token', async () => {
    const token = vi.fn(async () => 'one')
    const provider = new HostTokenProvider({ token })
    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer one' })
    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer one' })
    expect(token).toHaveBeenCalledOnce()
  })

  it('asks for a new token after a refusal, naming the refused one', async () => {
    const token = vi.fn(async (bad?: string) => (bad ? 'two' : 'one'))
    const provider = new HostTokenProvider({ token })
    const sent = await provider.getHeaders()
    expect(await provider.handleUnauthorized(sent)).toBe(true)
    expect(token).toHaveBeenLastCalledWith('one')
    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer two' })
  })

  it('does not retry when the host hands back the refused token', async () => {
    const provider = new HostTokenProvider({ token: async () => 'one' })
    const sent = await provider.getHeaders()
    expect(await provider.handleUnauthorized(sent)).toBe(false)
  })

  it('retries at once when a newer token is already held', async () => {
    const token = vi.fn(async () => 'two')
    const provider = new HostTokenProvider({ token })
    await provider.getHeaders()
    expect(await provider.handleUnauthorized({ Authorization: 'Bearer one' })).toBe(true)
    expect(token).toHaveBeenCalledOnce()
  })

  it('does not retry when the host cannot give a token', async () => {
    const provider = new HostTokenProvider({ token: async () => { throw new Error('no session') } })
    expect(await provider.handleUnauthorized({ Authorization: 'Bearer one' })).toBe(false)
  })
})

describe('hostSelection', () => {
  const top = object('top', null)
  const mid = object('mid', 'top')
  const leaf = object('leaf', 'mid')
  const index = new Map([top, mid, leaf].map(o => [o.elementId, o]))

  it('is null for nothing, or for something other than an object', () => {
    expect(hostSelection(null, index)).toBe(null)
    const type: SelectedItem = { type: 'objectType', id: 't', data: { elementId: 't' } as never }
    expect(hostSelection(type, index)).toBe(null)
  })

  it('gives the object and its ancestors from the top down', () => {
    const selection = hostSelection({ type: 'object', id: 'leaf', data: leaf }, index)
    expect(selection?.object.elementId).toBe('leaf')
    expect(selection?.ancestors.map(a => a.elementId)).toEqual(['top', 'mid'])
  })

  it('stops at a parent the catalog does not hold, and at a cycle', () => {
    const orphan = object('orphan', 'missing')
    expect(hostSelection({ type: 'object', id: 'orphan', data: orphan }, index)?.ancestors).toEqual([])
    const a = object('a', 'b')
    const b = object('b', 'a')
    const looped = new Map([[a.elementId, a], [b.elementId, b]])
    expect(hostSelection({ type: 'object', id: 'a', data: a }, looped)?.ancestors.map(o => o.elementId)).toEqual(['b'])
  })
})
