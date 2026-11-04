/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Fixture data for the i3X access surfaces of the design preview: an
 * ISA-95 vocabulary, devices placed in it, users and groups, and grants
 * reaching one device by every route the dialog can show. */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { I3X_PERM_ALL, READ_OBJECT } from '../src/lib/access/i3x-access.js'

const id = n => `a1a1a1a1-0000-4000-8000-${String(n).padStart(12, '0')}`

/* The vocabulary */

const ENTERPRISE = id(1)
const F2050 = id(2)
const CYMRU = id(3)
const MACHINE_SHOP = id(4)
const ASSEMBLY = id(5)
const COMPOSITES = id(6)

const node = (uuid, name, level, children = [], aliases = []) =>
  ({ uuid, name, level, children, aliases })

export const isa95 = [
  node(ENTERPRISE, 'AMRC', 'Enterprise', [F2050, CYMRU]),
  node(F2050, 'Factory 2050', 'Site', [MACHINE_SHOP, ASSEMBLY], ['F2050']),
  node(CYMRU, 'AMRC Cymru', 'Site', [COMPOSITES]),
  node(MACHINE_SHOP, 'Machine Shop', 'Area'),
  node(ASSEMBLY, 'Assembly', 'Area'),
  node(COMPOSITES, 'Composites', 'Area'),
]

/* Devices, with the hierarchy text the vocabulary resolves */

const CNC_01 = id(101)
const CNC_02 = id(102)
const ROBOT = id(103)
const AUTOCLAVE = id(104)

const device = (uuid, name, chain) => {
  const levels = ['Enterprise', 'Site', 'Area']
  const hierarchy = Object.fromEntries(chain.map((v, i) =>
    [levels[i], { Value: v, Sparkplug_Type: 'String' }]))
  return {
    uuid, name,
    deviceInformation: { originMap: { Device_Information: { ISA95_Hierarchy: hierarchy } } },
  }
}

export const i3xDevices = [
  device(CNC_01, 'CNC 01', ['AMRC', 'Factory 2050', 'Machine Shop']),
  device(CNC_02, 'CNC 02', ['AMRC', 'F2050', 'Machine Shop']),
  device(ROBOT, 'Robot Cell 3', ['AMRC', 'Factory 2050', 'Assembly']),
  device(AUTOCLAVE, 'Autoclave', ['AMRC', 'AMRC Cymru', 'Composites']),
]

/* The device the dialog opens on, and the nodes above it */

export const target = {
  uuid: CNC_01,
  name: 'CNC 01',
  via: [isa95[0], isa95[1], isa95[3]],
}

/* Users and groups */

const JO = id(201)
const SAM = id(202)
const PRIYA = id(203)
const CHRIS = id(204)
const OEE = id(205)
const SUPERVISORS = id(301)
const DATA_SCIENCE = id(302)
const ADMINS = id(303)
const CNC_CLASS = id(401)

export const principals = [
  { uuid: JO, name: 'Jo Bloggs', kerberos: 'jo@EXAMPLE.COM' },
  { uuid: SAM, name: 'Sam Patel', kerberos: 'sam@EXAMPLE.COM' },
  { uuid: PRIYA, name: 'Priya Shah', kerberos: 'priya@EXAMPLE.COM' },
  { uuid: CHRIS, name: 'Chris Lee', kerberos: 'chris@EXAMPLE.COM' },
  { uuid: OEE, name: 'OEE dashboard', kerberos: 'sv1oee@EXAMPLE.COM' },
]

export const groups = [SUPERVISORS, DATA_SCIENCE, ADMINS]

export const objects = [
  { uuid: SUPERVISORS, name: 'Line supervisors' },
  { uuid: DATA_SCIENCE, name: 'Data science team' },
  { uuid: ADMINS, name: 'Administrators' },
  { uuid: CNC_CLASS, name: 'CNC machines' },
  ...isa95.map(n => ({ uuid: n.uuid, name: n.name })),
  ...i3xDevices.map(d => ({ uuid: d.uuid, name: d.name })),
]

/* Grants: CNC 01 is reached on itself, from each level above, through a
 * class, and through the wildcard. */

const grant = (n, principal, target, { plural = false, permission = READ_OBJECT } = {}) =>
  ({ uuid: id(500 + n), principal, permission, target, plural })

export const grants = [
  grant(1, JO, CNC_01),
  grant(2, SAM, CNC_01),
  grant(3, JO, F2050),
  grant(4, SUPERVISORS, MACHINE_SHOP),
  grant(5, DATA_SCIENCE, ENTERPRISE),
  grant(6, OEE, CNC_CLASS, { plural: true }),
  grant(7, ADMINS, UUIDs.Special.Null, { permission: I3X_PERM_ALL }),
  grant(8, PRIYA, F2050),
]

const classMembers = { [CNC_CLASS]: [CNC_01, CNC_02] }

/* Just enough of the Auth and ConfigDB clients for the access dialog.
 * Writes change the fixture grants, so giving and removing access can be
 * walked through. */
export const i3xClient = {
  Auth: {
    find_grants: async pattern => grants
      .filter(g => Object.entries(pattern).every(([k, v]) => g[k] === v))
      .map(g => g.uuid),
    get_grant: async uuid => {
      const g = grants.find(o => o.uuid === uuid)
      if (!g) throw new Error('No such grant')
      const { uuid: _, ...rest } = g
      return rest
    },
    add_grant: async g => {
      grants.push({ uuid: id(600 + grants.length), ...g })
    },
    delete_grant: async uuid => {
      const i = grants.findIndex(g => g.uuid === uuid)
      if (i >= 0) grants.splice(i, 1)
    },
  },
  ConfigDB: {
    class_subclasses: async () => groups,
    class_has_member: async (cls, uuid) => classMembers[cls]?.includes(uuid) ?? false,
  },
}
