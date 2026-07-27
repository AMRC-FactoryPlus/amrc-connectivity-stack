/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { updateEdgeAgentConfig } from '@utils/edgeAgentConfigUpdater.js'

/**
 * Move an edge deployment (node, bridge or plain edge deployment) onto a
 * different host in the same cluster.
 *
 * The hostname on the Edge deployment config is the only field that
 * actually schedules anything; edge-sync turns it into a
 * kubernetes.io/hostname node selector. Connections under a node carry a
 * denormalised copy in topology.hostname which we keep in step, and may
 * carry host paths which are physical device paths on the old machine.
 *
 * Writes happen in this order deliberately:
 *
 *   1. the connections, which are metadata only
 *   2. the edge agent config for any connection whose host paths changed
 *      (this rewrites the whole Edge deployment doc, so it has to happen
 *      before we touch the hostname)
 *   3. the deployment's own hostname, last
 *
 * A failure part-way through therefore leaves the deployment where it
 * was, which is the state the operator already understands, rather than
 * a moved deployment with stale metadata.
 *
 * @arg opts.deploymentUuid The node/bridge/deployment UUID
 * @arg opts.hostname The target hostname, or null for Floating
 * @arg opts.connections Connections under this deployment, each
 *   `{ uuid, name, hostPaths, hostPathsChanged }`
 * @returns `{ failed }`, a list of names we could not update
 */
export async function moveHost ({ deploymentUuid, hostname, connections = [] }) {
  const cdb = useServiceClientStore().client.ConfigDB
  const failed = []

  for (const conn of connections) {
    const patch = {
      topology: {
        hostname: hostname ?? null,
      },
    }

    if (conn.hostPathsChanged) {
      patch.deployment = {
        hostPaths: conn.hostPaths?.length ? conn.hostPaths : null,
      }
    }

    try {
      await cdb.patch_config(UUIDs.App.ConnectionConfiguration, conn.uuid,
        'merge', patch)
    }
    catch (err) {
      console.error('Unable to update connection %s: %o', conn.uuid, err)
      failed.push(conn.name)
    }
  }

  /* Push edited host paths through into the edge agent's Helm values.
   * updateEdgeAgentConfig rebuilds values.drivers from the connections
   * and writes the whole deployment document back. */
  for (const conn of connections) {
    if (!conn.hostPathsChanged || failed.includes(conn.name)) continue
    try {
      await updateEdgeAgentConfig({ connectionId: conn.uuid })
    }
    catch (err) {
      console.error('Unable to update edge agent config for %s: %o',
        conn.uuid, err)
      failed.push(conn.name)
    }
  }

  await cdb.patch_config(UUIDs.App.EdgeAgentDeployment, deploymentUuid,
    'merge', { hostname: hostname ?? null })

  return { failed }
}
