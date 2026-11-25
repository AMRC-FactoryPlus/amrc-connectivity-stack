/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Fixtures for the Edge Scout preview surface: a fake world for
 * create_scout, with an OPC UA style scan and a previous scan to diff.
 * `?state=` picks the scenario. Not part of the shipped application.
 */

import * as rx from 'rxjs'

import { create_scout } from '../src/composables/useScout.js'
import { SCOUT_METRIC } from '../src/lib/scout/constants.js'
import { build_index } from '../src/lib/scout/model.js'

export const NODE = '9b2e4c6d-1f3a-4b5c-8d7e-6f5a4b3c2d1e'
export const CONN = '5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a'

const value = (id, parent, name, extra = {}) =>
  ({ id, parent, name, kind: 'value', address: id, path: null, type: 'Double', access: 'r', ...extra })
const folder = (id, parent, name, extra = {}) => ({ id, parent, name, kind: 'folder', ...extra })

/* What each tag read during the scan. */
const AT_SCAN = {
  Spindle_Speed: '1440', Spindle_Load: '35.8', Feed_Rate: '800', Coolant_Temp: '21.1',
  Axis_X_Position: '120.25', Axis_Y_Position: '-42.5', Axis_Z_Position: '15', Mode: 'AUTO',
  Alarm: 'false', Part_Count: '1201', Cycle_Time: '42.7', Door_Open: 'false',
}
const sample_at_scan = tag => AT_SCAN[tag] ?? null

/* What the fake Edge Agent reads while live values are on. Each read
 * moves the numbers a little, so the values can be seen changing. */
function live_reading (address, round) {
  const tag = address.split('.').at(-1)
  if (tag === 'Cycle_Time') return { value: null, type: null, error: 'BadNotReadable' }
  const wobble = Math.sin(round + address.length) * 0.5
  const num = (base, places = 1) => ({ value: (base + wobble * base * 0.02).toFixed(places), type: 'Double' })
  switch (tag) {
    case 'Spindle_Speed': return num(1450.5)
    case 'Spindle_Load': return num(37.2)
    case 'Feed_Rate': return num(820, 0)
    case 'Coolant_Temp': return num(21.4)
    case 'Axis_X_Position': return num(121.75, 2)
    case 'Axis_Y_Position': return num(-40.5, 2)
    case 'Axis_Z_Position': return num(12.5, 2)
    case 'Mode': return { value: 'AUTO', type: 'String' }
    case 'Alarm': return { value: 'false', type: 'Boolean' }
    case 'Door_Open': return { value: 'false', type: 'Boolean' }
    case 'Part_Count': return { value: String(1234 + round), type: 'Int32' }
    default: return num(3.2, 2)
  }
}

/* A machine with two lines of four cells, each with a dozen tags. */
function scan (variant) {
  const items = [folder('ns=2;s=Plant', null, 'Plant')]
  for (const line of [1, 2]) {
    const l = `ns=2;s=Plant.Line${line}`
    items.push(folder(l, 'ns=2;s=Plant', `Line${line}`))
    for (const cell of [1, 2, 3, 4]) {
      const c = `${l}.Cell${cell}`
      items.push(folder(c, l, `Cell${cell}`))
      const tags = ['Spindle_Speed', 'Spindle_Load', 'Feed_Rate', 'Coolant_Temp', 'Axis_X_Position',
        'Axis_Y_Position', 'Axis_Z_Position', 'Mode', 'Alarm', 'Part_Count', 'Cycle_Time', 'Door_Open']
      for (const t of tags) {
        if (variant === 'previous' && t === 'Cycle_Time' && cell === 2) continue
        const type = ['Mode'].includes(t) ? 'String' : ['Alarm', 'Door_Open'].includes(t) ? 'Boolean'
          : ['Part_Count'].includes(t) ? 'Int32' : 'Double'
        items.push(value(`${c}.${t}`, c, t, {
          type: variant === 'previous' && t === 'Feed_Rate' && cell === 1 ? 'Float' : type,
          access: t === 'Mode' ? 'rw' : 'r',
          unit: t.includes('Temp') ? 'Cel' : t.includes('Speed') ? 'rpm' : null,
          description: `${t.replace(/_/g, ' ')} of cell ${cell} on line ${line}`,
          sample: sample_at_scan(t),
        }))
      }
    }
    if (variant !== 'previous') items.push(value(`${l}.Energy`, l, 'Energy', { unit: 'kW.h' }))
  }
  items.push(folder('ns=2;s=Plant.Restricted', 'ns=2;s=Plant', 'Restricted',
    { more: false, detail: { denied: false } }))
  return items
}

/** The current scan's index alone, for the driver-ui surface. */
export const preview_index = () => build_index(scan('current'))

const meta = (file, items) => ({
  file, items, bytes_gz: 4021, exhaustive: true, truncated: false, reason: null,
  finished: file === 'cur' ? '2026-11-24T10:42:13Z' : '2026-11-20T09:10:00Z',
  root: null, options_hash: 'sha256:' + 'a'.repeat(64), config_hash: 'sha256:' + 'b'.repeat(64),
  excluded: [{ id: 'i=2253', reason: 'skipped', prefixes: ['i='] }], branches: [],
})

/**
 * A fake world for the scout preview surface.
 *
 * @param {string} state The scenario, from `?state=`.
 * @param {object} [query] The other query parameters: `reads=0` for a
 *   driver that cannot read values and `reads=none` for an agent that
 *   does not say, and `dropped=n` for an agent that left n addresses out
 *   at its cap.
 */
export function preview_scout (state, query = {}) {
  const cur = scan('current')
  const prev = scan('previous')
  const snaps = {
    cur: { valid: true, problems: [], header: { options: {} }, items: cur, index: build_index(cur) },
    prev: { valid: true, problems: [], header: { options: {} }, items: prev, index: build_index(prev) },
  }

  const reads = query.reads === '0' ? false : query.reads === 'none' ? undefined : true
  const base = { version: 1, node: NODE, supported: true, reads }
  const done = {
    ...base, scan: 's2', request: 'r2', state: 'done', code: null, message: null,
    started: '2026-11-24T10:41:00Z', finished: '2026-11-24T10:42:13Z',
    current: meta('cur', cur.length), previous: meta('prev', prev.length),
    last_request: { request: 'r2', code: null, message: null, at: '2026-11-24T10:41:00Z' },
  }
  const entry = {
    done,
    never: base,
    running: { ...done, state: 'running', scan: 's3', started: new Date(Date.now() - 41000).toISOString(),
      progress: { visited: 9100, found: 3420, note: 'ns=2;s=Plant.Line2' } },
    failed: { ...done, state: 'failed', code: 'CONN', message: 'The OPC UA session closed' },
    unsupported: { ...base, supported: false },
    empty: { ...done, current: { ...meta('cur', 0) }, previous: null },
    truncated: { ...done, current: { ...meta('cur', cur.length), truncated: true, reason: 'items' } },
    refused: { ...done, last_request: { request: 'mine', code: 'BUSY', message: null, at: 't' } },
  }[state] ?? done

  const node = new rx.BehaviorSubject(
    { type: state === 'offline' ? 'DEATH' : 'BIRTH', metrics: [{ name: SCOUT_METRIC }] })

  /* The values entry, and a fake agent that reads every 5 s while a
   * lease is live. */
  const values = new rx.BehaviorSubject(null)
  const dropped = Number(query.dropped) || 0
  const live = { addresses: [], round: 0, timer: null }
  const read_all = () => {
    live.round++
    const read = new Date().toISOString()
    values.next({
      version: 1, node: NODE, updated: read, interval_ms: 5000,
      leases: 1, dropped,
      values: Object.fromEntries(live.addresses.map(a => {
        const v = live_reading(a, live.round)
        return [a, { ts: v.error ? null : Date.now() - 300, read, error: null, ...v }]
      })),
    })
  }
  const agent = body => {
    if (body?.op === 'watch') {
      live.addresses = body.addresses
      clearInterval(live.timer)
      setTimeout(read_all, 400)
      live.timer = setInterval(read_all, 5000)
    }
    else if (body?.op === 'unwatch') {
      clearInterval(live.timer)
      live.addresses = []
      values.next({ version: 1, node: NODE, updated: new Date().toISOString(), leases: 0, values: {} })
    }
  }

  const deps = {
    watch_status: () => new rx.BehaviorSubject(entry),
    watch_values: () => values,
    on_hidden: fn => {
      const handler = () => { if (document.visibilityState === 'hidden') fn() }
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
    watch_agent_config: () => new rx.BehaviorSubject({ deviceConnections: [{ uuid: CONN }] }),
    watch_node: () => node,
    node_online: async () => state !== 'offline',
    can_scout: async () => state !== 'noperm',
    send: async (addr, body) => agent(body),
    load: async file => (file === 'cur' ? snaps.cur : snaps.prev),
    uuid: () => (state === 'refused' ? 'mine' : crypto.randomUUID()),
  }

  const scout = create_scout({
    deps, node: NODE, connection: CONN, address: 'Preview/Agent',
    driver: { scout: { address_form: 'opcua' } },
  })
  if (state === 'refused') scout.start()
  return scout
}

/* An origin map that maps a few of the scanned tags, and one that is
 * missing. */
export const scout_model = {
  Schema_UUID: 'device', Instance_UUID: 'i',
  Spindle: {
    Speed: {
      Address: 'ns=2;s=Plant.Line1.Cell1.Spindle_Speed', Sparkplug_Type: 'DoubleBE',
      Documentation: 'The measured rotational speed of the main spindle, as the controller reports it, before any override is applied.',
      Record_To_Historian: true,
    },
    Load: { Address: 'ns=2;s=Plant.Line1.Cell1.Spindle_Load', Sparkplug_Type: 'FloatBE' },
    Old_Tag: { Address: 'ns=2;s=Plant.Line1.Cell1.Removed', Sparkplug_Type: 'DoubleBE' },
  },
}

export const scout_driver = {
  scout: {
    title: "Scan the server's address space",
    address_form: 'opcua',
    options: {
      type: 'object',
      properties: {
        root: { type: 'string', title: 'Start at', description: 'A NodeId. Leave empty for Objects.' },
        include_server: { type: 'boolean', title: 'Include the Server object', default: false },
        units: { type: 'boolean', title: 'Read engineering units', default: false },
      },
    },
  },
}

/* The selected metric, as OriginMapEditor hands it to SparkplugMetric. */
export const scout_metric = {
  path: ['Spindle', 'Speed'],
  model: scout_model.Spindle.Speed,
  schema: { Sparkplug_Type: { enum: ['DoubleBE', 'FloatBE', 'Int32BE'] } },
}

/* The Sparkplug metric schema's field descriptions, for the help icons. */
const describe = d => ({ description: d })
export const SPARKPLUG_METRIC = {
  properties: {
    Address: describe('Where the driver reads the value.'),
    Path: describe('Where the value sits inside what the address returns.'),
    Value: describe('A fixed value.'),
    Sparkplug_Type: describe('The type the value is published as.'),
    Eng_Unit: describe('The unit of the value.'),
    Eng_Low: describe('The lowest value expected.'),
    Eng_High: describe('The highest value expected.'),
    Deadband: describe('The change needed before a new value is published.'),
    Record_To_Historian: describe('Whether the historians record this metric.'),
  },
}
