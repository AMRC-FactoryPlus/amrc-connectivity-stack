/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { driver_ports, port_clashes } from '@amrc-factoryplus/service-client'

/* The cluster UUID of a connection store entry's topology. The store
 * binds `topology.cluster` to the cluster's config and keeps the UUID
 * as `cluster_uuid`. */
function clusterOf (topology) {
  return topology?.cluster_uuid ?? topology?.cluster
}

/**
 * Check a connection about to be saved against the other connections
 * for host ports that would clash on a node. A split driver whose
 * DriverDef has `hostPorts` (the UDP driver) opens its port on the node
 * the Edge Agent runs on, and a node can open each port once.
 *
 * @param {Object} saving - The connection being saved
 * @param {string} [saving.uuid] - Its UUID, if it exists already
 * @param {string} saving.name - Its name
 * @param {Object} saving.config - Its connection details
 * @param {Object} saving.driverdef - Its DriverDef
 * @param {Object} saving.node - Its node, with `cluster` and `hostname`
 * @param {Array} connections - The connection store entries
 * @returns {string|undefined} - A message naming the clash, or undefined
 */
export function hostPortClash (saving, connections) {
  const ports = driver_ports({ config: saving.config }, saving.driverdef)
  if (!ports.length) return

  const me = {
    name: saving.name,
    cluster: saving.node?.cluster,
    hostname: saving.node?.hostname,
    ports,
  }
  const others = connections
    .filter(c => c.uuid !== saving.uuid)
    .map(c => ({
      name: c.name ?? c.uuid,
      cluster: clusterOf(c.configuration?.topology),
      hostname: c.configuration?.topology?.hostname,
      ports: driver_ports(c.configuration, c.configuration?.driver),
    }))

  /* Only clashes with this connection: others that already clash are
   * not this save's problem. */
  const clash = others
    .map(other => port_clashes([me, other])[0])
    .find(c => c)
  if (!clash) return
  return `${clash.protocol} port ${clash.port} is already used by connection `
    + `"${clash.names[1]}", which can run on the same host. Choose another port.`
}
