/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Device data: the access dialog's two halves of access to a device,
 * "Browse in i3X" (i3X ReadObject) and "Build datasets from it" (Data
 * Access UseDevice). Getting these wrong would give or remove the
 * wrong half, or let the dialog remove a grant service setup owns.
 */

import { describe, it, expect } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { read_access, by_principal } from '../src/lib/access/i3x-access.js'
import {
  READ_OBJECT, I3X_PERM_ALL, BUILD_DATASETS, DATA_ACCESS_ALL, DEVICE_DATA,
  DATASET_MAKER, DATASET_MANAGER, CREATE_DATASET, USE_FOR_SESSION,
  allows, route_halves, grant_permission, without_half, remove_half,
  entry_halves, halves_on, missing_halves,
} from '../src/lib/access/device-data.js'

describe('permission UUIDs', () => {
  it('match acs-service-setup', () => {
    expect(BUILD_DATASETS).toBe('788b049c-2831-11f1-99fd-2b0bf86d6f77')
    expect(DATA_ACCESS_ALL).toBe('1e3cb5aa-a3f7-4bb6-9ef1-c3bc08427f60')
    expect(DEVICE_DATA).toBe('6abc1879-429d-4c0f-a5e4-00a655a09f26')
    expect(CREATE_DATASET).toBe('2d666b41-7a0d-4845-ad59-3113f25b469a')
    expect(USE_FOR_SESSION).toBe('c089b9a9-06cd-4211-94fc-9ad52a759987')
    expect(DATASET_MAKER).toBe('b7aa3036-fc1f-4869-b0f5-50f28b028905')
    expect(DATASET_MANAGER).toBe('4ab8468a-166b-4c01-afa6-7bd558db806b')
  })
})

describe('allows', () => {
  it('says which half each permission gives', () => {
    expect(allows({ permission: READ_OBJECT })).toEqual(['i3x'])
    expect(allows({ permission: I3X_PERM_ALL })).toEqual(['i3x'])
    expect(allows({ permission: BUILD_DATASETS })).toEqual(['datasets'])
    expect(allows({ permission: DATA_ACCESS_ALL })).toEqual(['datasets'])
    expect(allows({ permission: DEVICE_DATA })).toEqual(['i3x', 'datasets'])
    expect(allows({ permission: 'something-else' })).toEqual([])
    expect(allows(null)).toEqual([])
  })
})

describe('route_halves', () => {
  const row = (permission, reason) => ({ grant: { permission }, reason })

  it('gives both halves for a grant on the device, a class or everything', () => {
    for (const reason of ['direct', 'class', 'all'])
      expect(route_halves(row(DEVICE_DATA, reason), true)).toEqual(['i3x', 'datasets'])
  })

  it('never gives Datasets through an ISA-95 node, which Data Access does not use', () => {
    expect(route_halves(row(DEVICE_DATA, 'node'), true)).toEqual(['i3x'])
    expect(route_halves(row(BUILD_DATASETS, 'node'), true)).toEqual([])
  })

  it('never gives Datasets when the target is not a device', () => {
    expect(route_halves(row(DEVICE_DATA, 'direct'), false)).toEqual(['i3x'])
  })
})

describe('grant_permission', () => {
  it('gives the composite for both halves, and one permission for one', () => {
    expect(grant_permission({ browse: true, build: true })).toBe(DEVICE_DATA)
    expect(grant_permission({ browse: true, build: false })).toBe(READ_OBJECT)
    expect(grant_permission({ browse: false, build: true })).toBe(BUILD_DATASETS)
    expect(grant_permission({ browse: false, build: false })).toBe(null)
  })
})

describe('without_half', () => {
  it('keeps the other half of the composite', () => {
    expect(without_half({ permission: DEVICE_DATA }, 'i3x')).toEqual({ set: BUILD_DATASETS })
    expect(without_half({ permission: DEVICE_DATA }, 'datasets')).toEqual({ set: READ_OBJECT })
  })

  it('deletes a grant that gives only that half', () => {
    expect(without_half({ permission: READ_OBJECT }, 'i3x')).toEqual({ delete: true })
    expect(without_half({ permission: I3X_PERM_ALL }, 'i3x')).toEqual({ delete: true })
    expect(without_half({ permission: BUILD_DATASETS }, 'datasets')).toEqual({ delete: true })
    expect(without_half({ permission: DATA_ACCESS_ALL }, 'datasets')).toEqual({ delete: true })
  })

  it('does nothing to a grant without that half', () => {
    expect(without_half({ permission: READ_OBJECT }, 'datasets')).toBe(null)
    expect(without_half({ permission: BUILD_DATASETS }, 'i3x')).toBe(null)
  })

  it('does not keep a half the grant cannot give where it is', () => {
    expect(without_half({ permission: DEVICE_DATA }, 'i3x', ['i3x'])).toEqual({ delete: true })
  })
})

/* A fake Auth client that records writes. */
function fake_auth (grants = {}) {
  const calls = []
  return {
    calls,
    async find_grants (p) {
      return Object.entries(grants)
        .filter(([, g]) => Object.entries(p).every(([k, v]) => g[k] === v))
        .map(([id]) => id)
    },
    async get_grant (id) { return grants[id] },
    async set_grant (uuid, grant) { calls.push(['set', uuid, grant]) },
    async delete_grant (uuid) { calls.push(['delete', uuid]) },
    async check_acl (principal, permission, target, wild) {
      calls.push(['check', principal, permission, target, wild])
      return principal === 'maker'
    },
  }
}

describe('remove_half', () => {
  const g = { uuid: 'g1', principal: 'pat', permission: DEVICE_DATA, target: 'dev', plural: false }

  it('replaces the composite with the other half, sending only grant fields', async () => {
    const auth = fake_auth()
    const out = await remove_half(auth, { grant: g, reason: 'direct' }, 'i3x', true)
    expect(out).toEqual({ set: BUILD_DATASETS })
    expect(auth.calls).toEqual([
      ['set', 'g1', { principal: 'pat', permission: BUILD_DATASETS, target: 'dev', plural: false }],
    ])
  })

  it('deletes a grant left with nothing', async () => {
    const auth = fake_auth()
    await remove_half(auth, { grant: { ...g, permission: READ_OBJECT }, reason: 'direct' }, 'i3x', true)
    expect(auth.calls).toEqual([['delete', 'g1']])
  })

  it('deletes the composite on an ISA-95 node, where Datasets does nothing', async () => {
    const auth = fake_auth()
    await remove_half(auth, { grant: g, reason: 'direct' }, 'i3x', false)
    expect(auth.calls).toEqual([['delete', 'g1']])
  })

  it('writes nothing for a half the grant does not give', async () => {
    const auth = fake_auth()
    const out = await remove_half(auth, { grant: { ...g, permission: READ_OBJECT }, reason: 'direct' }, 'datasets', true)
    expect(out).toBe(null)
    expect(auth.calls).toEqual([])
  })
})

describe('read_access with Device data', () => {
  const DEVICE_CLASS = UUIDs.Class.Device
  const GRANTS = {
    d1: { principal: 'pat', permission: DEVICE_DATA, target: 'dev', plural: false },
    d2: { principal: 'lee', permission: BUILD_DATASETS, target: 'dev', plural: false },
    d3: { principal: 'kim', permission: READ_OBJECT, target: 'dev', plural: false },
    n1: { principal: 'area-team', permission: DEVICE_DATA, target: 'area', plural: false },
    w1: { principal: 'admins', permission: DATA_ACCESS_ALL, target: UUIDs.Special.Null, plural: false },
    r1: { principal: DATASET_MAKER, permission: BUILD_DATASETS, target: DEVICE_CLASS, plural: true },
    r2: { principal: DATASET_MAKER, permission: READ_OBJECT, target: DEVICE_CLASS, plural: true },
    r3: { principal: DATASET_MANAGER, permission: BUILD_DATASETS, target: DEVICE_CLASS, plural: true },
    x1: { principal: 'other', permission: CREATE_DATASET, target: 'dev', plural: false },
  }
  const client = {
    Auth: fake_auth(GRANTS),
    ConfigDB: {
      async class_has_member (klass, obj) { return klass === DEVICE_CLASS && obj === 'dev' },
    },
  }
  const opts = { target: { uuid: 'dev', device: true }, via: [{ uuid: 'area', name: 'Area 1' }] }

  it('lists i3X and Data Access grants, and marks the dataset roles', async () => {
    const rows = await read_access(client, opts)
    const key = r => [r.grant.principal, r.reason, r.role]
    expect(rows.map(key)).toEqual(expect.arrayContaining([
      ['pat', 'direct', false],
      ['lee', 'direct', false],
      ['kim', 'direct', false],
      ['area-team', 'node', false],
      ['admins', 'all', false],
      [DATASET_MAKER, 'class', true],
      [DATASET_MANAGER, 'class', true],
    ]))
    expect(rows.some(r => r.grant.principal === 'other')).toBe(false)
  })

  it('gives each principal its halves, with role rows never removable', async () => {
    const people = by_principal(await read_access(client, opts))
    const halves = p => entry_halves(people.find(e => e.principal === p), true)
      .map(h => [h.half, h.direct.length, h.elsewhere, h.removable])

    expect(halves('pat')).toEqual([['i3x', 1, false, true], ['datasets', 1, false, true]])
    expect(halves('lee')).toEqual([['datasets', 1, false, true]])
    expect(halves('kim')).toEqual([['i3x', 1, false, true]])
    expect(halves('area-team')).toEqual([['i3x', 0, true, false]])
    expect(halves('admins')).toEqual([['datasets', 0, true, false]])
    expect(halves(DATASET_MAKER)).toEqual([['i3x', 0, true, false], ['datasets', 0, true, false]])
  })
})

describe('entry_halves', () => {
  it('says a half is held elsewhere too when another route gives it', () => {
    const entry = { principal: 'pat', routes: [
      { grant: { uuid: 'a', permission: READ_OBJECT }, reason: 'direct', role: false },
      { grant: { uuid: 'b', permission: DEVICE_DATA }, reason: 'class', role: false },
    ] }
    expect(entry_halves(entry, true).map(h => [h.half, h.direct.map(r => r.grant.uuid), h.elsewhere, h.removable]))
      .toEqual([['i3x', ['a'], true, true], ['datasets', [], true, false]])
  })

  it('never lets a role entry be changed, even with a grant on the device', () => {
    const entry = { principal: DATASET_MAKER, routes: [
      { grant: { uuid: 'a', permission: READ_OBJECT }, reason: 'direct', role: true },
    ] }
    expect(entry_halves(entry, true)[0].removable).toBe(false)
  })

  it('gives labels for the tags', () => {
    const entry = { principal: 'pat', routes: [{ grant: { permission: DEVICE_DATA }, reason: 'direct' }] }
    expect(entry_halves(entry, true).map(h => h.label)).toEqual(['i3X', 'Datasets'])
  })
})

describe('halves_on and missing_halves', () => {
  const rows = [
    { grant: { principal: 'pat', permission: READ_OBJECT }, reason: 'direct', through: null },
    { grant: { principal: 'pat', permission: DEVICE_DATA }, reason: 'node', through: { uuid: 'area' } },
    { grant: { principal: 'lee', permission: BUILD_DATASETS }, reason: 'all', through: null },
  ]

  it('counts only grants on the chosen scope', () => {
    expect([...halves_on(rows, 'pat', 'dev', 'dev', true)]).toEqual(['i3x'])
    expect([...halves_on(rows, 'pat', 'area', 'dev', true)]).toEqual(['i3x'])
    expect([...halves_on(rows, 'lee', 'dev', 'dev', true)]).toEqual([])
  })

  it('gives only the halves not already held there', () => {
    const held = halves_on(rows, 'pat', 'dev', 'dev', true)
    expect(missing_halves({ browse: true, build: true }, held)).toEqual({ browse: false, build: true })
    expect(missing_halves({ browse: true, build: false }, held)).toEqual({ browse: false, build: false })
    expect(missing_halves({ browse: true, build: true }, new Set())).toEqual({ browse: true, build: true })
  })
})
