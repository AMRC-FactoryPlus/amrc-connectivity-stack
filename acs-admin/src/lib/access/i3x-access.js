/*
 * ACS Admin
 * Who can read a device or ISA-95 node through i3X, and why.
 * Copyright 2026 University of Sheffield AMRC
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

/* i3X permissions (acs-service-setup/dumps/i3x.yaml). A grant of the
 * group grants every permission in it, ReadObject included. */
export const READ_OBJECT = 'd24495fd-72a3-41cd-8b9f-f4ebabdade44'
export const I3X_PERM_ALL = '6e00fd2b-1d57-4b78-96e1-9f789bbe1c52'
export const I3X_PERMS = [READ_OBJECT, I3X_PERM_ALL]

const fold = s => String(s ?? '').trim().toLowerCase()

/* The vocabulary nodes a device hierarchy resolves through, top first.
 * The same rules as acs-i3x (lib/isa95.ts): one level at a time, at the
 * top among the Enterprise nodes, then among the children of the node
 * matched above, ignoring case, by name or alias. The list stops at the
 * first name that does not match.
 *
 * @param nodes useISA95Store data: { uuid, name, aliases, children, level }
 * @param chain names, Enterprise first */
export function resolve_isa95 (nodes, chain) {
  const by_uuid = new Map(nodes.map(n => [n.uuid, n]))
  let scope = nodes.filter(n => n.level === 'Enterprise')
  const out = []
  for (const name of chain) {
    const want = fold(name)
    const node = scope.find(n => fold(n.name) === want || n.aliases.some(a => fold(a) === want))
    if (!node) break
    out.push(node)
    scope = node.children.map(c => by_uuid.get(c)).filter(Boolean)
  }
  return out
}

/* The vocabulary nodes above and including `uuid`, top first: the
 * first parent each time. */
export function isa95_path (nodes, uuid) {
  const parent = new Map()
  for (const n of nodes) for (const c of n.children) if (!parent.has(c)) parent.set(c, n.uuid)
  const by_uuid = new Map(nodes.map(n => [n.uuid, n]))
  const out = []
  const seen = new Set()
  for (let u = uuid; u && !seen.has(u); u = parent.get(u)) {
    seen.add(u)
    const n = by_uuid.get(u)
    if (n) out.unshift(n)
  }
  return out
}

async function grants_matching (auth, pattern) {
  const all = await Promise.all(I3X_PERMS.map(permission =>
    auth.find_grants({ ...pattern, permission }).catch(() => [])))
  const ids = [...new Set(all.flat())]
  const grants = await Promise.all(ids.map(uuid =>
    auth.get_grant(uuid).then(g => ({ ...g, uuid })).catch(() => null)))
  return grants.filter(Boolean)
}

/* Every grant that lets someone read `target`, with the reason:
 *  - 'direct': a grant on the target itself; these can be removed here;
 *  - 'node':   a grant on an ISA-95 node above it (`via` lists them);
 *  - 'class':  a plural grant on a class the device is a member of;
 *  - 'all':    the wildcard, every device.
 * Grants the caller may not read are left out by the Auth service.
 *
 * @param client the service client
 * @param target { uuid, device: true when it is a device }
 * @param via [{ uuid, name }] ISA-95 nodes above the target */
export async function read_access (client, { target, via = [] }) {
  const auth = client.Auth
  const rows = []
  const push = (grants, reason, through) => {
    for (const g of grants) rows.push({ grant: g, reason, through })
  }

  push(await grants_matching(auth, { target: target.uuid, plural: false }), 'direct', null)
  for (const n of via)
    push(await grants_matching(auth, { target: n.uuid, plural: false }), 'node', n)
  push(await grants_matching(auth, { target: UUIDs.Special.Null }), 'all', null)

  if (target.device) {
    const plural = await grants_matching(auth, { plural: true })
    const classes = [...new Set(plural.map(g => g.target))]
    const member = new Map(await Promise.all(classes.map(async c => [c,
      await client.ConfigDB.class_has_member(c, target.uuid).catch(() => false)])))
    push(plural.filter(g => member.get(g.target)), 'class', null)
  }
  return rows
}

const ROUTE_ORDER = { direct: 0, node: 1, class: 2, all: 3 }

/* One entry per principal from read_access rows, with every route that
 * lets them in, the removable ones first. Principals with a grant on
 * the target itself come first; the order is otherwise kept.
 *
 * @returns [{ principal, routes: [row], here: bool }] */
export function by_principal (rows) {
  const out = new Map()
  for (const r of rows) {
    const p = r.grant.principal
    if (!out.has(p)) out.set(p, { principal: p, routes: [], here: false })
    const e = out.get(p)
    if (e.routes.some(o => o.grant.uuid === r.grant.uuid && o.reason === r.reason)) continue
    e.routes.push(r)
    if (r.reason === 'direct') e.here = true
  }
  const list = [...out.values()]
  for (const e of list) e.routes.sort((a, b) => ROUTE_ORDER[a.reason] - ROUTE_ORDER[b.reason])
  return [...list.filter(e => e.here), ...list.filter(e => !e.here)]
}

/* How many devices sit under the vocabulary node `uuid`, given each
 * device's hierarchy names, Enterprise first. */
export function devices_under (nodes, chains, uuid) {
  return chains.filter(c => resolve_isa95(nodes, c).some(n => n.uuid === uuid)).length
}
