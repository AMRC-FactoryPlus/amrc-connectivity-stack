/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * A split driver whose DriverDef has `hostPorts` (the UDP driver)
 * opens its port on the host the Edge Agent runs on, so a device
 * outside the cluster sends to that host's address. The Manager
 * guards this when it saves a connection and when it moves an Edge
 * Agent:
 *
 *  - each port can be open once on a host, so two connections that
 *    can run on one host must not share a port;
 *  - in a cluster with more than one host, the Edge Agent must be
 *    pinned to a host, or the device cannot know where to send.
 *
 * These checks are in the Manager only, so a connection that already
 * breaks them still deploys. Service-setup's split driver move
 * (acs-service-setup/lib/split-drivers.js) checks ports the same way
 * before it moves a connection, but not pinning.
 */

import { driver_ports, port_clashes } from '@amrc-factoryplus/service-client'

/** Where a node (Edge Agent) runs: its cluster and the host it is
 * pinned to. Both are on its Edge deployment config. A hostname in the
 * deployment's values wins, because edge-sync merges the values over
 * the chart's last.
 * @param {Object} node - A node store entry
 */
export function nodePlace (node) {
  const deployment = node?.deployment
  return {
    cluster: deployment?.cluster,
    hostname: pinnedHost(deployment?.values?.hostname ?? deployment?.hostname),
  }
}

/* Where a connection runs: where its Edge Agent runs, from the node
 * store. A connection whose agent is not in the store falls back on its
 * own `topology` copy. The store binds `topology.cluster` to the
 * cluster's config and keeps the UUID as `cluster_uuid`. */
function connectionPlace (conn, nodes) {
  const agent = conn.configuration?.edgeAgent
  const node = agent && nodes.find(n => n.uuid === agent)
  if (node) return nodePlace(node)
  const topology = conn.configuration?.topology
  return {
    cluster: topology?.cluster_uuid ?? topology?.cluster,
    hostname: pinnedHost(topology?.hostname),
  }
}

/** The hostname an Edge Agent is pinned to, or undefined if it floats.
 * The Manager writes "Floating" in places for no host.
 * @param {string} [hostname]
 */
export function pinnedHost (hostname) {
  return hostname && hostname !== 'Floating' ? hostname : undefined
}

/**
 * How many hosts a cluster reports, or undefined if it reports none.
 *
 * edge-sync writes every Kubernetes node into the cluster's status,
 * including hosts that are not ready and specialised hosts. A cluster
 * that reports no hosts may not be bootstrapped yet, or edge-sync may be
 * down, so its host count is unknown rather than zero.
 *
 * @param {Object} cluster - An edge cluster store entry
 * @returns {number|undefined}
 */
export function hostCount (cluster) {
  const hosts = cluster?.status?.hosts
  return Array.isArray(hosts) && hosts.length ? hosts.length : undefined
}

/* A connection in the form port_clashes takes. */
function placed (conn, nodes) {
  return {
    name: conn.name ?? conn.uuid,
    ...connectionPlace(conn, nodes),
    ports: driver_ports(conn.configuration, conn.configuration?.driver),
  }
}

/* The first clash between one connection and a list of others. */
function firstClash (me, others) {
  return others
    .map(other => port_clashes([me, other])[0])
    .find(c => c)
}

function clashMessage (clash) {
  return `${clash.protocol} port ${clash.port} is already used by connection `
    + `"${clash.names[1]}", which can run on the same host.`
}

function portList (ports) {
  return ports.map(p => `${p.protocol} port ${p.port}`).join(' and ')
}

/* Refuse when the agent floats in a cluster with several hosts. A
 * cluster whose host count is unknown may have one host, so it is
 * allowed. */
function unpinnedProblem (cluster, hostname) {
  if (pinnedHost(hostname)) return false
  const hosts = hostCount(cluster)
  return hosts !== undefined && hosts > 1 ? hosts : false
}

/**
 * Check a connection about to be saved: its Edge Agent must be pinned
 * to a host if its cluster has more than one, and no other connection
 * that can run on the same host may use its port.
 *
 * @param {Object} saving - The connection being saved
 * @param {string} [saving.uuid] - Its UUID, if it exists already
 * @param {string} saving.name - Its name
 * @param {Object} saving.config - Its connection details
 * @param {Object} saving.driverdef - Its DriverDef
 * @param {Object} saving.node - Its node store entry
 * @param {Object} stores
 * @param {Array} stores.connections - The connection store entries
 * @param {Array} stores.nodes - The node store entries
 * @param {Array} stores.clusters - The edge cluster store entries
 * @returns {string|undefined} - Why it can't be saved, or undefined
 */
export function hostPortClash (saving, { connections = [], nodes = [], clusters = [] }) {
  const ports = driver_ports({ config: saving.config }, saving.driverdef)
  if (!ports.length) return

  const place = nodePlace(saving.node)
  const cluster = clusters.find(c => c.uuid === place.cluster)
  const hosts = unpinnedProblem(cluster, place.hostname)
  if (hosts) {
    return `This connection opens ${portList(ports)} on the host its Edge Agent `
      + `runs on, so the device needs to know which host that is. This cluster `
      + `has ${hosts} hosts and the Edge Agent is not pinned to one. Move the `
      + `Edge Agent to a host first, then save the connection.`
  }

  const me = { name: saving.name, ...place, ports }
  const others = connections
    .filter(c => c.uuid !== saving.uuid)
    .map(c => placed(c, nodes))

  /* Only clashes with this connection: others that already clash are
   * not this save's problem. */
  const clash = firstClash(me, others)
  if (clash) return `${clashMessage(clash)} Choose another port.`
}

/**
 * Check an Edge Agent about to be moved to another host, or left to
 * float. Its connections go with it, so the same rules apply as when
 * they are saved: it must stay pinned if its cluster has more than one
 * host, and no connection that can run on the new host may use their
 * ports.
 *
 * @param {Object} move
 * @param {string} move.agent - The Edge Agent's (node's) UUID
 * @param {string} move.cluster - Its cluster's UUID
 * @param {string|null} move.hostname - The host it moves to, or null to float
 * @param {Object} stores - As for hostPortClash
 * @returns {string|undefined} - Why it can't move, or undefined
 */
export function moveHostClash (move, { connections = [], nodes = [], clusters = [] }) {
  const to = { cluster: move.cluster, hostname: pinnedHost(move.hostname) }
  const listening = connections
    .filter(c => c.configuration?.edgeAgent === move.agent)
    .map(c => ({ ...placed(c, nodes), ...to }))
    .filter(c => c.ports.length)
  if (!listening.length) return

  const cluster = clusters.find(c => c.uuid === move.cluster)
  const hosts = unpinnedProblem(cluster, to.hostname)
  if (hosts) {
    return `Connection "${listening[0].name}" opens ${portList(listening[0].ports)} on the host `
      + `this Edge Agent runs on, so it must stay pinned to one of the ${hosts} `
      + `hosts in this cluster. Pick a host instead of Floating.`
  }

  /* The agent's own connections move together. A clash between them is
   * caught when they are saved. */
  const others = connections
    .filter(c => c.configuration?.edgeAgent !== move.agent)
    .map(c => placed(c, nodes))
  for (const me of listening) {
    const clash = firstClash(me, others)
    if (clash) {
      return `Connection "${me.name}" on this Edge Agent uses ${clash.protocol} port `
        + `${clash.port}, which is already used by connection "${clash.names[1]}" `
        + `on that host. Change one of the ports, or pick another host.`
    }
  }
}
