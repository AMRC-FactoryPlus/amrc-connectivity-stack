/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The snapshot worker. load.js runs snapshot.js's source text, with a
 * message handler added, as a module worker from a blob URL. This runs
 * that same text as a module with a stand-in `self`, so a change that
 * gives snapshot.js an import, or breaks the handler, fails here.
 */

import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'

import { WORKER_SOURCE } from '../src/lib/scout/load.js'

const HEADER = {
  version: 1, scan: '3f9c1a2b-44e0-4d0c-9a7e-5b1f2c3d4e5f', connection: '5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a',
  driver: null, started: '2026-11-24T10:41:00Z', root: null, folder_id: null, options: {},
}
const END = { end: { finished: '2026-11-24T10:42:13Z', exhaustive: true, truncated: false, reason: null,
  excluded: [], rejected: 0, items: 1, branches: [] } }
const ITEM = { id: 'a', parent: null, name: 'a', kind: 'value', address: 'a' }

describe('the snapshot worker source', () => {
  it('imports nothing, so it runs without bundling', () => {
    expect(WORKER_SOURCE).not.toMatch(/^\s*import\s/m)
  })

  it('answers a message with the parsed, indexed snapshot', async () => {
    const posted = []
    globalThis.self = { postMessage: m => posted.push(m) }
    try {
      await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`)
      const bytes = zlib.gzipSync([HEADER, ITEM, END].map(l => JSON.stringify(l)).join('\n'))
      await globalThis.self.onmessage({ data: { id: 7, bytes } })
      await globalThis.self.onmessage({ data: { id: 8, bytes: zlib.gzipSync('nonsense') } })
    }
    finally {
      delete globalThis.self
    }
    expect(posted[0]).toMatchObject({ id: 7, ok: true, snapshot: { valid: true } })
    expect(posted[0].snapshot.index.by_id.get('a').address).toBe('a')
    expect(posted[1]).toMatchObject({ id: 8, ok: true, snapshot: { valid: false } })
  })
})
