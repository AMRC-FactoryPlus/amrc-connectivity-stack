/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* An edge cluster with two hosts and two nodes, and a Cluster Manager
 * that answers the delete plan. Not part of the shipped application. */

export const CLUSTER = 'c0000000-0000-4000-8000-0000000000a1'

export const clusters = [{
  uuid: CLUSTER,
  name: 'Cell 4 gateway',
  sparkplug: 'Cell_4_Gateway',
  createdAt: '2026-10-02T09:30:00Z',
  status: {
    hosts: [
      { hostname: 'gateway-1', arch: 'arm64', os_version: 'Ubuntu 24.04', k8s_version: 'v1.31.4+k3s1', control_plane: true, ready: true },
    ],
  },
}]

const node = (uuid, name) => ({
  uuid, name,
  deployment: { cluster: CLUSTER, hostname: 'gateway-1', name },
  sparkplugAddress: null,
})

export const nodes = [
  node('n0000000-0000-4000-8000-0000000000a1', 'Press_Line'),
  node('n0000000-0000-4000-8000-0000000000a2', 'Energy_Meters'),
]

/* `delete` is `offline` (may delete), `online` (may, but the cluster is
 * still running) or `none` (no Delete clusters permission). */
export function make_client (mode) {
  const plan = {
    allowed: mode !== 'none',
    name: 'Cell 4 gateway',
    online: mode === 'online' ? ['m0000000-0000-4000-8000-0000000000a1'] : [],
    nodes: nodes.map(({ uuid, name }) => ({ uuid, name })),
    deployments: [],
  }
  return {
    Fetch: {
      fetch: async ({ method }) => method === 'DELETE'
        ? { status: 202, json: async () => null }
        : { status: 200, json: async () => mode === 'none' ? { allowed: false } : plan },
    },
    ConfigDB: {},
  }
}
