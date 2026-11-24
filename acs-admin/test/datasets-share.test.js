/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The Share card on a dataset's Use tab: the grants a share adds, and
 * the grants it lists. "Use for sessions" must add a second grant on
 * the dataset only, which is all making session datasets from it needs.
 */

import { describe, it, expect } from 'vitest'

import {
  SHARE_PERMS, share_grants, share_lists, load_share_grants,
} from '../src/components/Datasets/page/share-logic.js'
import { READ_DATASET } from '../src/components/Datasets/page/page-logic.js'
import { CREATE_DATASET, USE_FOR_SESSION } from '../src/lib/access/device-data.js'

const DS = 'dddddddd-0000-4000-8000-000000000001'
const OTHER = 'dddddddd-0000-4000-8000-000000000002'

describe('share_grants', () => {
  it('grants Read dataset on the dataset', () => {
    expect(share_grants({ principal: 'pat', dataset: DS, session: false })).toEqual([
      { principal: 'pat', permission: READ_DATASET, target: DS, plural: false },
    ])
  })

  it('adds Use for session on the dataset when ticked', () => {
    expect(share_grants({ principal: 'pat', dataset: DS, session: true })).toEqual([
      { principal: 'pat', permission: READ_DATASET, target: DS, plural: false },
      { principal: 'pat', permission: USE_FOR_SESSION, target: DS, plural: false },
    ])
  })
})

describe('share_lists', () => {
  const g = (uuid, principal, permission, target = DS, plural = false) =>
    ({ uuid, principal, permission, target, plural })

  it('lists readers and session users of this dataset, each once', () => {
    const lists = share_lists([
      g('g1', 'pat', READ_DATASET),
      g('g2', 'lee', READ_DATASET),
      g('g3', 'pat', READ_DATASET),
      g('g4', 'pat', USE_FOR_SESSION),
      g('g5', 'kim', READ_DATASET, OTHER),
      g('g6', 'sam', READ_DATASET, DS, true),
      g('g7', 'max', CREATE_DATASET),
    ], DS)
    expect(lists.map(l => [l.id, l.grants.map(x => x.uuid)])).toEqual([
      ['read', ['g1', 'g2']],
      ['session', ['g4']],
    ])
    expect(lists.map(l => l.label)).toEqual(SHARE_PERMS.map(p => p.label))
  })

  it('gives empty lists when there are no grants', () => {
    expect(share_lists(null, DS).map(l => l.grants)).toEqual([[], []])
  })
})

describe('load_share_grants', () => {
  it('reads both kinds of grant, and skips any it cannot read', async () => {
    const GRANTS = {
      g1: { principal: 'pat', permission: READ_DATASET, target: DS, plural: false },
      g2: { principal: 'pat', permission: USE_FOR_SESSION, target: DS, plural: false },
    }
    const auth = {
      async find_grants (p) {
        const ids = Object.entries(GRANTS)
          .filter(([, x]) => x.permission === p.permission && x.target === p.target)
          .map(([id]) => id)
        return p.permission === READ_DATASET ? [...ids, 'gone'] : ids
      },
      async get_grant (id) {
        if (!GRANTS[id]) throw new Error('No such grant')
        return GRANTS[id]
      },
    }
    const out = await load_share_grants(auth, DS)
    expect(out.map(x => x.uuid)).toEqual(['g1', 'g2'])
  })
})
