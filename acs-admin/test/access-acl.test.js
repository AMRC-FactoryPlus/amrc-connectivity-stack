/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The admin UI hides controls the logged-in user can't use, from their
 * own ACL. These check the checker: exact and wildcard targets, the
 * services that accept only a wildcard grant, root, and what happens
 * before the ACL arrives or when Auth can't supply it.
 */

import { describe, it, expect } from 'vitest'

import { make_checker, Status } from '../src/lib/access/acl.js'
import { ConfigDB, WILDCARD } from '../src/lib/access/perms.js'

const P = 'a8f0a7d6-0000-4000-8000-000000000001'
const Q = 'a8f0a7d6-0000-4000-8000-000000000002'
const T = '0c0e3d2a-0000-4000-8000-000000000001'
const U = '0c0e3d2a-0000-4000-8000-000000000002'

const ready = acl => make_checker({ status: Status.Ready, acl })

describe('access checker', () => {
  it('allows a grant on the exact target only', () => {
    const c = ready([{ permission: P, target: T }])
    expect(c.can(P, T)).toBe(true)
    expect(c.can(P, U)).toBe(false)
    expect(c.can(Q, T)).toBe(false)
  })

  it('treats a wildcard grant as covering every target', () => {
    const c = ready([{ permission: P, target: WILDCARD }])
    expect(c.can(P, T)).toBe(true)
    expect(c.can_wild(P)).toBe(true)
  })

  it('needs a literal wildcard grant for can_wild', () => {
    const c = ready([{ permission: P, target: T }])
    expect(c.can_wild(P)).toBe(false)
    expect(c.can_any(P)).toBe(true)
    expect(c.can_any(Q)).toBe(false)
  })

  it('needs every pair for can_all, with null meaning any target', () => {
    const c = ready([{ permission: P, target: T }, { permission: Q, target: U }])
    expect(c.can_all([[P, T], [Q, null]])).toBe(true)
    expect(c.can_all([[P, T], [Q, T]])).toBe(false)
  })

  it('needs read and write to patch a config', () => {
    const write = ready([{ permission: ConfigDB.WriteApp, target: T }])
    expect(write.write_apps(T)).toBe(true)
    expect(write.patch_app(T)).toBe(false)
    const both = ready([
      { permission: ConfigDB.WriteApp, target: T },
      { permission: ConfigDB.ReadApp, target: T },
    ])
    expect(both.patch_app(T)).toBe(true)
  })

  it('accepts either create permission on the class', () => {
    expect(ready([{ permission: ConfigDB.CreateObj, target: T }]).create_in(T)).toBe(true)
    expect(ready([{ permission: ConfigDB.CreateSpecificObj, target: T }]).create_in(T)).toBe(true)
    expect(ready([]).create_in(T)).toBe(false)
  })

  it('allows everything for root', () => {
    const c = make_checker({ status: Status.Ready, root: true, acl: [] })
    expect(c.can(P, T)).toBe(true)
    expect(c.can_wild(P)).toBe(true)
  })

  it('allows nothing while loading', () => {
    const c = make_checker({ status: Status.Loading })
    expect(c.can(P, T)).toBe(false)
    expect(c.can_any(P)).toBe(false)
  })

  it('allows everything when Auth cannot say, as before', () => {
    const c = make_checker({ status: Status.Unknown })
    expect(c.can(P, T)).toBe(true)
    expect(c.can_wild(P)).toBe(true)
  })
})
