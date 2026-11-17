/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * A split driver whose DriverDef has `hostPorts` (the UDP driver) gets
 * its port opened on the host, from the connection's config. These
 * check that the Edge Agent Deployment values carry the port and
 * follow the config, and that the Manager refuses a save or a move
 * that would open a port twice on one host, or leave such a
 * connection's Edge Agent floating in a cluster with several hosts.
 */

import { describe, it, expect } from 'vitest'

import { set_driver_ids } from '@amrc-factoryplus/service-client'

import { applyConnection, deploymentDrivers } from '../src/utils/edgeAgentConfigUpdater.js'
import { hostCount, hostPortClash, moveHostClash, pinnedHost } from '../src/utils/hostPorts.js'

/* As acs-service-setup/dumps/edge.yaml has them. */
const UDP = {
  image: { repository: 'edge-udp' },
  hostPorts: [{ protocol: 'UDP', field: 'port' }],
}
const REST = { image: { repository: 'edge-rest' } }
const BUILTIN_UDP = { internal: { connType: 'UDP', details: 'UDPConnDetails' } }

/* A connection store entry, with the bindings useConnectionStore makes. */
const conn = (uuid, name, driver, config, edgeAgent = 'agent-a', topology = {}) => ({
  uuid, name,
  configuration: { config, driver, edgeAgent, topology },
})

/* Node store entries: where each Edge Agent runs. */
const node = (uuid, cluster, hostname) => ({ uuid, name: uuid, deployment: { cluster, hostname } })

/* Edge cluster store entries, with the hosts edge-sync reports. */
const cluster = (uuid, ...hostnames) => ({
  uuid, status: { hosts: hostnames.map(hostname => ({ hostname })) },
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

describe('pinnedHost and hostCount', () => {
  it('treats no hostname and "Floating" as not pinned', () => {
    expect(pinnedHost(undefined)).toBeUndefined()
    expect(pinnedHost(null)).toBeUndefined()
    expect(pinnedHost('Floating')).toBeUndefined()
    expect(pinnedHost('host-a')).toBe('host-a')
  })

  it('counts reported hosts, and knows nothing when none are reported', () => {
    expect(hostCount(cluster('c', 'a', 'b'))).toBe(2)
    expect(hostCount(cluster('c'))).toBeUndefined()
    expect(hostCount({ status: {} })).toBeUndefined()
    expect(hostCount(undefined)).toBeUndefined()
  })
})

/* One cluster with two hosts, one with a single host, and one that
 * reports none. */
const clusters = [
  cluster('multi', 'host-a', 'host-b'),
  cluster('single', 'only'),
  cluster('unknown'),
]
const nodes = [
  node('agent-a', 'multi', 'host-a'),
  node('agent-b', 'multi', 'host-b'),
  node('agent-float', 'multi', null),
  node('agent-single', 'single', null),
  node('agent-unknown', 'unknown', null),
]
const stores = connections => ({ connections, nodes, clusters })

describe('hostPortClash: saving a connection', () => {
  const existing = [
    conn('u1', 'robot', UDP, { port: 5000 }, 'agent-a'),
    conn('u2', 'robot-b', UDP, { port: 6000 }, 'agent-b'),
    conn('r1', 'web', REST, { port: 7000 }, 'agent-a'),
  ]
  const saving = (port, agent = 'agent-a', more) => ({
    name: 'new-robot', config: { port }, driverdef: UDP,
    node: nodes.find(n => n.uuid === agent), ...more,
  })

  it('refuses a port another connection on the host uses', () => {
    expect(hostPortClash(saving(5000), stores(existing))).toBe(
      'UDP port 5000 is already used by connection "robot", which can run on the same host. Choose another port.')
  })

  it('accepts a free port, or one used on another host', () => {
    expect(hostPortClash(saving(5001), stores(existing))).toBeUndefined()
    expect(hostPortClash(saving(6000), stores(existing))).toBeUndefined()
  })

  it('ignores drivers that do not listen', () => {
    expect(hostPortClash(saving(7000), stores(existing))).toBeUndefined()
    expect(hostPortClash(saving(5000, 'agent-a', { driverdef: REST }), stores(existing))).toBeUndefined()
    expect(hostPortClash(saving(5000, 'agent-float', { driverdef: REST }), stores(existing))).toBeUndefined()
  })

  it('does not clash with the connection being edited', () => {
    expect(hostPortClash(saving(5000, 'agent-a', { uuid: 'u1', name: 'robot' }), stores(existing)))
      .toBeUndefined()
  })

  it('finds where a connection runs from its Edge Agent, not its own topology copy', () => {
    /* The topology copy says another host; the agent is on host-a. */
    const stale = [conn('u1', 'robot', UDP, { port: 5000 }, 'agent-a', { hostname: 'host-b' })]
    expect(hostPortClash(saving(5000), stores(stale))).toMatch(/"robot"/)
  })

  it('falls back on the topology copy for an agent the store does not know', () => {
    const orphan = [conn('u9', 'orphan', UDP, { port: 5000 }, 'gone', { cluster_uuid: 'multi', hostname: 'host-a' })]
    expect(hostPortClash(saving(5000), stores(orphan))).toMatch(/"orphan"/)
    expect(hostPortClash(saving(5000, 'agent-b'), stores(orphan))).toBeUndefined()
  })

  it('refuses an unpinned Edge Agent in a cluster with several hosts', () => {
    expect(hostPortClash(saving(5001, 'agent-float'), stores(existing))).toBe(
      'This connection opens UDP port 5001 on the host its Edge Agent runs on, so the device '
      + 'needs to know which host that is. This cluster has 2 hosts and the Edge Agent is not '
      + 'pinned to one. Move the Edge Agent to a host first, then save the connection.')
  })

  it('treats "Floating" as unpinned', () => {
    const floating = { uuid: 'agent-f2', deployment: { cluster: 'multi', hostname: 'Floating' } }
    expect(hostPortClash(saving(5001, 'agent-a', { node: floating }), stores(existing)))
      .toMatch(/not pinned/)
  })

  it('allows an unpinned Edge Agent in a cluster with one host', () => {
    expect(hostPortClash(saving(5000, 'agent-single'), stores(existing))).toBeUndefined()
  })

  it('allows an unpinned Edge Agent when the cluster reports no hosts', () => {
    expect(hostPortClash(saving(5000, 'agent-unknown'), stores(existing))).toBeUndefined()
  })

  it('still checks ports for an unpinned agent in a one-host cluster', () => {
    const there = [conn('s1', 'other', UDP, { port: 5000 }, 'agent-single')]
    expect(hostPortClash(saving(5000, 'agent-single'), stores(there))).toMatch(/"other"/)
  })
})

describe('moveHostClash: moving an Edge Agent', () => {
  const connections = [
    conn('u1', 'robot', UDP, { port: 5000 }, 'agent-a'),
    conn('r1', 'web', REST, {}, 'agent-a'),
    conn('u2', 'robot-b', UDP, { port: 5000 }, 'agent-b'),
    conn('u3', 'robot-c', UDP, { port: 6000 }, 'agent-b'),
  ]
  const move = (agent, hostname, cluster = 'multi') => ({ agent, cluster, hostname })

  it('refuses a move onto a host where another agent uses the port', () => {
    expect(moveHostClash(move('agent-a', 'host-b'), stores(connections))).toBe(
      'Connection "robot" on this Edge Agent uses UDP port 5000, which is already used by '
      + 'connection "robot-b" on that host. Change one of the ports, or pick another host.')
  })

  it('allows a move onto a host where the port is free', () => {
    const free = connections.filter(c => c.uuid !== 'u2')
    expect(moveHostClash(move('agent-a', 'host-b'), stores(free))).toBeUndefined()
  })

  it('refuses unpinning an agent with a listening connection in a cluster with several hosts', () => {
    expect(moveHostClash(move('agent-a', null), stores(connections))).toBe(
      'Connection "robot" opens UDP port 5000 on the host this Edge Agent runs on, so it must '
      + 'stay pinned to one of the 2 hosts in this cluster. Pick a host instead of Floating.')
  })

  it('allows unpinning in a cluster with one host, or one that reports none', () => {
    const one = [conn('s1', 'robot', UDP, { port: 5000 }, 'agent-x')]
    expect(moveHostClash(move('agent-x', null, 'single'), stores(one))).toBeUndefined()
    expect(moveHostClash(move('agent-x', null, 'unknown'), stores(one))).toBeUndefined()
  })

  it('does not check an agent whose connections do not listen', () => {
    const quiet = [conn('r1', 'web', REST, {}, 'agent-a'), conn('u2', 'robot-b', UDP, { port: 5000 }, 'agent-b')]
    expect(moveHostClash(move('agent-a', null), stores(quiet))).toBeUndefined()
    expect(moveHostClash(move('agent-a', 'host-b'), stores(quiet))).toBeUndefined()
  })

  it('does not compare an agent\'s connections with each other', () => {
    const own = [
      conn('u1', 'robot', UDP, { port: 5000 }, 'agent-a'),
      conn('u4', 'robot-2', UDP, { port: 5000 }, 'agent-a'),
    ]
    expect(moveHostClash(move('agent-a', 'host-b'), stores(own))).toBeUndefined()
  })
})
