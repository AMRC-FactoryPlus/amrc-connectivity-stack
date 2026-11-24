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

/** The lines that say what a delete takes with it. */
export function delete_lines (plan) {
  const lines = []
  const list = items => items.map(i => i.name || i.uuid).join(', ')
  if (plan.connections.length)
    lines.push(`${plan.connections.length === 1 ? 'Its connection' : `Its ${plan.connections.length} connections`} (${list(plan.connections)}) and their stored passwords are deleted too.`)
  if (plan.devices.length)
    lines.push(`${plan.devices.length === 1 ? 'Its device' : `Its ${plan.devices.length} devices`} (${list(plan.devices)}) ${plan.devices.length === 1 ? 'is' : 'are'} deleted too.`)
  lines.push('The edge agent is removed from the cluster, with its account and any permissions granted on it. The cluster itself is not changed.')
  return lines
}
