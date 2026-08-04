/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Fixture data for the design preview. Real schemas from the AMRC
 * library, plus a local fork and a superseded pair, so every state the
 * UI can be in is reachable without a deployment. */

import library from '../test/fixtures/library-schemas.json'

const uuidOf = body => body.properties?.Schema_UUID?.const

const markedBody = (path) => {
  const body = library[path]
  if (TOP_LEVEL.has(path)) return { ...body, topLevel: true }
  if (COMPONENT.has(path)) return { ...body, topLevel: false }
  return body
}

const libraryEntry = (path, name) => ({
  uuid: uuidOf(library[path]),
  name,
  schema: markedBody(path),
  schemaInformation: {
    name,
    version: 1,
    source: 'https://github.com/AMRC-FactoryPlus/acs-schemas',
    created: 1700000000,
    modified: 1700000000,
  },
})

/* A few marked either way, so the preview can show the picker's
 * top-level filter. The real marks land in the acs-schemas repo. */
const TOP_LEVEL = new Set([
  'CNC/CNC-v1.yaml', 'Robot/Robot-v1.yaml', 'Press/Press-v1.yaml',
])
const COMPONENT = new Set([
  'CNC/Spindle-v1.yaml', 'CNC/Axis-v1.yaml', 'CNC/Channel-v1.yaml',
  'Common/Metric-v1.yaml', 'Common/Device_Information-v1.yaml',
])

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

/* Every schema a seed references, transitively. Hand-listing them meant
 * a schema referenced by CNC but absent from the fixtures showed up as
 * an unpublished component, which is a real state and so looked like
 * working behaviour rather than a gap in the fixtures. */
function withReferences (seeds) {
  const byUuid = new Map()
  for (const [path, body] of Object.entries(library)) {
    const uuid = uuidOf(body)
    if (uuid) byUuid.set(uuid, { path, body })
  }

  const collect = (body, into) => {
    const walk = (value) => {
      if (value === null || typeof value !== 'object') return
      if (Array.isArray(value)) return value.forEach(walk)
      if (typeof value.$ref === 'string') {
        const m = value.$ref.match(/^urn:uuid:([-0-9a-f]{36})$/i)
        if (m) into.add(m[1].toLowerCase())
      }
      for (const inner of Object.values(value)) walk(inner)
    }
    walk(body)
  }

  const out = new Map(seeds.map(s => [s.uuid, s]))
  const queue = seeds.map(s => s.schema)

  while (queue.length) {
    const refs = new Set()
    collect(queue.pop(), refs)
    for (const uuid of refs) {
      if (out.has(uuid)) continue
      const found = byUuid.get(uuid)
      if (!found) continue
      const name = found.path.replace(/^.*\//, '').replace(/-v\d+\.yaml$/, '')
        .replace(/_/g, ' ')
      const entry = libraryEntry(found.path, name)
      out.set(uuid, entry)
      queue.push(entry.schema)
    }
  }

  return [...out.values()]
}

export const schemas = withReferences([
  CNC, SPINDLE, AXIS, CHANNEL, DEVINFO, METRIC, ROBOT, PRESS,
  LOCAL_V1, LOCAL_V2,
])

/* A draft of the local CNC schema with a metric renamed and two added,
 * so the publish page shows a real classification rather than a
 * hand-written one. */
function editedLocalBody (edit) {
  const body = JSON.parse(JSON.stringify(LOCAL_V1.schema))
  edit(body.properties)
  return body
}

const metricProperty = (types, docs, unit) => ({
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
  {
    uuid: 'dddddddd-0000-4000-8000-000000000002',
    name: 'CNC Sheffield (draft)',
    draft: {
      name: 'CNC Sheffield',
      schemaUuid: LOCAL_V1_UUID,
      version: 1,
      basedOn: LOCAL_V1_UUID,
      derivedFrom: CNC.uuid,
      body: editedLocalBody((props) => {
        /* Breaking: a rename and a removal. */
        props.Spindle_Units = props.Spindles
        delete props.Spindles
        delete props.Channels
        /* Additive: new metrics and a new group. */
        props.Coolant_Temp = metricProperty(['DoubleLE'],
          'Coolant temperature at the outflow manifold.', '°C')
        props.Coolant_Flow = metricProperty(['DoubleLE'],
          'Coolant flow rate.', 'L/min')
        props.Tool_Number = metricProperty(['UInt32LE'],
          'Active tool number in the carousel.')
        props.Alarm_State = metricProperty(['String'], 'Current alarm state.')
        props.Spindle_Hours = metricProperty(['DoubleLE'],
          'Cumulative spindle running hours.', 'h')
      }),
    },
  },
  {
    uuid: 'dddddddd-0000-4000-8000-000000000003',
    name: 'Press Brake (draft)',
    draft: {
      name: 'Press Brake',
      schemaUuid: LOCAL_V1_UUID,
      version: 1,
      basedOn: LOCAL_V1_UUID,
      derivedFrom: CNC.uuid,
      body: editedLocalBody((props) => {
        /* Nothing removed or renamed, so this updates in place. */
        props.Coolant_Flow = metricProperty(['DoubleLE'],
          'Coolant flow rate.', 'L/min')
        props.Tool_Number = metricProperty(['UInt32LE'],
          'Active tool number in the carousel.')
        props.Coolant_Pressure = metricProperty(['FloatLE'],
          'Coolant line pressure.', 'bar')
      }),
    },
  },
  {
    uuid: 'dddddddd-0000-4000-8000-000000000004',
    name: 'Press Line (draft)',
    draft: {
      name: 'Press Line',
      schemaUuid: 'aaaa0000-0000-4000-8000-00000000000a',
      version: 1,
      basedOn: null,
      derivedFrom: null,
      /* References the Laser Cutter draft, which is not published, so
       * this one is blocked. */
      body: {
        $id: 'urn:uuid:aaaa0000-0000-4000-8000-00000000000a',
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'Press Line',
        type: 'object',
        properties: {
          Schema_UUID: { const: 'aaaa0000-0000-4000-8000-00000000000a' },
          Instance_UUID: {
            description: 'The unique identifier for this object. (A UUID specified by RFC4122).',
            type: 'string',
            format: 'uuid',
          },
          Cutter: { $ref: 'urn:uuid:aaaa0000-0000-4000-8000-000000000009' },
          Line_Speed: metricProperty(['DoubleLE'], 'Line throughput.', 'm/min'),
        },
        required: ['Schema_UUID', 'Instance_UUID'],
      },
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
