/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Fixtures for the ISA-95 hierarchy surfaces: a vocabulary with a
 * duplicate Site and a Work Center under two Areas, devices placed in
 * it, and an in-memory ConfigDB so adding, renaming, moving, merging
 * and aliases can be walked through. Writes change the ISA-95 store
 * the page reads, as the real change notifications would.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { ISA95_LEVEL_CLASSES } from '../src/store/useISA95Store.js'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const node = (n, name, level, children = [], aliases = []) =>
  ({ uuid: id(n), name, level, children: children.map(id), aliases })

export const nodes = [
  node(1, 'Acme Manufacturing', 'Enterprise', [2, 3, 4]),
  node(2, 'North Works', 'Site', [10, 11, 12]),
  /* A duplicate of North Works, with fewer devices. */
  node(3, 'NW', 'Site', [13]),
  node(4, 'South Works', 'Site', [14]),
  node(10, 'Machining', 'Area', [20, 21]),
  node(11, 'Composites', 'Area', [22, 21]),
  node(12, 'Assembly', 'Area', [23]),
  node(13, 'Machining', 'Area', []),
  node(14, 'Main Hall', 'Area', [24]),
  node(20, 'Cell 1', 'Work Center', [30, 31]),
  /* Under Machining and Composites. */
  node(21, 'Metrology Lab', 'Work Center', [32]),
  node(22, 'Layup Cell', 'Work Center', [33]),
  node(23, 'Line 2', 'Work Center', []),
  node(24, 'Robot Cell', 'Work Center', []),
  node(30, 'Mill 1', 'Work Unit'),
  node(31, 'Mill 2', 'Work Unit'),
  node(32, 'CMM', 'Work Unit'),
  node(33, 'Cutting Table', 'Work Unit'),
  node(40, 'Partner Co', 'Enterprise', []),
]

const device = (n, name, at) => ({ uuid: id(100 + n), name, placement: { node: id(at) } })

export const devices = [
  device(1, 'Mill 1 controller', 30),
  device(2, 'Mill 1 spindle', 30),
  device(3, 'Mill 2 controller', 31),
  device(4, 'CMM', 32),
  device(5, 'Cutting table', 33),
  device(6, 'Line 2 PLC', 23),
  device(7, 'Old line PLC', 3),
  device(8, 'Robot', 24),
  { uuid: id(199), name: 'Unplaced sensor', placement: null },
]

/* An in-memory ConfigDB over the store's node list. */
export function make_client (store) {
  let next = 1000
  const find = uuid => store.data.find(n => n.uuid === uuid)
  const level_of = cls => Object.entries(ISA95_LEVEL_CLASSES).find(([, c]) => c === cls)?.[0]
  const pending = new Map()
  const later = fn => new Promise(r => setTimeout(() => { fn(); r() }, 150))

  return {
    /* The i3X access button reads grants; there are none here. */
    Auth: { find_grants: async () => [] },
    ConfigDB: {
      create_object: async (cls) => {
        const uuid = id(next++)
        pending.set(uuid, { uuid, name: uuid, level: level_of(cls), aliases: [], children: [] })
        return uuid
      },
      put_config: (app, obj, conf) => later(() => {
        if (pending.has(obj)) {
          store.data = [...store.data, pending.get(obj)]
          pending.delete(obj)
        }
        const n = find(obj)
        if (app === UUIDs.App.Info && n) n.name = conf.name
        else if (app === UUIDs.App.ISA95Vocabulary && n) {
          n.aliases = conf.aliases
          n.children = conf.children
        }
        else if (app === UUIDs.App.ISA95Placement) {
          const d = devices.find(x => x.uuid === obj)
          if (d) d.placement = conf
        }
        store.data = [...store.data]
      }),
      delete_object: (obj) => later(() => {
        store.data = store.data.filter(n => n.uuid !== obj)
      }),
    },
  }
}
