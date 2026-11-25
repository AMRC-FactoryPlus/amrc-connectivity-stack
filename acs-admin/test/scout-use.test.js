/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * useScout, with fake CmdEsc, ConfigDB watches, births and Files.
 *
 * Each row of the spec's states table is driven through the composable
 * rather than the pure state function, so the wiring between the sources
 * and the state is what is under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import * as rx from 'rxjs'

import { create_scout, real_deps } from '../src/composables/useScout.js'
import { Scout, SCOUT_METRIC, WAIT_MS } from '../src/lib/scout/constants.js'
import { build_index } from '../src/lib/scout/model.js'

const NODE = '9b2e4c6d-1f3a-4b5c-8d7e-6f5a4b3c2d1e'
const CONN = '5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a'
const ADDR = 'Group/Agent'

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/* A fake world. Every source is a Subject the test pushes into. */
function world ({ acl = true, online = true, config = { deviceConnections: [{ uuid: CONN }] } } = {}) {
  const status = new rx.BehaviorSubject(null)
  const agent = new rx.BehaviorSubject(config)
  const node = new rx.Subject()
  const sent = []
  const loads = []
  let clock = 1_000_000
  let ids = 0
  const deps = {
    watch_status: vi.fn(() => status),
    watch_agent_config: vi.fn(() => agent),
    watch_node: vi.fn(() => node),
    node_online: vi.fn(async () => online),
    can_scout: vi.fn(async () => acl),
    send: vi.fn(async (addr, body) => { sent.push({ addr, body }) }),
    load: vi.fn(async file => {
      loads.push(file)
      const items = [
        { id: 'A', parent: null, name: 'A', kind: 'folder' },
        { id: `A/${file}`, parent: 'A', name: file, kind: 'value', address: `A/${file}` },
      ]
      return { valid: true, problems: [], header: { options: { x: 1 } }, end: {}, items, index: build_index(items) }
    }),
    uuid: () => `req-${++ids}`,
  }
  const now = () => clock
  const advance = ms => { clock += ms }
  return { status, agent, node, sent, loads, deps, now, advance }
}

const make = (w, driver = {}) => create_scout({
  deps: w.deps, node: NODE, connection: CONN, address: ADDR, driver, now: w.now,
})

const entry = over => ({ version: 1, node: NODE, supported: true, ...over })
const birth = (metrics = [{ name: SCOUT_METRIC }]) => ({ type: 'BIRTH', metrics })

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => vi.useRealTimers())

describe('useScout states', () => {
  it('is hidden when the DriverDef says scout: false', async () => {
    const w = world()
    const s = make(w, { scout: false })
    await flush()
    expect(s.state.value.state).toBe('hidden')
    s.stop()
  })

  it('goes offline on NDEATH and back on NBIRTH', async () => {
    const w = world()
    const s = make(w)
    await flush()
    expect(s.state.value.state).toBe('never')
    w.node.next({ type: 'DEATH' })
    expect(s.state.value.state).toBe('offline')
    w.node.next(birth())
    expect(s.state.value.state).toBe('never')
    s.stop()
  })

  it('takes the first online state from the Directory', async () => {
    const w = world({ online: false })
    const s = make(w)
    await flush()
    expect(s.state.value.state).toBe('offline')
    s.stop()
  })

  it('says the agent is too old when its NBIRTH has no Node Control/Scout', async () => {
    const w = world()
    const s = make(w)
    await flush()
    w.node.next(birth([{ name: 'Node Control/Rebirth' }]))
    expect(s.state.value.state).toBe('agent_old')
    s.stop()
  })

  it('ignores an entry written by another node', async () => {
    const w = world()
    const s = make(w)
    await flush()
    w.status.next(entry({ node: 'someone-else', current: { file: 'f1', items: 2 } }))
    await flush()
    expect(s.state.value.state).toBe('never')
    expect(s.trusted.value).toBe(false)
    expect(s.status.value).toBeNull()
    expect(w.deps.load).not.toHaveBeenCalled()
    expect(s.summary.value.available).toBe(false)
    s.stop()
  })

  it('says not deployed when the agent config lacks the connection', async () => {
    const w = world({ config: { deviceConnections: [] } })
    const s = make(w)
    await flush()
    expect(s.state.value.state).toBe('undeployed')
    w.agent.next({ deviceConnections: [{ uuid: CONN }] })
    expect(s.state.value.state).toBe('never')
    s.stop()
  })

  it('shows unsupported, driver too old and driver not running', async () => {
    const w = world()
    const s = make(w)
    await flush()
    w.status.next(entry({ supported: false }))
    expect(s.state.value.state).toBe('unsupported')
    w.status.next(entry({ supported: 'library' }))
    expect(s.state.value.state).toBe('driver_old')
    w.status.next(entry({ last_request: { request: 'x', code: 'NODRIVER', message: 'CONF', at: 't' } }))
    expect(s.state.value).toMatchObject({ state: 'driver_down', message: 'CONF' })
    s.stop()
  })

  it('disables scanning without the permission but still loads snapshots', async () => {
    const w = world({ acl: false })
    const s = make(w)
    await flush()
    w.status.next(entry({ scan: 's', state: 'done', current: { file: 'f1', items: 2 } }))
    await flush()
    expect(s.state.value.state).toBe('no_permission')
    expect(s.current_index.value.by_id.has('A/f1')).toBe(true)
    s.stop()
  })

  it('sends a start through cmdesc and follows it to done', async () => {
    const w = world()
    const s = make(w)
    await flush()
    await s.start({ options: { include_server: false } })
    expect(w.sent).toEqual([{
      addr: ADDR,
      body: { version: 1, op: 'start', request: 'req-1', connection: CONN,
        root: null, folder_id: null, options: { include_server: false }, limits: { samples: true } },
    }])
    expect(s.state.value.state).toBe('sending')

    w.status.next(entry({ scan: 's1', request: 'req-1', state: 'queued',
      last_request: { request: 'req-1', code: null, message: null, at: 't' } }))
    await flush()
    expect(s.pending.value).toBeNull()
    expect(s.state.value.state).toBe('queued')

    w.status.next(entry({ scan: 's1', request: 'req-1', state: 'running',
      progress: { visited: 10, found: 3, note: null } }))
    expect(s.state.value.state).toBe('running')

    w.status.next(entry({ scan: 's1', request: 'req-1', state: 'done',
      current: { file: 'f1', items: 2 } }))
    await flush()
    expect(s.state.value.state).toBe('done')
    expect(w.loads).toEqual(['f1'])
    s.stop()
  })

  it('says waiting when the agent records nothing for 15 s', async () => {
    const w = world()
    const s = make(w)
    await flush()
    await s.start()
    w.advance(WAIT_MS)
    vi.advanceTimersByTime(1000)
    expect(s.state.value.state).toBe('waiting')
    s.stop()
  })

  it('shows this browser\'s refusal, and a second browser keeps the live scan', async () => {
    const w = world()
    const first = make(w)
    const second = make(w)
    await flush()
    w.status.next(entry({ scan: 's1', request: 'req-a', state: 'running',
      last_request: { request: 'req-a', code: null, message: null, at: 't' } }))
    await flush()

    await second.start()
    const mine = w.sent.at(-1).body.request
    w.status.next(entry({ scan: 's1', request: 'req-a', state: 'running',
      last_request: { request: mine, code: 'BUSY', message: null, at: 't' } }))
    await flush()

    expect(second.state.value).toMatchObject({ state: 'refused', code: 'BUSY' })
    expect(first.state.value.state).toBe('running')

    second.forget()
    expect(second.state.value.state).toBe('running')
    first.stop()
    second.stop()
  })

  it('forgets a refusal once another request replaces it', async () => {
    const w = world()
    const s = make(w)
    await flush()
    await s.start()
    w.status.next(entry({ scan: 's1', request: 'other', state: 'running',
      last_request: { request: 'req-1', code: 'BUSY', message: null, at: 't' } }))
    await flush()
    expect(s.state.value.state).toBe('refused')
    w.status.next(entry({ scan: 's2', request: 'later', state: 'running',
      last_request: { request: 'later', code: null, message: null, at: 't' } }))
    await flush()
    expect(s.pending.value).toBeNull()
    expect(s.state.value.state).toBe('running')
    s.stop()
  })

  it('sends a cancel', async () => {
    const w = world()
    const s = make(w)
    await flush()
    await s.cancel()
    expect(w.sent[0].body).toEqual({ version: 1, op: 'cancel', request: 'req-1', connection: CONN })
    s.stop()
  })

  it('sends a branch scan with the folder and the current options', async () => {
    const w = world()
    const s = make(w)
    await flush()
    w.status.next(entry({ scan: 's', state: 'done', current: { file: 'f1', items: 2 } }))
    await flush()
    await s.scan_branch({ id: 'A', root: 'A/#' })
    expect(w.sent[0].body).toMatchObject({ root: 'A/#', folder_id: 'A', options: { x: 1 } })
    s.stop()
  })

  it('reports a cmdesc refusal without leaving a pending request', async () => {
    const w = world()
    w.deps.send.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }))
    const s = make(w)
    await flush()
    expect(await s.start()).toBe(false)
    expect(s.pending.value).toBeNull()
    expect(s.send_error.value).toMatch(/Scan device addresses/)
    s.stop()
  })

  it('clears a send error once the agent writes a newer status', async () => {
    const w = world()
    w.status.next(entry({ scan: 's1', request: 'r0', state: 'done', current: { file: 'f1', items: 1 } }))
    w.deps.send.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 0 }))
    const s = make(w)
    await flush()
    expect(await s.start()).toBe(false)
    expect(s.send_error.value).toBe('The request did not reach the Edge Agent (0).')

    /* The same entry again, such as a watch reconnecting, keeps it. */
    w.status.next(entry({ scan: 's1', request: 'r0', state: 'done', current: { file: 'f1', items: 1 } }))
    await flush()
    expect(s.send_error.value).not.toBeNull()

    /* A later scan, started from elsewhere, finishes. */
    w.status.next(entry({ scan: 's2', request: 'r9', state: 'done', current: { file: 'f2', items: 1 } }))
    await flush()
    expect(s.send_error.value).toBeNull()
    s.stop()
  })

  it('shows failed, cancelled and interrupted with the previous snapshot', async () => {
    const w = world()
    const s = make(w)
    await flush()
    const base = { scan: 's2', current: { file: 'f1', items: 2 } }
    w.status.next(entry({ ...base, state: 'failed', code: 'TIMEOUT' }))
    await flush()
    expect(s.state.value).toMatchObject({ state: 'failed', code: 'TIMEOUT' })
    expect(s.current_index.value).not.toBeNull()
    w.status.next(entry({ ...base, state: 'cancelled', code: 'CANCELLED' }))
    expect(s.state.value.state).toBe('cancelled')
    w.status.next(entry({ ...base, state: 'failed', code: 'INTERRUPTED' }))
    expect(s.state.value.state).toBe('interrupted')
    s.stop()
  })

  it('shows done with no items as empty', async () => {
    const w = world()
    const s = make(w)
    await flush()
    w.status.next(entry({ scan: 's', state: 'done', current: { file: 'f0', items: 0 } }))
    expect(s.state.value.state).toBe('done_empty')
    s.stop()
  })

  it('loads the previous snapshot once and diffs against it', async () => {
    const w = world()
    const s = make(w)
    await flush()
    const meta = f => ({ file: f, items: 2, exhaustive: true, truncated: false,
      options_hash: 'sha256:a', root: null, excluded: [] })
    w.status.next(entry({ scan: 's1', state: 'done', current: meta('f1'), previous: null }))
    await flush()
    w.status.next(entry({ scan: 's2', state: 'done', current: meta('f2'), previous: meta('f1') }))
    await flush()
    expect(w.loads).toEqual(['f1', 'f2'])
    expect([...s.changes.value.added]).toEqual(['A/f2'])
    expect(s.changes.value.gone.map(i => i.id)).toEqual(['A/f1'])
    s.stop()
  })

  it('reports an invalid snapshot', async () => {
    const w = world()
    w.deps.load.mockResolvedValueOnce({ valid: false, problems: ['The snapshot has no end line, so it is incomplete.'] })
    const s = make(w)
    await flush()
    w.status.next(entry({ scan: 's', state: 'done', current: { file: 'bad', items: 3 } }))
    await flush()
    expect(s.load_error.value).toMatch(/no end line/)
    expect(s.current_index.value).toBeNull()
    s.stop()
  })
})

describe('useScout while the panel is closed', () => {
  it('follows the status entry but not births, the ACL or snapshots', async () => {
    const w = world()
    const { ref } = await import('vue')
    const active = ref(false)
    const s = create_scout({ deps: w.deps, node: NODE, connection: CONN, address: ADDR, driver: {}, active, now: w.now })
    await flush()
    w.status.next(entry({ scan: 's', state: 'done', current: { file: 'f1', items: 2 } }))
    await flush()
    expect(s.status.value.current.items).toBe(2)
    expect(w.deps.watch_node).not.toHaveBeenCalled()
    expect(w.deps.can_scout).not.toHaveBeenCalled()
    expect(w.deps.load).not.toHaveBeenCalled()

    active.value = true
    await flush()
    expect(w.deps.watch_node).toHaveBeenCalledWith(ADDR)
    expect(w.deps.can_scout).toHaveBeenCalledWith(NODE)
    expect(w.loads).toEqual(['f1'])
    s.stop()
  })
})

describe('can_scout with the real services', () => {
  const NODE_UUID = '6b1d2a3c-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const deps = answer => {
    const fetch = vi.fn(async () => answer)
    return { fetch, can: real_deps({ Auth: { fetch } }).can_scout }
  }

  it('reads our own ACL, which works for a Keycloak sign-in', async () => {
    const { fetch, can } = deps([200, { principal: 'p', root: false,
      acl: [{ permission: Scout.Perm, target: NODE_UUID }] }])
    expect(await can(NODE_UUID)).toBe(true)
    expect(fetch).toHaveBeenCalledWith('v2/whoami/acl')
  })

  it('says no without the permission on that node', async () => {
    const { can } = deps([200, { root: false,
      acl: [{ permission: Scout.Perm, target: 'another-node' }] }])
    expect(await can(NODE_UUID)).toBe(false)
  })

  it('lets root scout', async () => {
    const { can } = deps([200, { root: true, acl: [] }])
    expect(await can(NODE_UUID)).toBe(true)
  })

  it('does not know when Auth does not answer', async () => {
    const { can } = deps([503, undefined])
    expect(await can(NODE_UUID)).toBe(null)
  })
})

describe('useScout live values', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  })

  /* A world whose driver can read, with a values entry to push into and
   * a fake for the tab being hidden. */
  function live_world (opts = {}) {
    const w = world(opts)
    const values = new rx.BehaviorSubject(null)
    let hidden = null
    w.deps.watch_values = vi.fn(() => values)
    w.deps.on_hidden = vi.fn(fn => {
      hidden = fn
      return () => { hidden = null }
    })
    w.values = values
    w.hide = () => hidden?.()
    w.listening = () => !!hidden
    return w
  }

  const items = (...addrs) => addrs.map(a => ({ id: a, kind: 'value', address: a }))
  const ops = w => w.sent.map(s => s.body.op)

  async function ready (w, over = {}) {
    const s = make(w)
    await flush()
    w.status.next(entry({ reads: true, ...over }))
    await flush()
    return s
  }

  it('is disabled until the driver says it reads, and says why', async () => {
    const w = live_world()
    const s = make(w)
    await flush()
    w.status.next(entry({}))
    await flush()
    expect(s.live_blocked.value).toBe('unknown')
    w.status.next(entry({ reads: false }))
    await flush()
    expect(s.live_blocked.value).toBe('noreads')
    expect(s.live_on()).toBe(false)
    expect(s.live.value).toBe(false)
    w.status.next(entry({ reads: true }))
    await flush()
    expect(s.live_blocked.value).toBeNull()
    s.stop()
  })

  it('is disabled offline and without the permission', async () => {
    const w = live_world({ acl: false })
    const s = await ready(w)
    expect(s.live_blocked.value).toBe('no_permission')
    s.stop()
    const w2 = live_world({ online: false })
    const s2 = await ready(w2)
    expect(s2.live_blocked.value).toBe('offline')
    s2.stop()
  })

  it('watches the rows on screen with one lease, renews it and ends it', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a', 'b'))
    expect(w.sent).toEqual([])

    expect(s.live_on()).toBe(true)
    await flush()
    expect(w.sent).toHaveLength(1)
    const first = w.sent[0]
    expect(first.addr).toBe(ADDR)
    expect(first.body).toMatchObject({ version: 1, op: 'watch', connection: CONN, addresses: ['a', 'b'] })
    const lease = first.body.lease
    expect(w.deps.watch_values).toHaveBeenCalledWith(CONN)

    /* A change is sent after it has stayed for 1 s. */
    s.set_live_items(items('b', 'c'))
    vi.advanceTimersByTime(500)
    s.set_live_items(items('c', 'd'))
    vi.advanceTimersByTime(999)
    expect(w.sent).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(w.sent[1].body).toMatchObject({ op: 'watch', lease, addresses: ['c', 'd'] })

    /* The same rows send nothing new until the renewal. */
    s.set_live_items(items('c', 'd'))
    vi.advanceTimersByTime(1000)
    expect(w.sent).toHaveLength(2)
    vi.advanceTimersByTime(20000)
    expect(w.sent[2].body).toMatchObject({ op: 'watch', lease, addresses: ['c', 'd'] })
    expect(new Set(w.sent.map(x => x.body.request)).size).toBe(3)

    s.live_off()
    expect(w.sent[3].body).toMatchObject({ version: 1, op: 'unwatch', connection: CONN, lease })
    expect(s.live.value).toBe(false)
    vi.advanceTimersByTime(60000)
    expect(w.sent).toHaveLength(4)
    s.stop()
  })

  it('uses a new lease each time it is turned on', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    s.live_off()
    s.live_on()
    const leases = w.sent.map(x => x.body.lease)
    expect(ops(w)).toEqual(['watch', 'unwatch', 'watch'])
    expect(leases[0]).toBe(leases[1])
    expect(leases[2]).not.toBe(leases[0])
    s.stop()
  })

  it('ends the lease while no values are on screen, and starts it again', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    s.set_live_items([{ id: 'f', kind: 'folder' }])
    vi.advanceTimersByTime(1000)
    expect(ops(w)).toEqual(['watch', 'unwatch'])
    vi.advanceTimersByTime(20000)
    expect(ops(w)).toEqual(['watch', 'unwatch'])
    s.set_live_items(items('b'))
    vi.advanceTimersByTime(1000)
    expect(ops(w)).toEqual(['watch', 'unwatch', 'watch'])
    s.live_off()
    expect(ops(w)).toEqual(['watch', 'unwatch', 'watch', 'unwatch'])
    s.stop()
  })

  it('stops when the tab is hidden', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    expect(w.listening()).toBe(true)
    w.hide()
    expect(s.live.value).toBe(false)
    expect(ops(w)).toEqual(['watch', 'unwatch'])
    expect(w.listening()).toBe(false)
    s.stop()
  })

  it('stops when the agent goes offline', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    w.node.next({ type: 'DEATH' })
    await flush()
    expect(s.live.value).toBe(false)
    expect(ops(w)).toEqual(['watch', 'unwatch'])
    s.stop()
  })

  it('stops when the composable stops', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    s.stop()
    expect(ops(w)).toEqual(['watch', 'unwatch'])
  })

  it('stops and says why when the agent refuses the watch', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    const req = w.sent[0].body.request
    w.status.next(entry({ reads: true, last_request: { request: req, code: 'LIMIT', message: null, at: 't' } }))
    await flush()
    expect(s.live.value).toBe(false)
    expect(s.live_error.value).toMatch(/four other panels/)
    /* A refused lease was never made, so there is nothing to end. */
    expect(ops(w)).toEqual(['watch'])
    /* Turning it on again clears the message. */
    s.live_on()
    expect(s.live_error.value).toBeNull()
    s.stop()
  })

  it('ignores a refusal for someone else\'s request', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    w.status.next(entry({ reads: true, last_request: { request: 'other', code: 'NOREADS', message: null, at: 't' } }))
    await flush()
    expect(s.live.value).toBe(true)
    s.stop()
  })

  it('stops when the watch does not reach the agent', async () => {
    const w = live_world()
    w.deps.send = vi.fn(async () => { throw Object.assign(new Error('no'), { status: 403 }) })
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    await flush()
    expect(s.live.value).toBe(false)
    expect(s.live_error.value).toMatch(/Command Escalation service refused/)
    s.stop()
  })

  it('shows only a values entry from this connection\'s node, and only while on', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    w.values.next({ version: 1, node: NODE, leases: 1, values: { a: { value: '1' } } })
    expect(s.live_values.value).toBeNull()
    s.live_on()
    await flush()
    expect(s.live_values.value.values.a.value).toBe('1')
    w.values.next({ version: 1, node: 'someone-else', leases: 1, values: { a: { value: '2' } } })
    await flush()
    expect(s.live_values.value).toBeNull()
    s.live_off()
    expect(s.live_values.value).toBeNull()
    s.stop()
  })

  it('does not use watch requests as scan requests', async () => {
    const w = live_world()
    const s = await ready(w)
    s.set_live_items(items('a'))
    s.live_on()
    expect(s.pending.value).toBeNull()
    expect(s.state.value.state).toBe('never')
    s.stop()
  })
})
