/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * A split driver whose DriverDef has `hostPorts` (the UDP driver) gets
 * its port opened on the node, from the connection's config. These
 * check that the Edge Agent Deployment values carry the port and
 * follow the config, and that a save that would open a port twice on
 * one host is refused.
 */

import { describe, it, expect } from 'vitest'

import { set_driver_ids } from '@amrc-factoryplus/service-client'

import { applyConnection, deploymentDrivers } from '../src/utils/edgeAgentConfigUpdater.js'
import { hostPortClash } from '../src/utils/hostPorts.js'

/* As acs-service-setup/dumps/edge.yaml has them. */
const UDP = {
  image: { repository: 'edge-udp' },
  hostPorts: [{ protocol: 'UDP', field: 'port' }],
}
const REST = { image: { repository: 'edge-rest' } }
const BUILTIN_UDP = { internal: { connType: 'UDP', details: 'UDPConnDetails' } }

/* A connection store entry, with the bindings useConnectionStore makes. */
const conn = (uuid, name, driver, config, topology = {}) => ({
  uuid, name,
  configuration: {
    config, driver,
    topology: { cluster: { name: 'bound' }, cluster_uuid: 'cluster-1', hostname: 'host-a', ...topology },
  },
})

const entries = connections => set_driver_ids(connections.map(c => ({
  ...applyConnection(null, c), devices: [{ deviceId: 'd' }],
})))

describe('deploymentDrivers with a UDP driver', () => {
  it('opens the connection\'s port on its sidecar only', () => {
    const connections = [
      conn('u1', 'robot', UDP, { port: 5000 }),
      conn('r1', 'web', REST, { baseURL: 'http://x' }),
      conn('b1', 'old-udp', BUILTIN_UDP, { port: 50205 }),
    ]
    expect(deploymentDrivers(entries(connections), connections)).toEqual({
      robot: { image: UDP.image, hostPorts: [{ protocol: 'UDP', port: 5000 }] },
      web: { image: REST.image },
    })
  })

  it('follows a change to the port', () => {
    const before = [conn('u1', 'robot', UDP, { port: 5000 })]
    const after = [conn('u1', 'robot', UDP, { port: 6000 })]
    expect(deploymentDrivers(entries(before), before).robot.hostPorts)
      .toEqual([{ protocol: 'UDP', port: 5000 }])
    expect(deploymentDrivers(entries(after), after).robot.hostPorts)
      .toEqual([{ protocol: 'UDP', port: 6000 }])
  })
})

describe('hostPortClash', () => {
  const node = { cluster: 'cluster-1', hostname: 'host-a' }
  const saving = (port, more) => ({
    name: 'new-robot', config: { port }, driverdef: UDP, node, ...more,
  })
  const existing = [
    conn('u1', 'robot', UDP, { port: 5000 }),
    conn('u2', 'robot-b', UDP, { port: 6000 }, { hostname: 'host-b' }),
    conn('r1', 'web', REST, { port: 7000 }),
  ]

  it('refuses a port another connection on the host uses', () => {
    expect(hostPortClash(saving(5000), existing)).toBe(
      'UDP port 5000 is already used by connection "robot", which can run on the same host. Choose another port.')
  })

  it('accepts a free port, or one used on another host', () => {
    expect(hostPortClash(saving(5001), existing)).toBeUndefined()
    expect(hostPortClash(saving(6000), existing)).toBeUndefined()
  })

  it('ignores drivers that do not listen', () => {
    expect(hostPortClash(saving(7000), existing)).toBeUndefined()
    expect(hostPortClash(saving(5000, { driverdef: REST }), existing)).toBeUndefined()
  })

  it('does not clash with the connection being edited', () => {
    expect(hostPortClash(saving(5000, { uuid: 'u1', name: 'robot' }), existing)).toBeUndefined()
  })

  it('treats a node not pinned to a host as on every host', () => {
    expect(hostPortClash(saving(6000, { node: { cluster: 'cluster-1' } }), existing))
      .toMatch(/"robot-b"/)
  })

  it('does not look at other clusters', () => {
    expect(hostPortClash(saving(5000, { node: { cluster: 'cluster-2', hostname: 'host-a' } }), existing))
      .toBeUndefined()
  })
})
