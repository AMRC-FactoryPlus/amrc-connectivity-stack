/*
 * ACS Admin
 * Device data: the two halves of access to a device. "Browse in i3X"
 * is i3X ReadObject; "Build datasets from it" is the Data Access
 * permission UseDevice. The "Device data" composite gives both.
 * Copyright 2026 University of Sheffield AMRC
 */

import {
  READ_OBJECT, I3X_PERM_ALL, BUILD_DATASETS, DATA_ACCESS_ALL, DEVICE_DATA,
  DATASET_MAKER, DATASET_MANAGER, ROLE_GROUPS,
} from './i3x-access.js'

export {
  READ_OBJECT, I3X_PERM_ALL, BUILD_DATASETS, DATA_ACCESS_ALL, DEVICE_DATA,
  DATASET_MAKER, DATASET_MANAGER, ROLE_GROUPS,
}

/* Data Access permissions on datasets and structures
 * (acs-service-setup/dumps/data-access.yaml). */
export const CREATE_DATASET = '2d666b41-7a0d-4845-ad59-3113f25b469a'
export const USE_FOR_SESSION = 'c089b9a9-06cd-4211-94fc-9ad52a759987'

/* The halves, in the order the dialog shows them. */
export const HALVES = ['i3x', 'datasets']
export const HALF_LABEL = { i3x: 'i3X', datasets: 'Datasets' }

const I3X_HALF = [READ_OBJECT, I3X_PERM_ALL]
const DATASETS_HALF = [BUILD_DATASETS, DATA_ACCESS_ALL]

/* What a grant's permission allows: ['i3x'], ['datasets'], both, or
 * nothing for a permission that is neither. */
export function allows (grant) {
  const p = grant?.permission
  if (p === DEVICE_DATA) return ['i3x', 'datasets']
  if (I3X_HALF.includes(p)) return ['i3x']
  if (DATASETS_HALF.includes(p)) return ['datasets']
  return []
}

/* The halves a read_access row gives its target. Data Access checks
 * the device itself, so a grant on an ISA-95 node, or on a target that
 * is not a device, never lets anyone build datasets. */
export function route_halves (row, device) {
  const useful = device && row.reason !== 'node' ? HALVES : ['i3x']
  return allows(row.grant).filter(h => useful.includes(h))
}

/* The permission to grant for the halves ticked, or null for none. */
export function grant_permission ({ browse, build }) {
  if (browse && build) return DEVICE_DATA
  if (browse) return READ_OBJECT
  if (build) return BUILD_DATASETS
  return null
}

/* What removing one half of a grant leaves:
 *  - null when the grant does not allow that half;
 *  - { delete: true } when nothing it gives here is left;
 *  - { set: permission } for the permission that gives the rest.
 * `useful` lists the halves the grant can give where it is (see
 * route_halves); a half it cannot give there is not kept. */
export function without_half (grant, half, useful = HALVES) {
  const has = allows(grant)
  if (!has.includes(half)) return null
  const rest = has.filter(h => h !== half && useful.includes(h))
  if (!rest.length) return { delete: true }
  return { set: grant_permission({ browse: rest.includes('i3x'), build: rest.includes('datasets') }) }
}

/* Removes one half of a read_access row's grant through the Auth
 * service: deletes the grant, or replaces it with one for the half
 * that is left. Returns the change made, or null for none. */
export async function remove_half (auth, row, half, device) {
  const g = row.grant
  const change = without_half(g, half, route_halves(row, device))
  if (!change) return null
  if (change.delete)
    await auth.delete_grant(g.uuid)
  else
    await auth.set_grant(g.uuid, {
      principal: g.principal, permission: change.set, target: g.target, plural: g.plural,
    })
  return change
}

/* The halves a by_principal entry has, for the Allows column, in
 * HALVES order. `direct` lists the rows on the target itself that give
 * the half, which removing the tag changes; `elsewhere` is true when
 * another route gives it too. A role entry (a dataset role) can never
 * be changed here.
 * @returns [{ half, label, direct: [row], elsewhere, removable }] */
export function entry_halves (entry, device) {
  const role = entry.routes.some(r => r.role)
  return HALVES.flatMap(half => {
    const giving = entry.routes.filter(r => route_halves(r, device).includes(half))
    if (!giving.length) return []
    const direct = giving.filter(r => r.reason === 'direct')
    return [{
      half,
      label: HALF_LABEL[half],
      direct,
      elsewhere: giving.some(r => r.reason !== 'direct'),
      removable: !role && direct.length > 0,
    }]
  })
}

/* The halves a principal already holds on one scope: grants on the
 * target itself when `scope` is the target, otherwise grants on the
 * ISA-95 node `scope`.
 * @returns a Set of halves */
export function halves_on (rows, principal, scope, target, device) {
  const out = new Set()
  for (const r of rows) {
    if (r.grant.principal !== principal) continue
    const here = scope === target ? r.reason === 'direct' : r.through?.uuid === scope
    if (here) for (const h of route_halves(r, device)) out.add(h)
  }
  return out
}

/* The halves still to give a principal on a scope, given the ones
 * ticked. Halves they already hold there are left out. */
export function missing_halves ({ browse, build }, held) {
  return { browse: !!browse && !held.has('i3x'), build: !!build && !held.has('datasets') }
}
