/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Before a dialog lets someone type a password that will be sealed into
 * an edge cluster's secret, it checks whether they hold Manage secrets
 * or Create secrets on that cluster. Only a definite no turns the fields
 * off: the Auth service hides grants of permissions the caller can't
 * read, so a missing grant means no only when the caller can read that
 * permission. Anything else is unknown and the fields stay on.
 */

import { describe, it, expect } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'

import {
  SecretPerm, load_secret_access, secret_access,
} from '../src/lib/edge-secrets.js'

const CLUSTER = '29d7cfc4-4a10-4041-adf6-03e79b45328a'
const OTHER = '5bb3a3d1-2a4b-4e1e-a8e2-0f0c4a7a1f6e'
const WILDCARD = '00000000-0000-0000-0000-000000000000'
const READ_ACL = UUIDs.Permission.Auth.ReadACL
const EITHER = [SecretPerm.Manage, SecretPerm.Create]

const ace = (permission, target) => ({ permission, target })

/* Read ACL on both secret permissions, so their absence is meaningful. */
const can_read = [ace(READ_ACL, SecretPerm.Manage), ace(READ_ACL, SecretPerm.Create)]

describe('deciding from an ACL whether secrets can be saved', () => {
  it('allows Create secrets on the cluster', () => {
    expect(secret_access([ace(SecretPerm.Create, CLUSTER)], CLUSTER, EITHER)).toBe(true)
  })

  it('allows Manage secrets on the cluster', () => {
    expect(secret_access([ace(SecretPerm.Manage, CLUSTER)], CLUSTER, EITHER)).toBe(true)
  })

  it('allows a wildcard grant', () => {
    expect(secret_access([ace(SecretPerm.Create, WILDCARD)], CLUSTER, EITHER)).toBe(true)
  })

  it('refuses when the caller can see there is no grant', () => {
    expect(secret_access(can_read, CLUSTER, EITHER)).toBe(false)
  })

  it('refuses a grant on another cluster', () => {
    const acl = [...can_read, ace(SecretPerm.Manage, OTHER)]
    expect(secret_access(acl, CLUSTER, EITHER)).toBe(false)
  })

  it('treats wildcard Read ACL as able to see every grant', () => {
    expect(secret_access([ace(READ_ACL, WILDCARD)], CLUSTER, EITHER)).toBe(false)
  })

  it('can\'t tell when the caller can\'t read the permissions', () => {
    expect(secret_access([], CLUSTER, EITHER)).toBe(null)
  })

  it('can\'t tell when the caller can read only one of them', () => {
    const acl = [ace(READ_ACL, SecretPerm.Manage)]
    expect(secret_access(acl, CLUSTER, EITHER)).toBe(null)
  })

  it('does not take Create secrets where Manage secrets is needed', () => {
    const acl = [...can_read, ace(SecretPerm.Create, CLUSTER)]
    expect(secret_access(acl, CLUSTER, [SecretPerm.Manage])).toBe(false)
  })

  it('can\'t tell without an ACL or a cluster', () => {
    expect(secret_access(undefined, CLUSTER, EITHER)).toBe(null)
    expect(secret_access([ace(SecretPerm.Create, CLUSTER)], null, EITHER)).toBe(null)
  })
})

function fake_client ({ me = 'b8e1e4a8-3e0b-4b2e-9d55-3b1f3c1b9b11', status = 200, acl = [], fail } = {}) {
  const calls = []
  return {
    calls,
    Auth: {
      async whoami_uuid () {
        if (fail === 'whoami') throw new Error('no principal')
        return me
      },
      async fetch (url) {
        calls.push(url)
        if (fail === 'fetch') throw new Error('offline')
        return [status, acl]
      },
    },
  }
}

describe('looking up the signed-in user\'s access', () => {
  it('reads the user\'s own ACL by principal UUID', async () => {
    const client = fake_client({ acl: [ace(SecretPerm.Create, CLUSTER)] })
    expect(await load_secret_access(client, CLUSTER, EITHER)).toBe(true)
    expect(client.calls).toEqual(['v2/acl/b8e1e4a8-3e0b-4b2e-9d55-3b1f3c1b9b11'])
  })

  it('gives a definite no from a readable ACL', async () => {
    const client = fake_client({ acl: can_read })
    expect(await load_secret_access(client, CLUSTER, EITHER)).toBe(false)
  })

  it.each([403, 404, 500])('can\'t tell when the ACL read gives %i', async status => {
    expect(await load_secret_access(fake_client({ status }), CLUSTER, EITHER)).toBe(null)
  })

  it.each(['whoami', 'fetch'])('can\'t tell when %s throws', async fail => {
    expect(await load_secret_access(fake_client({ fail }), CLUSTER, EITHER)).toBe(null)
  })
})
