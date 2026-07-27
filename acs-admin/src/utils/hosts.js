/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Is this hostname one the cluster is currently reporting?
 *
 * A deployment with no hostname is Floating and is always fine. If the
 * cluster is not reporting any hosts at all we have no information (the
 * cluster may not be bootstrapped, or edge-sync may be down) so we say
 * nothing rather than marking every deployment as stale.
 *
 * @param {Object} cluster - an edge cluster from the edge cluster store
 * @param {string} [hostname] - the hostname to check
 * @returns {boolean}
 */
export function hostIsKnown (cluster, hostname) {
  if (!hostname || hostname === 'Floating') return true

  const hosts = cluster?.status?.hosts
  if (!Array.isArray(hosts) || hosts.length === 0) return true

  return hosts.some(h => h.hostname === hostname)
}

/**
 * The warning to show against a hostname that is no longer part of its
 * cluster, or null if there is nothing to say.
 *
 * @param {Object} cluster - an edge cluster from the edge cluster store
 * @param {string} [hostname] - the hostname to check
 * @returns {string|null}
 */
export function staleHostWarning (cluster, hostname) {
  return hostIsKnown(cluster, hostname)
    ? null
    : 'This host is not currently part of the cluster. Anything pinned to it cannot be scheduled.'
}
