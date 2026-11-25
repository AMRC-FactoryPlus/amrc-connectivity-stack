/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Which cards the Home page offers, from the user's own ACL. A card
 * shows only when the user can see the section it leads to.
 */

import { describe, it, expect } from 'vitest'

import { make_checker, Status } from '../src/lib/access/acl.js'
import { MQTT } from '../src/lib/access/perms.js'
import { BUILD_DATASETS, READ_OBJECT } from '../src/lib/access/i3x-access.js'
import { HomeCards, home_cards } from '../src/lib/access/home-cards.js'
import { section } from '../src/lib/access/sections.js'

const DEVICE = '1a2b3c4d-0000-4000-8000-000000000001'

const ready = acl => make_checker({ status: Status.Ready, acl })
const keys = c => home_cards(c).map(card => card.key)

describe('Home cards', () => {
  it('each card is gated on a section that exists', () => {
    for (const card of HomeCards) expect(section(card.section), card.key).toBeDefined()
  })

  it('each card leads somewhere', () => {
    for (const card of HomeCards) expect(!!card.to !== !!card.href, card.key).toBe(true)
  })

  it('offers no card for Device data and Browse in i3X on one device', () => {
    const c = ready([
      { permission: READ_OBJECT, target: DEVICE },
      { permission: BUILD_DATASETS, target: DEVICE },
    ])
    expect(keys(c)).toEqual([])
  })

  it('offers no card to a user with no grants', () => {
    expect(keys(ready([]))).toEqual([])
  })

  it('offers Graph and Activity to a user who may read the whole namespace', () => {
    const c = ready([{ permission: MQTT.ReadWholeNamespace, target: DEVICE }])
    expect(keys(c)).toEqual(['graph', 'activity'])
  })

  it('offers every card to root, and when Auth is too old to say', () => {
    const all = HomeCards.map(card => card.key)
    expect(keys(make_checker({ status: Status.Ready, root: true }))).toEqual(all)
    expect(keys(make_checker({ status: Status.Unknown }))).toEqual(all)
  })

  it('offers no card while the ACL loads', () => {
    expect(keys(make_checker({ status: Status.Loading }))).toEqual([])
  })

  it('builds the visualiser address from the service client', () => {
    const graph = HomeCards.find(card => card.key === 'graph')
    expect(graph.href({ scheme: 'https', baseUrl: 'example.test' }))
      .toBe('https://visualiser.example.test')
  })
})
