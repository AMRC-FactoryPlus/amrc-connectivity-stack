/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The access store loads the user's own ACL from Auth. These check it
 * drops a load that finishes after logout, falls back to showing
 * everything only for an Auth without the endpoint, and keeps
 * controls hidden and retries when Auth is briefly unreachable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Subject } from 'rxjs'

import { useAccessStore } from '../src/store/useAccessStore.js'
import { Status } from '../src/lib/access/acl.js'

const P = 'a8f0a7d6-0000-4000-8000-000000000001'
const T = '0c0e3d2a-0000-4000-8000-000000000001'
const BODY = { principal: 'me', root: false, acl: [{ permission: P, target: T }] }

/* A client whose fetch resolves when the test says so. */
function client () {
  let resolve
  const updates = new Subject()
  return {
    resolve: v => resolve(v),
    updates,
    Auth: {
      fetch: () => new Promise(r => { resolve = r }),
      notify: { watch_full: () => updates },
    },
  }
}

describe('access store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('applies the ACL and follows updates', async () => {
    const a = useAccessStore()
    const c = client()
    const done = a.load(c, a.generation, 0)
    c.resolve([200, BODY])
    await done
    expect(a.check.can(P, T)).toBe(true)
    c.updates.next({ status: 200, body: { ...BODY, acl: [] } })
    expect(a.check.can(P, T)).toBe(false)
  })

  it('drops a load that finishes after logout', async () => {
    const a = useAccessStore()
    const c = client()
    const done = a.load(c, a.generation, 0)
    a.stop()
    c.resolve([200, BODY])
    await done
    expect(a.check.status).toBe(Status.Loading)
    expect(a.subscription).toBe(null)
  })

  it('shows everything against an Auth without the endpoint', async () => {
    const a = useAccessStore()
    const c = client()
    const done = a.load(c, a.generation, 0)
    c.resolve([404, null])
    await done
    expect(a.check.status).toBe(Status.Unknown)
  })

  it('keeps controls hidden and retries when Auth is unreachable', async () => {
    vi.useFakeTimers()
    try {
      const a = useAccessStore()
      const c = client()
      const done = a.load(c, a.generation, 0)
      c.resolve([503, null])
      await done
      expect(a.check.status).toBe(Status.Loading)
      vi.advanceTimersByTime(2000)
      c.resolve([200, BODY])
      await vi.runAllTimersAsync()
      expect(a.check.can(P, T)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
