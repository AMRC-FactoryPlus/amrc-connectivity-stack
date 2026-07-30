/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Fixture data for the design preview. Real schemas from the AMRC
 * library, plus a local fork and a superseded pair, so every state the
 * UI can be in is reachable without a deployment. */

import library from '../test/fixtures/library-schemas.json'

const uuidOf = body => body.properties?.Schema_UUID?.const

const libraryEntry = (path, name) => ({
  uuid: uuidOf(library[path]),
  name,
  schema: library[path],
  schemaInformation: {
    name,
    version: 1,
    source: 'https://github.com/AMRC-FactoryPlus/acs-schemas',
    created: 1700000000,
    modified: 1700000000,
  },
})

const CNC = libraryEntry('CNC/CNC-v1.yaml', 'CNC Machine')
const SPINDLE = libraryEntry('CNC/Spindle-v1.yaml', 'CNC Spindle')
const AXIS = libraryEntry('CNC/Axis-v1.yaml', 'CNC Axis')
const CHANNEL = libraryEntry('CNC/Channel-v1.yaml', 'CNC Channel')
const DEVINFO = libraryEntry('Common/Device_Information-v1.yaml', 'Device Information')
const METRIC = libraryEntry('Common/Metric-v1.yaml', 'Metric')
const ROBOT = libraryEntry('Robot/Robot-v1.yaml', 'Robot')
const PRESS = libraryEntry('Press/Press-v1.yaml', 'Press')

/* A local fork of the CNC schema, at v2, having superseded its own v1. */
const LOCAL_V1_UUID = 'c0ffee00-0000-4000-8000-000000000001'
const LOCAL_V2_UUID = 'c0ffee00-0000-4000-8000-000000000002'

const localBody = (uuid) => {
  const body = JSON.parse(JSON.stringify(library['CNC/CNC-v1.yaml']))
  body.$id = `urn:uuid:${uuid}`
  body.properties.Schema_UUID.const = uuid
  body.title = 'CNC Sheffield'
  return body
}

const LOCAL_V1 = {
  uuid: LOCAL_V1_UUID,
  name: 'CNC Sheffield (v1)',
  schema: localBody(LOCAL_V1_UUID),
  schemaInformation: {
    name: 'CNC Sheffield',
    version: 1,
    source: 'acs-admin',
    created: 1750000000,
    modified: 1750000000,
    derivedFrom: CNC.uuid,
  },
}

const LOCAL_V2 = {
  uuid: LOCAL_V2_UUID,
  name: 'CNC Sheffield (v2)',
  schema: localBody(LOCAL_V2_UUID),
  schemaInformation: {
    name: 'CNC Sheffield',
    version: 2,
    source: 'acs-admin',
    created: 1755000000,
    modified: 1755000000,
    derivedFrom: CNC.uuid,
    replaces: LOCAL_V1_UUID,
  },
}

export const schemas = [
  CNC, SPINDLE, AXIS, CHANNEL, DEVINFO, METRIC, ROBOT, PRESS,
  LOCAL_V1, LOCAL_V2,
]

export const drafts = [
  {
    uuid: 'dddddddd-0000-4000-8000-000000000001',
    name: 'Laser Cutter (draft)',
    draft: {
      name: 'Laser Cutter',
      schemaUuid: 'aaaa0000-0000-4000-8000-000000000009',
      version: 1,
      basedOn: null,
      derivedFrom: null,
      body: laserCutterBody(),
    },
  },
]

/* A schema mid-authoring: metrics, a group, a component, a component
 * list, and one construct the composer does not model so the opaque
 * state is visible. */
function laserCutterBody () {
  const uuid = 'aaaa0000-0000-4000-8000-000000000009'
  const metric = (types, docs, unit) => ({
    allOf: [
      { $ref: 'urn:uuid:b16275f1-e443-4c41-a482-fcbdfbd20769' },
      {
        properties: {
          Sparkplug_Type: { enum: types },
          Documentation: { default: docs },
          ...(unit ? { Eng_Unit: { default: unit } } : {}),
        },
      },
    ],
  })

  return {
    $id: `urn:uuid:${uuid}`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Laser Cutter',
    type: 'object',
    properties: {
      Schema_UUID: { const: uuid },
      Instance_UUID: {
        description: 'The unique identifier for this object. (A UUID specified by RFC4122).',
        type: 'string',
        format: 'uuid',
      },
      Device_Information: { $ref: `urn:uuid:${DEVINFO.uuid}` },
      Cut_Speed: metric(['DoubleLE'], 'Head travel speed while cutting.', 'mm/s'),
      Beam_Power: metric(['DoubleLE'], 'Output power at the head.', 'W'),
      Assist_Gas_Pressure: metric(['FloatLE'], 'Assist gas line pressure.', 'bar'),
      Optics: {
        type: 'object',
        properties: {
          Lens_Temperature: metric(['DoubleLE'], 'Focusing lens temperature.', '°C'),
          Lens_Hours: metric(['UInt32LE'], 'Hours since the lens was last replaced.', 'h'),
          Nozzle_Standoff: metric(['FloatLE'], 'Distance from nozzle to workpiece.', 'mm'),
        },
      },
      Axes: {
        type: 'object',
        patternProperties: {
          '^[a-zA-Z0-9_]*$': { $ref: `urn:uuid:${AXIS.uuid}` },
        },
      },
      Interlock_State: {
        /* Not a shape the composer models. Held verbatim. */
        oneOf: [
          { type: 'string', enum: ['Closed', 'Open', 'Fault'] },
          { type: 'null' },
        ],
        deprecated: true,
      },
    },
    required: ['Schema_UUID', 'Instance_UUID'],
  }
}

/* Devices, so the blast radius figures are real rather than zero. */
const cncOriginMap = (schemaUuid, instance) => ({
  Schema_UUID: schemaUuid,
  Instance_UUID: instance,
  Device_Information: { Schema_UUID: DEVINFO.uuid },
  Spindles: {
    1: { Schema_UUID: SPINDLE.uuid, Instance_UUID: `${instance}-s1` },
    2: { Schema_UUID: SPINDLE.uuid, Instance_UUID: `${instance}-s2` },
  },
  Axes: {
    X: { Schema_UUID: AXIS.uuid, Instance_UUID: `${instance}-x` },
    Y: { Schema_UUID: AXIS.uuid, Instance_UUID: `${instance}-y` },
  },
})

export const devices = [
  {
    uuid: 'de910000-0000-4000-8000-000000000001',
    name: 'DMG Mori NLX 2500',
    deviceInformation: {
      schema: LOCAL_V1_UUID,
      originMap: cncOriginMap(LOCAL_V1_UUID, 'inst-1'),
    },
  },
  {
    uuid: 'de910000-0000-4000-8000-000000000002',
    name: 'Mazak Integrex',
    deviceInformation: {
      schema: LOCAL_V1_UUID,
      originMap: cncOriginMap(LOCAL_V1_UUID, 'inst-2'),
    },
  },
  {
    uuid: 'de910000-0000-4000-8000-000000000003',
    name: 'Hurco VMX42',
    deviceInformation: {
      schema: LOCAL_V1_UUID,
      originMap: cncOriginMap(LOCAL_V1_UUID, 'inst-3'),
    },
  },
  {
    uuid: 'de910000-0000-4000-8000-000000000004',
    name: 'Haas VF-2',
    deviceInformation: {
      schema: CNC.uuid,
      originMap: cncOriginMap(CNC.uuid, 'inst-4'),
    },
  },
]

export const uuids = {
  CNC: CNC.uuid,
  SPINDLE: SPINDLE.uuid,
  AXIS: AXIS.uuid,
  DEVINFO: DEVINFO.uuid,
  LOCAL_V1: LOCAL_V1_UUID,
  LOCAL_V2: LOCAL_V2_UUID,
  DRAFT: 'dddddddd-0000-4000-8000-000000000001',
}
