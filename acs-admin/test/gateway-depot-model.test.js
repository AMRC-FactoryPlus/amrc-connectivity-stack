/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Reading a gateway as the Gateway Depot service returns it: the state
 * word and where it sits in the list, whether being out of contact is a
 * fault, the five steps, and the ports. The shapes follow
 * docs/services/gateway-depot.md.
 */

import { describe, it, expect } from 'vitest'

import {
  ago, can_be_replaced, clock, configured_ports, contact_of, disk_size, dur, group_gateways, is_lost, kind_of,
  label_for, link_key, mem_size, name_of, onboarded_text, real, relation_of, replace_candidates, row_of,
  serial_of, service_cluster_text, settings_rows, state_meta, steps_of, subline_of, track_links,
} from '../src/lib/gateway-depot/model.js'

const NOW = 1795090000000
const MIN = 60 * 1000

const nic = (name, mac, link = true, ipv4 = '') => ({ name, mac, link, speed: '1000', driver: 'igc', ipv4 })

/* A gateway in a given state, with the fields that state has by then. */
function gateway (state, over = {}) {
  return {
    id: 'g-' + state,
    state,
    online: true,
    first_seen: NOW - 60 * MIN,
    last_seen: NOW - 3 * MIN,
    remote_ip: '::ffff:10.31.4.57',
    inventory: {
      serial: 'PF550F40', vendor: 'LENOVO', model: 'ThinkEdge SE30', arch: 'amd64', memory: 8589934592, cpus: 4,
      nics: [nic('enp1s0', '00:e0:4c:68:01:a1', true, '10.31.4.57/24'), nic('enp2s0', '00:e0:4c:68:01:a2', false)],
      disks: [{ path: '/dev/nvme0n1', size: 256060514304, model: 'SAMSUNG MZVLB256', serial: 'S4X', transport: 'nvme' }],
    },
    ...over,
  }
}

const SETTINGS = { north_mac: '00:e0:4c:68:01:a1', south_mac: '00:E0:4C:68:01:A2', south_addr: '192.168.1.200/24', disk: '/dev/nvme0n1', admin_user: 'fplus', label: 'tapeline' }

describe('state to label', () => {
  it('gives each state its word, its group and its tone', () => {
    const cases = [
      ['pending', 'Waiting for approval', 'needs', 'action'],
      ['approved', 'Approved', 'working', 'busy'],
      ['installing', 'Installing', 'working', 'busy'],
      ['installed', 'Installed', 'needs', 'action'],
      ['ready', 'Ready to onboard', 'needs', 'action'],
      ['onboarding', 'Onboarding', 'working', 'busy'],
      ['onboarded', 'In service', 'service', 'ok'],
      ['replaced', 'Replaced', 'retired', 'off'],
    ]
    for (const [state, label, group, tone] of cases)
      expect(state_meta(gateway(state))).toEqual({ label, group, tone })
  })

  it('tells a failed install from a failed onboarding', () => {
    expect(state_meta(gateway('failed', { install_failed: true })).label).toBe('Install failed')
    expect(state_meta(gateway('failed', { install_failed: false })).label).toBe('Onboarding failed')
    expect(kind_of(gateway('failed', { install_failed: true }))).toBe('failed-install')
    expect(kind_of(gateway('failed'))).toBe('failed-onboard')
  })

  it('shows a state it does not know instead of hiding the gateway', () => {
    expect(state_meta(gateway('melted'))).toEqual({ group: 'retired', tone: 'off', label: 'State: melted' })
    expect(kind_of(gateway('melted'))).toBe('other')
    expect(steps_of(gateway('melted'))).toEqual([])
  })

  it('shows approved and installing as the same step', () => {
    expect(kind_of(gateway('approved'))).toBe('installing')
    expect(kind_of(gateway('installing'))).toBe('installing')
  })
})

describe('grouping the list', () => {
  const list = [
    gateway('onboarded', { id: 'a' }),
    gateway('pending', { id: 'b' }),
    gateway('onboarded', { id: 'c', online: false }),
    gateway('installing', { id: 'd', online: false }),
    gateway('failed', { id: 'e' }),
    gateway('replaced', { id: 'f', online: false }),
  ]

  it('groups by what needs a person, keeping the order within a group', () => {
    const groups = group_gateways(list)
    expect(groups.map(g => [g.key, g.gateways.map(x => x.id)])).toEqual([
      ['needs', ['b', 'e']],
      ['working', ['d']],
      ['service', ['a', 'c']],
      ['retired', ['f']],
    ])
    expect(groups.map(g => g.label)).toEqual(['Needs you', 'Working...', 'In service', 'Out of service'])
  })

  it('counts the gateways in service that are not in contact', () => {
    const service = group_gateways(list).find(g => g.key === 'service')
    expect(service.count).toBe(2)
    expect(service.quiet).toBe(1)
    expect(group_gateways(list).find(g => g.key === 'needs').count).toBe(2)
  })

  it('leaves out a group with nothing in it', () => {
    expect(group_gateways([gateway('pending')]).map(g => g.key)).toEqual(['needs'])
    expect(group_gateways([])).toEqual([])
    expect(group_gateways(null)).toEqual([])
  })
})

describe('contact', () => {
  it('expects a gateway that is installing to be out of contact', () => {
    for (const state of ['approved', 'installing', 'installed']) {
      const gw = gateway(state, { online: false })
      expect(is_lost(gw)).toBe(false)
      expect(contact_of(gw, NOW)).toEqual({ tone: 'off', warn: false, text: 'Not in contact' })
      expect(row_of(gw, NOW).contact).toBe('')
    }
  })

  it('warns about an onboarded gateway that is not in contact', () => {
    const gw = gateway('onboarded', { online: false })
    expect(is_lost(gw)).toBe(true)
    expect(contact_of(gw, NOW)).toEqual({ tone: 'off', warn: true, text: 'Not in contact. Last seen 3 minutes ago at 10.31.4.57' })
    const row = row_of(gw, NOW)
    expect(row.lost).toBe(true)
    expect(row.tone).toBe('off')
    expect(row.contact).toBe('Not in contact, last seen 3 minutes ago')
  })

  it('warns about a gateway that goes quiet while it waits or onboards', () => {
    for (const state of ['pending', 'ready', 'onboarding'])
      expect(contact_of(gateway(state, { online: false }), NOW).warn).toBe(true)
  })

  it('does not warn about a failed install or a replaced gateway', () => {
    expect(contact_of(gateway('failed', { install_failed: true, online: false }), NOW))
      .toEqual({ tone: 'off', warn: false, text: 'Not in contact. Last seen 3 minutes ago' })
    expect(contact_of(gateway('replaced', { online: false }), NOW))
      .toEqual({ tone: 'off', warn: false, text: 'Out of service. Last seen 3 minutes ago' })
  })

  it('says where a gateway in contact is calling from', () => {
    expect(contact_of(gateway('ready'), NOW)).toEqual({ tone: 'ok', warn: false, text: 'In contact · calling from 10.31.4.57' })
    expect(contact_of(gateway('ready', { remote_ip: null }), NOW).text).toBe('In contact')
  })
})

describe('naming a gateway', () => {
  it('prefers the hostname, then the note, then the hardware', () => {
    const gw = gateway('pending')
    expect(name_of(gw)).toBe('LENOVO ThinkEdge SE30')
    expect(name_of({ ...gw, settings: SETTINGS })).toBe('tapeline')
    expect(name_of({ ...gw, settings: SETTINGS, report: { hostname: 'fpcgw-pf550f40' } })).toBe('fpcgw-pf550f40')
    expect(label_for({ ...gw, settings: SETTINGS, report: { hostname: 'fpcgw-pf550f40' } })).toBe('fpcgw-pf550f40 · tapeline')
    expect(name_of({ id: 'x', state: 'pending' })).toBe('Unidentified gateway')
  })

  it('ignores what firmware reports when a field was never filled in', () => {
    expect(real('To Be Filled By O.E.M.')).toBe('')
    expect(real(' Default string ')).toBe('')
    expect(real('PF550F40')).toBe('PF550F40')
    expect(serial_of(gateway('pending', { inventory: { serial: 'System Serial Number' } }))).toBe('')
  })

  it('falls back to the first port when there is no serial number', () => {
    const gw = gateway('pending')
    gw.inventory = { ...gw.inventory, serial: '0' }
    expect(subline_of(gw)).toBe('no serial number reported · first port 00:e0:4c:68:01:a1')
    expect(row_of(gw, NOW).second).toBe('00:e0:4c:68:01:a1')
    expect(subline_of(gateway('ready', { settings: SETTINGS, report: { hostname: 'h' } })))
      .toBe('tapeline · LENOVO ThinkEdge SE30 · serial PF550F40')
  })
})

describe('the five steps', () => {
  it('marks the step a pending gateway is on as needing a person', () => {
    const steps = steps_of(gateway('pending'))
    expect(steps.map(s => s.status)).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
    expect(steps[0].tag).toBe('needs you now')
    expect(steps.map(s => s.title)).toEqual(['Approve', 'Install', 'Install the gateway at the edge', 'Onboard', 'In service'])
    expect(steps[2].tag).toBe('needs you')
  })

  it('says a step the gateway does by itself is working', () => {
    expect(steps_of(gateway('installing'))[1]).toMatchObject({ status: 'current', tag: 'working...' })
    expect(steps_of(gateway('onboarding'))[3]).toMatchObject({ status: 'current', tag: 'working...' })
  })

  it('puts a failure on the step that failed', () => {
    expect(steps_of(gateway('failed', { install_failed: true })).map(s => s.status))
      .toEqual(['done', 'failed', 'todo', 'todo', 'todo'])
    expect(steps_of(gateway('failed')).map(s => s.status))
      .toEqual(['done', 'done', 'done', 'failed', 'todo'])
  })

  it('finishes every step once the gateway is in service', () => {
    expect(steps_of(gateway('onboarded')).map(s => s.status)).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('says when each finished step finished, where the service recorded it', () => {
    const gw = gateway('ready', { approved_at: 1, installed_at: 2, ready_at: 3 })
    expect(steps_of(gw).map(s => s.at)).toEqual([1, 2, 3, null, null])
    const done = gateway('onboarded', { approved_at: 1, installed_at: 2, ready_at: 3, onboarded_at: 4 })
    expect(steps_of(done).map(s => s.at)).toEqual([1, 2, 3, 4, null])
    /* A record from before the service kept times. */
    expect(steps_of(gateway('ready')).map(s => s.at)).toEqual([null, null, null, null, null])
  })
})

describe('ports', () => {
  it('uses the roles the installed gateway reports', () => {
    const gw = gateway('ready', {
      settings: SETTINGS,
      report: { north: 'enp2s0', south: 'enp1s0', nics: [nic('enp1s0', 'aa'), nic('enp2s0', 'bb'), nic('enp3s0', 'cc')] },
    })
    const { nics, role } = configured_ports(gw)
    expect(nics.map(role)).toEqual(['Southbound', 'Northbound', 'Not used'])
  })

  it('falls back to the ports chosen at approval, whatever the case of the MAC', () => {
    const { nics, role } = configured_ports(gateway('installed', { settings: SETTINGS }))
    expect(nics.map(role)).toEqual(['Northbound', 'Southbound'])
  })

  it('lists the settings chosen at approval', () => {
    expect(settings_rows(gateway('installed', { settings: SETTINGS }))).toEqual([
      ['Northbound port', 'enp1s0 · 00:e0:4c:68:01:a1'],
      ['Southbound port', 'enp2s0 · 00:e0:4c:68:01:a2'],
      ['Southbound address', '192.168.1.200/24'],
      ['Disk', '/dev/nvme0n1'],
      ['Admin user', 'fplus'],
      ['Note', 'tapeline'],
    ])
    expect(settings_rows(gateway('installed', { settings: { north_mac: '00:e0:4c:68:01:a1', south_mac: '', disk: '/dev/sda', admin_user: 'fplus' } }))).toEqual([
      ['Northbound port', 'enp1s0 · 00:e0:4c:68:01:a1'],
      ['Southbound port', 'None'],
      ['Disk', '/dev/sda'],
      ['Admin user', 'fplus'],
    ])
  })

  it('notices a cable being plugged in or pulled out', () => {
    const links = new Map()
    const gw = gateway('pending')
    expect(track_links(links, [gw], NOW)).toEqual([])

    const plugged = structuredClone(gw)
    plugged.inventory.nics[1].link = true
    expect(track_links(links, [plugged], NOW + 2500)).toEqual([{ id: gw.id, port: 'enp2s0', text: 'Cable plugged in a moment ago' }])
    expect(links.get(link_key(gw.id, plugged.inventory.nics[1])).ev).toEqual({ text: 'Cable plugged in a moment ago', at: NOW + 2500 })

    /* Nothing changed: the note stays, but it is not a new change. */
    expect(track_links(links, [plugged], NOW + 5000)).toEqual([])
    expect(links.get(link_key(gw.id, plugged.inventory.nics[1])).ev.at).toBe(NOW + 2500)

    const pulled = structuredClone(plugged)
    pulled.inventory.nics[0].link = false
    pulled.inventory.nics[0].ipv4 = ''
    expect(track_links(links, [pulled], NOW + 7500)).toEqual([{ id: gw.id, port: 'enp1s0', text: 'Cable unplugged a moment ago' }])
  })

  it('notices an address arriving, and forgets a gateway that has gone', () => {
    const links = new Map()
    const gw = gateway('pending')
    track_links(links, [gw], NOW)
    const addressed = structuredClone(gw)
    addressed.inventory.nics[1].ipv4 = '192.168.1.9/24'
    addressed.inventory.nics[1].link = false
    expect(track_links(links, [addressed], NOW + 1)).toEqual([{ id: gw.id, port: 'enp2s0', text: 'Address changed a moment ago' }])
    track_links(links, [], NOW + 2)
    expect(links.size).toBe(0)
  })
})

describe('replacing', () => {
  const made = (id, over = {}) => gateway('onboarded', {
    id, onboard: { mode: 'create', cluster: { uuid: 'c-' + id, name: 'Tapeline' } }, ...over,
  })

  it('offers a gateway that built a cluster and has not been replaced', () => {
    expect(can_be_replaced(made('a'), 'new')).toBe(true)
    expect(can_be_replaced(made('a', { state: 'failed' }), 'new')).toBe(true)
  })

  it('does not offer the gateway itself, a joiner, a failed install or one already replaced', () => {
    expect(can_be_replaced(made('a'), 'a')).toBe(false)
    expect(can_be_replaced(made('a', { onboard: { mode: 'join', server: 'x' } }), 'new')).toBe(false)
    expect(can_be_replaced(made('a', { state: 'failed', install_failed: true }), 'new')).toBe(false)
    expect(can_be_replaced(made('a', { replaced_by: 'z' }), 'new')).toBe(false)
    expect(can_be_replaced(gateway('ready'), 'new')).toBe(false)
  })

  it('lists the gateways that are not in contact first', () => {
    const list = [made('up'), made('down', { online: false }), gateway('pending', { id: 'new' })]
    expect(replace_candidates(list, 'new').map(g => g.id)).toEqual(['down', 'up'])
  })

  it('says how a gateway relates to the one it replaces', () => {
    const old = made('old', { state: 'replaced', replaced_by: 'new' })
    const fresh = gateway('ready', { id: 'new', replaces: 'old', settings: { hostname: 'fpcgw-old' } })
    expect(relation_of(old, [old, fresh])).toEqual({ pre: 'Replaced by ', id: 'new', post: '' })
    expect(relation_of(fresh, [old, fresh])).toEqual({ pre: 'Replaces ', id: 'old', post: ', keeping its hostname' })
    expect(relation_of({ ...fresh, state: 'onboarded', settings: {} }, [])).toEqual({ pre: 'Replaced ', id: 'old', post: ', with a new hostname' })
    /* Approved as a replacement, but the old gateway is not marked yet. */
    const before = made('old')
    expect(relation_of(before, [before, fresh])).toEqual({ pre: 'Being replaced by ', id: 'new', post: '' })
    expect(relation_of(made('alone'), [])).toBe(null)
  })
})

describe('onboarding in words', () => {
  const server = gateway('onboarded', { id: 's', report: { hostname: 'fpcgw-first' } })
  const by_id = new Map([[server.id, server]])

  it('says what onboarding did', () => {
    expect(onboarded_text(gateway('onboarded', { onboard: { mode: 'create' } }), by_id, NOW)).toBe('Created a new edge cluster.')
    expect(onboarded_text(gateway('onboarded', { onboard: { mode: 'join', server: 's' } }), by_id, NOW)).toBe('Joined the cluster of fpcgw-first.')
    expect(onboarded_text(gateway('onboarded', { onboard: { mode: 'join' } }), by_id, NOW)).toBe('Joined an existing cluster.')
    expect(onboarded_text(gateway('onboarded', { replaces: 'x', onboard: { mode: 'create' } }), by_id, NOW))
      .toBe('Took over the cluster of the gateway it replaced.')
    expect(onboarded_text(gateway('onboarded', { onboard: { mode: 'create', by: 'alice@REALM' } }), by_id, NOW))
      .toBe('Created a new edge cluster. Started by alice@REALM.')
  })

  it('names the cluster a gateway in service belongs to', () => {
    const c = (cluster, over = {}) => gateway('onboarded', { onboard: { mode: 'create', cluster, ...over } })
    expect(service_cluster_text(c({ name: 'Tapeline', name_given: 'Tapeline' }), by_id)).toBe('Tapeline')
    expect(service_cluster_text(c({ name: 'Tapeline_2', name_given: 'Tapeline 2' }), by_id)).toBe('Tapeline_2 (entered as Tapeline 2)')
    expect(service_cluster_text(c({ name: 'Tapeline' }, { mode: 'join', server: 's' }), by_id)).toBe('Tapeline, joined through fpcgw-first')
    expect(service_cluster_text(c(undefined, { mode: 'join', server: 'gone' }), by_id)).toBe('An existing cluster, joined through a gateway that is no longer in the list')
  })
})

describe('times and sizes', () => {
  it('rounds a duration to what a person would say', () => {
    expect(dur(20 * 1000)).toBe('less than a minute')
    expect(dur(MIN)).toBe('1 minute')
    expect(dur(59 * MIN)).toBe('59 minutes')
    expect(dur(47 * 60 * MIN)).toBe('47 hours')
    expect(dur(48 * 60 * MIN)).toBe('2 days')
    /* A gateway whose clock runs ahead of this one. */
    expect(dur(-5000)).toBe('less than a minute')
    expect(ago(NOW - 2 * MIN, NOW)).toBe('2 minutes ago')
    expect(ago(null, NOW)).toBe('')
    expect(clock(null)).toBe('')
  })

  it('gives disk sizes in decimal units and memory in binary ones', () => {
    expect(disk_size(256060514304)).toBe('256 GB')
    expect(disk_size(2000398934016)).toBe('2 TB')
    expect(disk_size(1500000000000)).toBe('1.5 TB')
    expect(disk_size(0)).toBe('')
    expect(mem_size(8589934592)).toBe('8 GB memory')
  })
})
