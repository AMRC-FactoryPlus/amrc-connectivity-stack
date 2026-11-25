/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The users the nav surface shows, as the checker each one's own ACL
 * from Auth's v2/whoami/acl gives. Not part of the shipped
 * application. */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { make_checker, Status } from '../src/lib/access/acl.js'
import { ConfigDB } from '../src/lib/access/perms.js'
import { BUILD_DATASETS, READ_OBJECT } from '../src/lib/access/i3x-access.js'

const { App } = UUIDs

export const DEVICE = 'd0000000-0000-4000-8000-00000000c001'

/* What acs-service-setup/dumps/everyone.yaml gives every principal. */
const EVERYONE = [
  App.ISA95Vocabulary, App.ISA95Placement, App.EngineeringUnit, App.Info, App.Registration,
].map(target => ({ permission: ConfigDB.ReadApp, target }))

const ready = (acl, extra = {}) => make_checker({ status: Status.Ready, acl, ...extra })

export const USERS = {
  /* A user with no grants of their own: only what everyone gets. */
  none:    { name: 'no grants', check: () => ready(EVERYONE) },
  /* Not even those: a principal outside the Principal class. */
  empty:   { name: 'empty ACL', check: () => ready([]) },
  /* Device data (Browse in i3X and Build datasets) on one device. */
  device:  {
    name: 'Device data on one device',
    check: () => ready([
      ...EVERYONE,
      { permission: READ_OBJECT, target: DEVICE },
      { permission: BUILD_DATASETS, target: DEVICE },
    ]),
  },
  root:    { name: 'root', check: () => ready([], { root: true }) },
  loading: { name: 'loading', check: () => make_checker({ status: Status.Loading }) },
}

/* Clusters for the tree, shown to root. */
export const clusters = [
  { uuid: 'c0000000-0000-4000-8000-000000000001', name: 'Cell 1 gateway' },
  { uuid: 'c0000000-0000-4000-8000-000000000002', name: 'Machine shop' },
]

/* Names from Info, which everyone may read. */
export const objects = [
  { uuid: DEVICE, name: 'Mill 1 spindle', class: { name: 'Device' } },
]
