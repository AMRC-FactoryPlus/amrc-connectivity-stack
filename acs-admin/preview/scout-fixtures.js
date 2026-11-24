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
          sample: t === 'Mode' ? 'AUTO' : null,
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

export function preview_scout (state) {
  const cur = scan('current')
  const prev = scan('previous')
  const snaps = {
    cur: { valid: true, problems: [], header: { options: {} }, items: cur, index: build_index(cur) },
    prev: { valid: true, problems: [], header: { options: {} }, items: prev, index: build_index(prev) },
  }

  const base = { version: 1, node: NODE, supported: true }
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

  const deps = {
    watch_status: () => new rx.BehaviorSubject(entry),
    watch_agent_config: () => new rx.BehaviorSubject({ deviceConnections: [{ uuid: CONN }] }),
    watch_node: () => node,
    node_online: async () => state !== 'offline',
    can_scout: async () => state !== 'noperm',
    send: async () => {},
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
    Speed: { Address: 'ns=2;s=Plant.Line1.Cell1.Spindle_Speed', Sparkplug_Type: 'DoubleBE' },
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
