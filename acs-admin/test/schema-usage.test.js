/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Blast radius and lineage.
 *
 * The number shown on the publish gate decides whether someone goes
 * ahead with a breaking change, so undercounting is the failure that
 * matters. In particular a schema used as a nested component must be
 * found, because that is the case a top-level lookup misses.
 */

import { describe, it, expect } from 'vitest'

import library from './fixtures/library-schemas.json'
import {
  schemasInOriginMap,
  devicesUsingSchema,
  schemasReferencing,
  devicesPublishingSchema,
  blastRadius,
  buildUsageIndex,
} from '../src/lib/schema/usage.js'
import {
  anyTopLevelMarked,
  isLibrarySchema,
  newestVersion,
  successorIndex,
  topLevelOf,
  unresolvedReferences,
  versionOf,
  LOCAL_SOURCE,
} from '../src/lib/schema/lineage.js'

const CNC_SCHEMA = '4701e66e-0f77-42b0-8ddd-cef60db6ef4a'
const SPINDLE_SCHEMA = '71df1162-40ca-4d19-bacc-95dea227d98b'
const AXIS_SCHEMA = 'e39007e9-1427-4867-9d72-1c00c663db15'

/* An origin map shaped like the ones the edge agent consumes: a top
 * level Schema_UUID, and nested branches each carrying their own. */
const cncOriginMap = {
  Schema_UUID: CNC_SCHEMA,
  Instance_UUID: 'aaaaaaaa-0000-0000-0000-000000000001',
  Spindles: {
    1: {
      Schema_UUID: SPINDLE_SCHEMA,
      Instance_UUID: 'aaaaaaaa-0000-0000-0000-000000000002',
      Act_Load: { Sparkplug_Type: 'DoubleLE', Address: 'ns=2;s=load' },
    },
  },
  Axes: {
    X: {
      Schema_UUID: AXIS_SCHEMA,
      Instance_UUID: 'aaaaaaaa-0000-0000-0000-000000000003',
    },
  },
}

const devices = [
  { uuid: 'dev-1', name: 'CNC 1', deviceInformation: { originMap: cncOriginMap } },
  {
    uuid: 'dev-2',
    name: 'Spindle rig',
    deviceInformation: {
      originMap: {
        Schema_UUID: SPINDLE_SCHEMA,
        Instance_UUID: 'bbbbbbbb-0000-0000-0000-000000000001',
      },
    },
  },
  { uuid: 'dev-3', name: 'Unconfigured', deviceInformation: {} },
  { uuid: 'dev-4', name: 'No info' },
]

describe('schemas in an origin map', () => {
  it('finds the top level schema', () => {
    expect(schemasInOriginMap(cncOriginMap)).toContain(CNC_SCHEMA)
  })

  it('finds schemas nested inside component lists', () => {
    const found = schemasInOriginMap(cncOriginMap)
    expect(found).toContain(SPINDLE_SCHEMA)
    expect(found).toContain(AXIS_SCHEMA)
  })

  it('returns nothing for an empty map', () => {
    expect(schemasInOriginMap({}).size).toEqual(0)
    expect(schemasInOriginMap(null).size).toEqual(0)
  })

  it('deduplicates a schema used more than once', () => {
    const map = {
      Schema_UUID: CNC_SCHEMA,
      A: { Schema_UUID: SPINDLE_SCHEMA },
      B: { Schema_UUID: SPINDLE_SCHEMA },
    }
    expect(schemasInOriginMap(map).size).toEqual(2)
  })

  it('walks arrays as well as objects', () => {
    const map = { items: [{ Schema_UUID: SPINDLE_SCHEMA }] }
    expect(schemasInOriginMap(map)).toContain(SPINDLE_SCHEMA)
  })
})

describe('devices using a schema', () => {
  it('finds a device by its top level schema', () => {
    expect(devicesUsingSchema(devices, CNC_SCHEMA).map(d => d.uuid))
      .toEqual(['dev-1'])
  })

  it('finds devices using a schema as a nested component', () => {
    /* The case a top-level config search misses, and the reason this
     * walks the origin map rather than querying by the schema field. */
    expect(devicesUsingSchema(devices, SPINDLE_SCHEMA).map(d => d.uuid))
      .toEqual(['dev-1', 'dev-2'])
  })

  it('ignores devices with no origin map', () => {
    expect(devicesUsingSchema(devices, 'nothing-uses-this')).toEqual([])
  })

  it('tolerates an empty device list', () => {
    expect(devicesUsingSchema(undefined, CNC_SCHEMA)).toEqual([])
  })
})

describe('schemas referencing a schema', () => {
  const schemas = Object.entries(library).map(([path, schema]) => ({
    uuid: schema.properties?.Schema_UUID?.const ?? path,
    name: path,
    schema,
  }))

  it('finds the CNC schema referencing Spindle', () => {
    const found = schemasReferencing(schemas, SPINDLE_SCHEMA).map(s => s.uuid)
    expect(found).toContain(CNC_SCHEMA)
  })

  it('does not report a schema as referencing itself', () => {
    expect(schemasReferencing(schemas, CNC_SCHEMA).map(s => s.uuid))
      .not.toContain(CNC_SCHEMA)
  })

  it('finds many referrers for a widely used component', () => {
    const metric = 'b16275f1-e443-4c41-a482-fcbdfbd20769'
    expect(schemasReferencing(schemas, metric).length).toBeGreaterThan(50)
  })

  it('skips a schema body it cannot parse rather than throwing', () => {
    const broken = [...schemas, { uuid: 'broken', schema: 'not an object' }]
    expect(() => schemasReferencing(broken, SPINDLE_SCHEMA)).not.toThrow()
  })
})

describe('devices publishing a schema', () => {
  const client = (response) => ({ Directory: { fetch: async () => response } })

  it('returns the device list the Directory reports', async () => {
    const result = await devicesPublishingSchema(
      client([200, ['dev-1', 'dev-2']]), CNC_SCHEMA)
    expect(result).toEqual(['dev-1', 'dev-2'])
  })

  it('returns null when the Directory errors, not an empty list', async () => {
    /* An empty array means nothing is publishing. Null means we do not
     * know. Collapsing the two would show a reassuring zero when the
     * service is simply down. */
    expect(await devicesPublishingSchema(client([503, null]), CNC_SCHEMA))
      .toBeNull()
  })

  it('returns null when the fetch throws', async () => {
    const throwing = {
      Directory: { fetch: async () => { throw new Error('unreachable') } },
    }
    expect(await devicesPublishingSchema(throwing, CNC_SCHEMA)).toBeNull()
  })
})

describe('blast radius', () => {
  it('reports configured devices and an unknown live count together', async () => {
    const client = {
      Directory: { fetch: async () => { throw new Error('down') } },
    }
    const result = await blastRadius({
      client, schemaUuid: SPINDLE_SCHEMA, devices, schemas: [],
    })

    expect(result.configured.map(d => d.uuid)).toEqual(['dev-1', 'dev-2'])
    expect(result.publishing).toBeNull()
    expect(result.publishingCount).toBeNull()
  })

  it('reports a live count when the Directory answers', async () => {
    const client = { Directory: { fetch: async () => [200, ['dev-1']] } }
    const result = await blastRadius({
      client, schemaUuid: SPINDLE_SCHEMA, devices, schemas: [],
    })

    expect(result.publishingCount).toEqual(1)
    expect(result.configured).toHaveLength(2)
  })
})

describe('provenance', () => {
  it('treats a schema loaded from git as library', () => {
    expect(isLibrarySchema({
      schemaInformation: { source: 'https://github.com/AMRC-FactoryPlus/acs-schemas' },
    })).toBe(true)
  })

  it('treats a locally authored schema as local', () => {
    expect(isLibrarySchema({ schemaInformation: { source: LOCAL_SOURCE } }))
      .toBe(false)
  })

  it('treats an unstamped schema as local', () => {
    /* Nothing to overwrite it, so nothing to protect it from. */
    expect(isLibrarySchema({ schemaInformation: {} })).toBe(false)
    expect(isLibrarySchema({})).toBe(false)
  })

  it('defaults an unstamped version to 1', () => {
    expect(versionOf({})).toEqual(1)
    expect(versionOf({ schemaInformation: { version: 3 } })).toEqual(3)
  })
})

describe('lineage', () => {
  const schemas = [
    { uuid: 'v1', schemaInformation: { name: 'CNC Local', version: 1 } },
    { uuid: 'v2', schemaInformation: { name: 'CNC Local', version: 2, replaces: 'v1' } },
    { uuid: 'v3', schemaInformation: { name: 'CNC Local', version: 3, replaces: 'v2' } },
    { uuid: 'other', schemaInformation: { name: 'Unrelated', version: 1 } },
  ]

  it('indexes each schema by what it replaces', () => {
    const index = successorIndex(schemas)
    expect(index.get('v1').uuid).toEqual('v2')
    expect(index.get('v2').uuid).toEqual('v3')
    expect(index.has('v3')).toBe(false)
  })

  it('follows the chain to the newest version', () => {
    expect(newestVersion(schemas, 'v1').uuid).toEqual('v3')
    expect(newestVersion(schemas, 'v2').uuid).toEqual('v3')
  })

  it('returns the schema itself when it is the newest', () => {
    expect(newestVersion(schemas, 'v3').uuid).toEqual('v3')
    expect(newestVersion(schemas, 'other').uuid).toEqual('other')
  })

  it('does not loop forever on a cyclic chain', () => {
    /* A hand-edited SchemaInformation could point two schemas at each
     * other. Terminating matters more than being right here. */
    const cyclic = [
      { uuid: 'a', schemaInformation: { replaces: 'b' } },
      { uuid: 'b', schemaInformation: { replaces: 'a' } },
    ]
    expect(() => newestVersion(cyclic, 'a')).not.toThrow()
  })
})

describe('unresolved references', () => {
  const published = [{ uuid: 'known-1' }, { uuid: 'known-2' }]

  it('reports a reference to a schema that is not published', () => {
    expect(unresolvedReferences(new Set(['known-1', 'draft-1']), published))
      .toEqual(['draft-1'])
  })

  it('reports nothing when every reference resolves', () => {
    expect(unresolvedReferences(new Set(['known-1', 'known-2']), published))
      .toEqual([])
  })

  it('treats an empty published list as resolving nothing', () => {
    expect(unresolvedReferences(new Set(['known-1']), [])).toEqual(['known-1'])
  })
})

describe('usage index', () => {
  const all = Object.entries(library).map(([path, schema]) => ({
    uuid: schema.properties?.Schema_UUID?.const ?? path,
    schema,
  }))

  it('counts references the same as the per-schema lookup', () => {
    const index = buildUsageIndex(all, [])
    for (const entry of all.slice(0, 25)) {
      expect(index.referencedBy.get(entry.uuid) ?? 0)
        .toEqual(schemasReferencing(all, entry.uuid).length)
    }
  })

  it('counts devices the same as the per-schema lookup', () => {
    const index = buildUsageIndex(all, devices)
    for (const uuid of [CNC_SCHEMA, SPINDLE_SCHEMA, AXIS_SCHEMA]) {
      expect(index.devices.get(uuid) ?? 0)
        .toEqual(devicesUsingSchema(devices, uuid).length)
    }
  })

  it('does not count a schema as referencing itself', () => {
    const selfref = [{
      uuid: 'aaaaaaaa-0000-0000-0000-000000000001',
      schema: {
        properties: {
          Schema_UUID: { const: 'aaaaaaaa-0000-0000-0000-000000000001' },
          Loop: { $ref: 'urn:uuid:aaaaaaaa-0000-0000-0000-000000000001' },
        },
      },
    }]
    expect(buildUsageIndex(selfref, []).referencedBy.size).toEqual(0)
  })

  it('builds the whole index in one pass over the library', () => {
    /* Doing this per row was quadratic and cost about a second of
     * blocked main thread on a real deployment. The bound is generous;
     * it exists to catch a return to per-row work, not to benchmark. */
    const started = performance.now()
    buildUsageIndex(all, devices)
    expect(performance.now() - started).toBeLessThan(150)
  })
})

describe('top-level marking', () => {
  const marked = (value) => ({
    uuid: 'x', schema: value === undefined ? {} : { topLevel: value },
  })

  it('reads the flag off a schema record', () => {
    expect(topLevelOf(marked(true))).toBe(true)
    expect(topLevelOf(marked(false))).toBe(false)
  })

  /* Undefined means the schema predates the flag, which the picker
   * treats differently from a schema declaring itself a component. */
  it('is undefined when the schema says nothing', () => {
    expect(topLevelOf(marked(undefined))).toBeUndefined()
    expect(topLevelOf({ uuid: 'x' })).toBeUndefined()
  })

  it('reports when nothing in a deployment is marked', () => {
    expect(anyTopLevelMarked([marked(undefined), marked(undefined)])).toBe(false)
    expect(anyTopLevelMarked([])).toBe(false)
  })

  it('reports when something is marked, either way', () => {
    expect(anyTopLevelMarked([marked(undefined), marked(true)])).toBe(true)
    expect(anyTopLevelMarked([marked(false)])).toBe(true)
  })

  it('sees nothing marked in the current library', () => {
    /* The whole reason the filter stays inert on upgrade. */
    const all = Object.values(library).map(schema => ({ uuid: '', schema }))
    expect(anyTopLevelMarked(all)).toBe(false)
  })
})
