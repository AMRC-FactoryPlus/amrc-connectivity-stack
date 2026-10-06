/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The Explorer's current value of a composition, as a tree.
 *
 * i3X answers with a flat map of leaf IDs, so the tree and the names
 * come from has-children. A leaf inside a nested composition must keep
 * its value: dropping those is the bug this tree replaces.
 */

import { describe, it, expect } from 'vitest'

import { mk_node, load_subtree, count_leaves, leaf_state } from '../src/lib/explorer/value-tree.js'

/* A street light: leaves of its own, a Location composition with
 * leaves, and a Cyber_Profile two levels deep. */
const OBJECTS = {
  light: { displayName: 'Street_Light_SL067275', isComposition: true },
  kind: { parentId: 'light', displayName: 'Kind' },
  owner: { parentId: 'light', displayName: 'Owner' },
  location: { parentId: 'light', displayName: 'Location', isComposition: true },
  lat: { parentId: 'location', displayName: 'Latitude' },
  lon: { parentId: 'location', displayName: 'Longitude' },
  cyber: { parentId: 'light', displayName: 'Cyber_Profile', isComposition: true },
  network: { parentId: 'cyber', displayName: 'Network', isComposition: true },
  ip: { parentId: 'network', displayName: 'Address' },
  firmware: { parentId: 'cyber', displayName: 'Firmware' },
}

const children = id => Object.entries(OBJECTS)
  .filter(([, o]) => o.parentId === id)
  .map(([elementId, o]) => ({ elementId, ...o }))

const depth_of = id => {
  let d = 0
  for (let p = OBJECTS[id].parentId; p; p = OBJECTS[p].parentId) d++
  return d
}

const vqt = id => ({ value: `${id}-value`, quality: 'Good', timestamp: '2026-10-05T11:16:01Z' })

/* A fake i3X client that answers like the server: values to maxDepth,
 * keyed by leaf ID, with `owner` never having had a value. */
function fake_i3x () {
  const calls = { related: [], value: [] }
  return {
    calls,
    async getRelatedBulk (ids, rel) {
      calls.related.push({ ids, rel })
      return ids.map(id => ({ success: true, elementId: id, result: children(id) }))
    },
    async getValueBulk (ids, maxDepth) {
      calls.value.push({ ids, maxDepth })
      return ids.map(id => {
        const base = depth_of(id)
        const components = {}
        for (const [leaf, o] of Object.entries(OBJECTS)) {
          if (o.isComposition || leaf === 'owner') continue
          let p = o.parentId
          while (p && p !== id) p = OBJECTS[p].parentId
          if (p !== id) continue
          if (maxDepth > 0 && depth_of(leaf) - base > maxDepth) continue
          components[leaf] = vqt(leaf)
        }
        return { success: true, elementId: id, result: { elementId: id, isComposition: true, components } }
      })
    },
  }
}

const top = () => mk_node({ elementId: 'light', isComposition: true })
const names = node => node.children.map(c => c.displayName)

describe('composition value tree', () => {
  it('names every row and keeps the values of nested leaves', async () => {
    const t = top()
    await load_subtree(fake_i3x(), t)

    expect(names(t)).toEqual(['Kind', 'Owner', 'Location', 'Cyber_Profile'])
    const location = t.children[2]
    expect(names(location)).toEqual(['Latitude', 'Longitude'])
    expect(location.children[0].vqt).toEqual(vqt('lat'))

    const network = t.children[3].children[0]
    expect(network.children[0].vqt).toEqual(vqt('ip'))
  })

  it('counts a leaf the server left out as not reported', async () => {
    const t = top()
    await load_subtree(fake_i3x(), t)
    const owner = t.children[1]
    expect(owner.vqt).toBe(null)
    expect(count_leaves(t)).toEqual({ leaves: 6, reported: 5 })
  })

  it('keeps a reported leaf with a null value apart from one not reported', async () => {
    const i3x = fake_i3x()
    const value = i3x.getValueBulk
    i3x.getValueBulk = async (ids, maxDepth) => (await value(ids, maxDepth))
      .map(r => {
        r.result.components.kind = { value: null, quality: 'Bad', timestamp: null }
        return r
      })
    const t = top()
    await load_subtree(i3x, t)
    expect(t.children[0].vqt).toEqual({ value: null, quality: 'Bad', timestamp: null })
    expect(leaf_state(t.children[0])).toBe('no-value')
    expect(leaf_state(t.children[1])).toBe('not-reported')
    expect(leaf_state(t.children[2].children[0])).toBe('value')
    expect(count_leaves(t)).toEqual({ leaves: 6, reported: 5 })
  })

  it('counts every leaf as not reported when the composition has no value', async () => {
    const i3x = fake_i3x()
    i3x.getValueBulk = async ids => ids.map(id =>
      ({ success: false, elementId: id, error: { code: 404, message: `No value for ${id}` } }))
    const t = top()
    await load_subtree(i3x, t)
    expect(leaf_state(t.children[0])).toBe('not-reported')
    expect(count_leaves(t)).toEqual({ leaves: 6, reported: 0 })
  })

  it('reads one level per request and the values in one request', async () => {
    const i3x = fake_i3x()
    await load_subtree(i3x, top())
    expect(i3x.calls.value).toEqual([{ ids: ['light'], maxDepth: 3 }])
    expect(i3x.calls.related.map(c => c.ids)).toEqual([
      ['light'], ['location', 'cyber'], ['network'],
    ])
    expect(i3x.calls.related.every(c => c.rel === 'i3x:rel:has-children')).toBe(true)
  })

  it('leaves compositions below the depth to be read on expand', async () => {
    const i3x = fake_i3x()
    const t = top()
    await load_subtree(i3x, t, { depth: 2 })
    const network = t.children[3].children[0]
    expect(network.children).toBe(null)
    expect(i3x.calls.value).toEqual([{ ids: ['light'], maxDepth: 2 }])

    await load_subtree(i3x, network, { depth: 2 })
    expect(names(network)).toEqual(['Address'])
    expect(network.children[0].vqt).toEqual(vqt('ip'))
  })

  it('stops reading levels once the row limit is reached', async () => {
    const t = top()
    await load_subtree(fake_i3x(), t, { max_rows: 3 })
    expect(t.children).toHaveLength(4)
    expect(t.children[2].children).toBe(null)
    expect(t.children[3].children).toBe(null)
  })

  it('treats a failed children read as an empty composition', async () => {
    const i3x = fake_i3x()
    const related = i3x.getRelatedBulk
    i3x.getRelatedBulk = async (ids, rel) => (await related(ids, rel))
      .map(r => r.elementId === 'location'
        ? { success: false, elementId: r.elementId, error: { code: 404 } }
        : r)
    const t = top()
    await load_subtree(i3x, t)
    expect(t.children[2].children).toEqual([])
    expect(names(t.children[3])).toEqual(['Network', 'Firmware'])
  })
})
