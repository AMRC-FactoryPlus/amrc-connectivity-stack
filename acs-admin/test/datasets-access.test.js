/*
 * ACS Admin
 * Tests for which dataset actions a user's ACL allows
 * Copyright 2026 University of Sheffield
 */

import { describe, it, expect } from 'vitest'

import { make_checker, Status } from '../src/lib/access/acl.js'
import { DataAccess } from '../src/lib/access/perms.js'
import { dataset_access } from '../src/lib/datasets/access.js'

const DEVICE = '11111111-1111-4111-8111-111111111111'
const MINE = '84ac3397-f3a6-4b55-8a2d-5f1bc4d03b0c'

const checker = acl => make_checker({ status: Status.Ready, acl })

describe('dataset_access create', () => {
  it('lets someone with Device data on one device make datasets', () => {
    /* Data Access allows a create when the caller holds Build datasets
     * from device on the device. Found on a dev cluster, where a user
     * with only that grant saw no way to make a dataset. */
    const check = checker([{ permission: DataAccess.UseDevice, target: DEVICE }])
    expect(dataset_access(check).create).toBe(true)
  })

  it('still allows a holder of Create dataset', () => {
    const check = checker([{ permission: DataAccess.CreateDataset, target: DEVICE }])
    expect(dataset_access(check).create).toBe(true)
  })

  it('hides it from someone with only the grants every account holds', () => {
    const check = checker([
      { permission: DataAccess.ReadDataset, target: MINE },
      { permission: DataAccess.UseForSession, target: MINE },
      { permission: DataAccess.EditDataset, target: MINE },
    ])
    expect(dataset_access(check).create).toBe(false)
  })
})
