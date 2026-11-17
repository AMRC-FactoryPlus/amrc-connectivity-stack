/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Saving a connection in the admin UI after service-setup has moved it
 * between an internal driver and its split driver must give the same
 * Edge Agent config entry as the move, so the two never fight. The move
 * is acs-service-setup/lib/split-drivers.js, built on the helpers
 * tested here.
 */

import { describe, it, expect } from 'vitest'

import {
  move_connection, move_entry, move_payload_format, set_driver_ids,
} from '@amrc-factoryplus/service-client'

import {
  applyConnection, deploymentDrivers, devicePayloadFormat,
} from '../src/utils/edgeAgentConfigUpdater.js'

/* The DriverDefs, as acs-service-setup/dumps/edge.yaml has them. The
 * payload format maps are SplitDrivers in split-drivers.js. */
const PROTOCOLS = [
  {
    name: 'OPC UA',
    internal: { uuid: 'opcua', def: { internal: { connType: 'OPC UA', details: 'OPCUAConnDetails' } } },
    split: { uuid: 'opcua-split', def: { image: { repository: 'edge-opcua' } } },
    payloadFormat: { 'Defined by Protocol': 'JSON' },
    format: 'Defined by Protocol',
    config: { endpoint: 'opc.tcp://server:4840', securityMode: 'None', securityPolicy: 'None', useCredentials: false },
    pollInt: 1000,
  },
  {
    name: 'MQTT',
    internal: { uuid: 'mqtt', def: { internal: { connType: 'MQTT', details: 'MQTTConnDetails' } } },
    split: { uuid: 'mqtt-split', def: { image: { repository: 'edge-mqtt' } } },
    payloadFormat: {},
    format: 'JSON',
    config: { host: 'broker', port: 1883, protocol: 'mqtt', cleanSession: true, keepAlive: 60 },
  },
  {
    name: 'REST',
    internal: { uuid: 'rest', def: { internal: { connType: 'REST', details: 'RESTConnDetails' } } },
    split: { uuid: 'rest-split', def: { image: { repository: 'edge-rest' } } },
    payloadFormat: {},
    format: 'XML',
    config: { baseURL: 'http://printer/api', authMethod: 'None' },
    pollInt: 500,
  },
]

const DEVICES = ['a', 'b']

/* A connection store entry: the configuration with its driver bound to
 * the DriverDef, as useConnectionStore gives it. */
const storeEntry = (cconf, driver) => ({
  uuid: 'conn-uuid',
  name: 'Conn',
  configuration: { ...cconf, driver: driver.def, driver_uuid: driver.uuid },
})

/* The entry the admin UI builds from scratch, with each device's
 * payload format as buildEdgeAgentConfig sets it. */
function adminEntry (existing, cconf, driver) {
  const entry = applyConnection(existing ? structuredClone(existing) : null,
    storeEntry(cconf, driver))
  if (!existing)
    entry.devices = DEVICES.map(deviceId => ({ deviceId }))
  for (const d of entry.devices)
    d.payloadFormat = devicePayloadFormat(cconf)
  return entry
}

describe.each(PROTOCOLS)('saving a moved $name connection', p => {
  const proto = { internal: p.internal.uuid, split: p.split.uuid, payloadFormat: p.payloadFormat }
  const cconf = {
    driver: p.internal.uuid,
    config: p.config,
    source: { payloadFormat: p.format },
    ...(p.pollInt ? { pollInt: p.pollInt } : {}),
  }
  /* The entry as it stands once the connection has been saved at
   * least once. A new non-polled connection is created with pollInt
   * 1000 and saved with none; that difference is older than the move
   * and the agent does not read it. */
  const before = adminEntry(adminEntry(null, cconf, p.internal), cconf, p.internal)

  const moved = move_connection(cconf, proto, true)
  const movedEntry = move_entry(before, p.split.def,
    f => move_payload_format(f, p.payloadFormat, true))

  it('is a Driver connection with the same details', () => {
    expect(movedEntry.connType).toBe('Driver')
    expect(movedEntry.DriverDetails).toEqual(p.config)
    expect(movedEntry[p.internal.def.internal.details]).toBeUndefined()
  })

  it('changes nothing when saved after the move', () => {
    expect(adminEntry(movedEntry, moved, p.split)).toEqual(movedEntry)
  })

  it('gives the same entry when built from scratch after the move', () => {
    expect({ ...adminEntry(null, moved, p.split), pollInt: movedEntry.pollInt })
      .toEqual(movedEntry)
  })

  it('changes nothing when saved after moving back', () => {
    const back = move_connection(moved, proto, false)
    const backEntry = move_entry(movedEntry, p.internal.def,
      f => move_payload_format(f, p.payloadFormat, false, moved.splitMigration.payloadFormat))

    expect(back).toEqual(cconf)
    expect(backEntry).toEqual(before)
    expect(adminEntry(backEntry, back, p.internal)).toEqual(backEntry)
    expect({ ...adminEntry(null, back, p.internal), pollInt: backEntry.pollInt })
      .toEqual(backEntry)
  })
})

describe('applyConnection', () => {
  it('drops details held under another driver\'s key', () => {
    const p = PROTOCOLS[0]
    const stale = {
      uuid: 'conn-uuid', name: 'Conn', connType: 'OPC UA', pollInt: 1000,
      OPCUAConnDetails: p.config, DriverDetails: { old: true }, devices: [],
    }
    const entry = applyConnection(stale, storeEntry({ config: p.config, pollInt: 1000 }, p.split))
    expect(entry).toEqual({
      uuid: 'conn-uuid', name: 'Conn', connType: 'Driver', pollInt: 1000,
      payloadFormat: undefined, DriverDetails: p.config, devices: [],
    })
  })

  it('builds an internal connection entry as before', () => {
    const p = PROTOCOLS[2]
    const entry = applyConnection(null, storeEntry({
      config: p.config, pollInt: 500, source: { payloadFormat: 'XML' },
    }, p.internal))
    expect(entry).toEqual({
      uuid: 'conn-uuid', name: 'Conn', connType: 'REST', pollInt: 500,
      RESTConnDetails: p.config, payloadFormat: 'XML', devices: [],
    })
  })

  it('gives devices the default format when the connection has none', () => {
    expect(devicePayloadFormat({})).toBe('Defined by Protocol')
    expect(devicePayloadFormat({ source: { payloadFormat: 'JSON' } })).toBe('JSON')
  })
})

describe('deploymentDrivers', () => {
  const split = PROTOCOLS[2].split
  const internal = PROTOCOLS[2].internal
  const conn = (uuid, name, driver) => ({
    uuid, name, configuration: { config: {}, driver: driver.def },
  })
  const connections = [
    conn('1a2b3c4d-0000-4000-8000-000000000001', 'web.example.org', split),
    conn('2a2b3c4d-0000-4000-8000-000000000002', 'plc-1', split),
    conn('3a2b3c4d-0000-4000-8000-000000000003', 'api.example.org', internal),
  ]
  /* The entries as updateEdgeAgentConfig saves them. */
  const entries = () => set_driver_ids(connections.map(c => ({
    ...applyConnection(null, c), devices: [{ deviceId: 'd' }],
  })))

  it('keys each split driver by its driver id', () => {
    expect(deploymentDrivers(entries(), connections)).toEqual({
      'web-example-org-1a2b3c4d': { image: split.def.image },
      'plc-1': { image: split.def.image },
    })
  })

  it('gives the config the same ids, and none to built-in connections', () => {
    expect(entries().map(e => e.driverId))
      .toEqual(['web-example-org-1a2b3c4d', undefined, undefined])
  })

  it('keeps the name a connection is shown with', () => {
    expect(entries().map(e => e.name))
      .toEqual(['web.example.org', 'plc-1', 'api.example.org'])
  })
})
