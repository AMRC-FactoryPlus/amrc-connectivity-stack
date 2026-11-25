/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Which navigation items and pages a user sees, from their own ACL.
 * Each section is checked with the smallest ACL that should show it
 * and with that ACL less one entry, and as a user with no grants, one
 * with only the grants every principal gets, one with Device data on a
 * single device, root, an Auth too old to say, and while loading.
 */

import { describe, it, expect } from 'vitest'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { make_checker, Status } from '../src/lib/access/acl.js'
import {
  Auth, ConfigDB, DataAccess, Directory, GatewayDepot, MQTT, WILDCARD,
} from '../src/lib/access/perms.js'
import { BUILD_DATASETS, READ_OBJECT } from '../src/lib/access/i3x-access.js'
import { EdgeSim } from '../src/lib/edge-sim-uuids.js'
import {
  Sections, can_read_devices, can_see, nav_sections, page_state,
} from '../src/lib/access/sections.js'

const { App, Class } = UUIDs

const DEVICE = '1a2b3c4d-0000-4000-8000-000000000001'
const OTHER = '1a2b3c4d-0000-4000-8000-000000000002'

const ready = acl => make_checker({ status: Status.Ready, acl })
const read = (...apps) => apps.map(a => ({ permission: ConfigDB.ReadApp, target: a }))
const members = (...ks) => ks.map(k => ({ permission: ConfigDB.ReadMembers, target: k }))
const any = (...ps) => ps.map(p => ({ permission: p, target: OTHER }))

/* What acs-service-setup/dumps/everyone.yaml gives every principal,
 * as Auth expands it. */
const EVERYONE = read(
  App.ISA95Vocabulary, App.ISA95Placement, App.EngineeringUnit,
  App.Info, App.Registration,
).concat([{ permission: ConfigDB.WriteApp, target: '7a3e1c56-0000-4000-8000-000000000001' }])

/* Device data and Browse in i3X on one device, as Auth expands the
 * composite. */
const DEVICE_DATA = [
  ...EVERYONE,
  { permission: READ_OBJECT, target: DEVICE },
  { permission: BUILD_DATASETS, target: DEVICE },
]

const ISA95 = [
  Class.ISA95Enterprise, Class.ISA95Site, Class.ISA95Area,
  Class.ISA95WorkCenter, Class.ISA95WorkUnit,
]
const NAMES = read(App.Info, App.Registration)

/* The smallest ACL for each section. */
const MINIMAL = {
  explorer:      any(READ_OBJECT),
  activity:      any(MQTT.ReadWholeNamespace),
  alerts:        any(Directory.ReadDeviceAlerts),
  cassettes:     [...members(EdgeSim.CassetteClass), ...NAMES, ...read(EdgeSim.CassetteApp)],
  access:        any(Auth.ReadKrb),
  configdb:      [...members(Class.App), ...NAMES],
  files:         [...members(Class.File), ...NAMES, ...read(App.FilesConfig)],
  bridges:       [...members(Class.Bridge), ...NAMES, ...read(App.EdgeAgentDeployment, App.HelmChartTemplate)],
  gateway_depot: [{ permission: GatewayDepot.Provision, target: WILDCARD }],
  isa95:         [...members(...ISA95), ...read(App.ISA95Vocabulary, App.Info)],
  units:         read(App.EngineeringUnit, App.Info),
  schemas:       [...members(Class.Schema), ...NAMES, ...read(App.SchemaInformation, App.Schema)],
  datasets:      any(DataAccess.ReadDataset),
  edge_cluster:  [...members(Class.EdgeCluster), ...NAMES, ...read(
    App.EdgeClusterConfiguration, App.HelmChartTemplate,
    App.EdgeClusterStatus, App.EdgeClusterSetupStatus)],
}
MINIMAL.edge_node = [
  ...MINIMAL.edge_cluster,
  ...members(Class.EdgeAgent), ...read(App.EdgeAgentDeployment, App.SparkplugAddress),
]

const keys = c => nav_sections(c).map(s => s.key)
const NAV = Sections.filter(s => s.nav !== false).map(s => s.key)

describe('navigation sections', () => {
  for (const [key, acl] of Object.entries(MINIMAL)) {
    it(`${key} shows with its reads and not without each of them`, () => {
      expect(can_see(ready(acl), key)).toBe(true)
      for (let i = 0; i < acl.length; i++) {
        const less = acl.filter((_, j) => j !== i)
        /* An entry another one duplicates is not needed. */
        if (less.some(e => e.permission === acl[i].permission && e.target === acl[i].target)) continue
        expect(can_see(ready(less), key), `without ${JSON.stringify(acl[i])}`).toBe(false)
      }
    })
  }

  it('every gated section has a minimal ACL in this test', () => {
    expect(Sections.filter(s => s.key !== 'home').map(s => s.key).sort())
      .toEqual(Object.keys(MINIMAL).sort())
  })

  it('a section shows only its own item, beside Home', () => {
    for (const key of NAV.filter(k => k !== 'home' && k !== 'units')) {
      const shown = keys(ready(MINIMAL[key]))
      expect(shown, key).toContain(key)
      expect(shown.filter(k => k !== key && k !== 'home' && k !== 'units'), key).toEqual([])
    }
  })

  it('shows only Home to a user with no grants at all', () => {
    expect(keys(ready([]))).toEqual(['home'])
  })

  it('shows Home and Units to a user with only the grants everyone gets', () => {
    expect(keys(ready(EVERYONE))).toEqual(['home', 'units'])
  })

  it('shows the Explorer and Datasets for Device data on one device', () => {
    expect(keys(ready(DEVICE_DATA))).toEqual(['home', 'explorer', 'units', 'datasets'])
  })

  it('shows the Explorer for Browse in i3X alone, and Datasets for Build datasets alone', () => {
    expect(keys(ready([{ permission: READ_OBJECT, target: DEVICE }]))).toEqual(['home', 'explorer'])
    expect(keys(ready([{ permission: BUILD_DATASETS, target: DEVICE }]))).toEqual(['home', 'datasets'])
  })

  it('shows Datasets to someone who owns a dataset', () => {
    expect(keys(ready([{ permission: DataAccess.ReadDataset, target: OTHER }]))).toContain('datasets')
  })

  it('needs a wildcard grant for the Gateway Depot', () => {
    expect(can_see(ready([{ permission: GatewayDepot.Provision, target: OTHER }]), 'gateway_depot')).toBe(false)
  })

  it('takes a wildcard grant as covering every target', () => {
    const wild = [ConfigDB.ReadApp, ConfigDB.ReadMembers].map(p => ({ permission: p, target: WILDCARD }))
    const shown = keys(ready(wild))
    for (const k of ['cassettes', 'configdb', 'files', 'bridges', 'isa95', 'units', 'schemas'])
      expect(shown).toContain(k)
    expect(can_see(ready(wild), 'edge_node')).toBe(true)
  })

  it('needs the clusters as well as the nodes for a node page', () => {
    const nodes = [...members(Class.EdgeAgent), ...NAMES, ...read(App.EdgeAgentDeployment, App.SparkplugAddress)]
    expect(can_see(ready(nodes), 'edge_node')).toBe(false)
  })

  it('shows everything to root', () => {
    expect(keys(make_checker({ status: Status.Ready, root: true, acl: [] }))).toEqual(NAV)
  })

  it('shows everything when Auth is too old to say', () => {
    expect(keys(make_checker({ status: Status.Unknown }))).toEqual(NAV)
  })

  it('shows only Home while the ACL loads', () => {
    expect(keys(make_checker({ status: Status.Loading }))).toEqual(['home'])
  })
})

describe('page state', () => {
  it('is loading while the ACL loads', () => {
    expect(page_state(make_checker({ status: Status.Loading }), 'configdb')).toBe('loading')
  })

  it('is denied for a page the user can not read', () => {
    expect(page_state(ready(EVERYONE), 'configdb')).toBe('denied')
    expect(page_state(ready(DEVICE_DATA), 'access')).toBe('denied')
  })

  it('is open for a page the user can read', () => {
    expect(page_state(ready(DEVICE_DATA), 'explorer')).toBe('open')
    expect(page_state(ready(DEVICE_DATA), 'datasets')).toBe('open')
  })

  it('is open for a page with no section, even while loading', () => {
    expect(page_state(make_checker({ status: Status.Loading }), undefined)).toBe('open')
    expect(page_state(ready([]), 'kiosk')).toBe('open')
  })
})

describe('device reads', () => {
  it('needs the device class and its apps, not a grant on the device', () => {
    expect(can_read_devices(ready(DEVICE_DATA))).toBe(false)
    expect(can_read_devices(ready([
      ...members(Class.Device), ...NAMES,
      ...read(App.DeviceInformation, App.SparkplugAddress, App.ISA95Placement),
    ]))).toBe(true)
  })
})
