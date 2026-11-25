/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Deleting an edge node. The Cluster Manager does the work, because a
 * node is spread across the ConfigDB, Auth, the edge cluster and the
 * cluster's repo, and has to be taken apart in order. */

import { UUIDs } from '@amrc-factoryplus/service-client'

/**
 * Ask what deleting a node would remove, and whether this person may.
 * Resolves with { allowed, name, connections, devices }, or with
 * { allowed: false } when the Cluster Manager can't be asked or the
 * node can't be deleted from this cluster.
 */
export async function node_delete_plan (client, cluster, node) {
  if (!cluster || !node) return { allowed: false }
  try {
    const res = await client.Fetch.fetch({
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${cluster}/node/${node}/delete`,
    })
    if (res?.status !== 200) return { allowed: false }
    const body = await res.json()
    return {
      allowed: body?.allowed === true,
      name: body?.name ?? '',
      connections: Array.isArray(body?.connections) ? body.connections : [],
      devices: Array.isArray(body?.devices) ? body.devices : [],
    }
  }
  catch {
    return { allowed: false }
  }
}

/**
 * Start deleting a node. The Cluster Manager answers at once and works
 * in the background. Rejects with a message for a person.
 */
export async function delete_node (client, cluster, node) {
  let res
  try {
    res = await client.Fetch.fetch({
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${cluster}/node/${node}`,
      method: 'DELETE',
    })
  }
  catch {
    throw new Error('The Cluster Manager did not answer. Check your network connection and try again.')
  }
  const status = res?.status ?? 0
  if (status === 202) return
  if (status === 403) throw new Error('You need the Manage clusters permission on this cluster to delete a node.')
  if (status === 404) throw new Error('This node no longer exists.')
  if (status === 409) throw new Error('This node belongs to a different cluster.')
  throw new Error(`The Cluster Manager could not delete this node (status ${status}).`)
}

/* Names joined for a sentence: "A", "A and B", "A, B and C". Long
 * lists name the first few and count the rest. */
const MAX_NAMES = 3

function name_list (items) {
  const names = items.map(i => i.name || i.uuid)
  if (names.length > MAX_NAMES) {
    const shown = names.slice(0, MAX_NAMES)
    return `${shown.join(', ')} and ${names.length - MAX_NAMES} more`
  }
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

function things (items, one, many) {
  return items.length === 1 ? `${one} ${name_list(items)}` : `${items.length} ${many} ${name_list(items)}`
}

/**
 * The subtitle of the delete dialog: the node, its cluster, and the
 * connections and devices that go with it.
 */
export function delete_message (name, cluster, plan) {
  const conns = plan?.connections ?? []
  const devs = plan?.devices ?? []
  const parts = []
  if (conns.length) parts.push(`its ${things(conns, 'connection', 'connections')}`)
  if (devs.length) parts.push(`${conns.length ? '' : 'its '}${things(devs, 'device', 'devices')}`)
  const plural = conns.length > 1 || devs.length > 1
  const goes_with = parts.length ? `, with ${parts.join(plural ? ', and ' : ' and ')}` : ''
  return `${name} on ${cluster ?? 'its cluster'}${goes_with}. You cannot undo this.`
}
