/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Deleting an edge cluster. The Cluster Manager does the work, because
 * a cluster is spread across the ConfigDB, Auth, the KDC and the Git
 * service. It only deletes a cluster which is offline. */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { things } from '@/lib/node-delete.js'

/**
 * Ask what deleting a cluster would remove, and whether this person
 * may. Resolves with { allowed, name, online, nodes, deployments }, or
 * with { allowed: false } when the Cluster Manager can't be asked.
 * `online` lists the cluster's Sparkplug nodes that are still online.
 */
export async function cluster_delete_plan (client, cluster) {
  if (!cluster) return { allowed: false }
  try {
    const res = await client.Fetch.fetch({
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${cluster}/delete`,
    })
    if (res?.status !== 200) return { allowed: false }
    const body = await res.json()
    const list = v => Array.isArray(v) ? v : []
    return {
      allowed: body?.allowed === true,
      name: body?.name ?? '',
      online: list(body?.online),
      nodes: list(body?.nodes),
      deployments: list(body?.deployments),
    }
  }
  catch {
    return { allowed: false }
  }
}

/**
 * Start deleting a cluster. The Cluster Manager answers at once and
 * works in the background. Rejects with a message for a person.
 */
export async function delete_cluster (client, cluster) {
  let res
  try {
    res = await client.Fetch.fetch({
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${cluster}`,
      method: 'DELETE',
    })
  }
  catch {
    throw new Error('The Cluster Manager did not answer. Check your network connection and try again.')
  }
  const status = res?.status ?? 0
  if (status === 202) return
  if (status === 403) throw new Error('You need the Delete clusters permission to delete a cluster.')
  if (status === 404) throw new Error('This cluster no longer exists.')
  if (status === 409) throw new Error(ONLINE_MESSAGE)
  throw new Error(`The Cluster Manager could not delete this cluster (status ${status}).`)
}

/** Why a running cluster can't be deleted, and what to do about it. */
export const ONLINE_MESSAGE = 'This cluster is still online. Shut down its hosts, or remove ACS from them, then try again.'

/**
 * The subtitle of the delete dialog: the cluster, and the nodes and
 * other deployments that go with it.
 */
export function cluster_delete_message (name, plan) {
  const nodes = plan?.nodes ?? []
  const deps = plan?.deployments ?? []
  const parts = []
  if (nodes.length) parts.push(`its ${things(nodes, 'node', 'nodes')}`)
  if (deps.length) parts.push(`${nodes.length ? '' : 'its '}${things(deps, 'deployment', 'deployments')}`)
  const plural = nodes.length > 1 || deps.length > 1
  const goes_with = parts.length ? `, with ${parts.join(plural ? ', and ' : ' and ')}` : ''
  return `${name}${goes_with}. Its accounts, repository and settings are deleted too. You cannot undo this.`
}
