/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Who can read a device or ISA-95 node through i3X. The vocabulary
 * match must give the same nodes acs-i3x resolves grants through, or
 * the panel would list grants that do not apply, or miss ones that do.
 */

import { describe, it, expect } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { resolve_isa95, isa95_path, read_access, READ_OBJECT, I3X_PERM_ALL }
  from '../src/lib/access/i3x-access.js'

const NODES = [
  { uuid: 'amrc', name: 'AMRC', aliases: [], children: ['f2050'], level: 'Enterprise' },
  { uuid: 'f2050', name: 'Factory 2050', aliases: ['F2050'], children: ['north'], level: 'Site' },
  { uuid: 'north', name: 'North', aliases: [], children: [], level: 'Area' },
  { uuid: 'other', name: 'Other', aliases: [], children: [], level: 'Enterprise' },
  { uuid: 'stray', name: 'North', aliases: [], children: [], level: 'Area' },
]

describe('resolve_isa95', () => {
  it('matches level by level under the parent, ignoring case, by name or alias', () => {
    expect(resolve_isa95(NODES, ['amrc', 'f2050', 'NORTH']).map(n => n.uuid))
      .toEqual(['amrc', 'f2050', 'north'])
  })

  it('stops at the first name that does not match', () => {
    expect(resolve_isa95(NODES, ['AMRC', 'Elsewhere', 'North']).map(n => n.uuid)).toEqual(['amrc'])
    expect(resolve_isa95(NODES, ['North'])).toEqual([])
  })
})

describe('isa95_path', () => {
  it('lists the nodes from the top down to the node', () => {
    expect(isa95_path(NODES, 'north').map(n => n.uuid)).toEqual(['amrc', 'f2050', 'north'])
    expect(isa95_path(NODES, 'other').map(n => n.uuid)).toEqual(['other'])
  })
})

describe('read_access', () => {
  const GRANTS = {
    g1: { principal: 'alice', permission: READ_OBJECT, target: 'dev', plural: false },
    g2: { principal: 'site-team', permission: READ_OBJECT, target: 'f2050', plural: false },
    g3: { principal: 'admins', permission: I3X_PERM_ALL, target: UUIDs.Special.Null, plural: false },
    g4: { principal: 'robots', permission: READ_OBJECT, target: 'robot-class', plural: true },
    g5: { principal: 'others', permission: READ_OBJECT, target: 'other-class', plural: true },
    g6: { principal: 'bob', permission: 'something-else', target: 'dev', plural: false },
  }
  const client = {
    Auth: {
      async find_grants (p) {
        return Object.entries(GRANTS)
          .filter(([, g]) => Object.entries(p).every(([k, v]) => g[k] === v))
          .map(([id]) => id)
      },
      async get_grant (id) { return GRANTS[id] },
    },
    ConfigDB: {
      async class_has_member (klass, obj) { return klass === 'robot-class' && obj === 'dev' },
    },
  }

  it('lists each grant that lets someone read the device, with why', async () => {
    const rows = await read_access(client, {
      target: { uuid: 'dev', device: true },
      via: [NODES[0], NODES[1]],
    })
    expect(rows.map(r => [r.grant.principal, r.reason, r.through?.uuid ?? null])).toEqual([
      ['alice', 'direct', null],
      ['site-team', 'node', 'f2050'],
      ['admins', 'all', null],
      ['robots', 'class', null],
    ])
  })

  it('checks class grants only for a device', async () => {
    const rows = await read_access(client, { target: { uuid: 'f2050', device: false } })
    expect(rows.map(r => [r.grant.principal, r.reason])).toEqual([
      ['site-team', 'direct'],
      ['admins', 'all'],
    ])
  })
})
