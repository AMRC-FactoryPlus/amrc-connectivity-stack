/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Blast radius: who is affected if this schema changes.
 *
 * Two different questions, deliberately kept apart because they have
 * different answers and conflating them would overstate confidence:
 *
 *   configured - devices whose DeviceInformation origin map names this
 *                schema, at any depth. Complete, because the admin UI
 *                already holds every device's origin map in memory.
 *
 *   publishing - devices the Directory has seen publish this schema on
 *                their most recent session. Live reality, and a subset:
 *                a configured device that is offline does not appear.
 *
 * A device can be configured but not publishing (never brought up, or
 * currently down), so `configured` is the number that matters when
 * deciding whether an edit is safe.
 */

import { parse, referencedSchemas } from './document.js'

/**
 * Walk an origin map collecting every Schema_UUID it names.
 *
 * Origin maps nest: a CNC's map holds a Spindles branch whose members
 * each carry their own Schema_UUID. This mirrors the Directory's
 * find_schemas, which does the same walk over Sparkplug births.
 */
export function schemasInOriginMap (originMap) {
  const found = new Set()

  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    /* A leaf metric stores its value under Schema_UUID as a string; a
     * branch stores the same key. Either way we want the string. */
    if (typeof node.Schema_UUID === 'string') found.add(node.Schema_UUID)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'Schema_UUID') continue
      walk(value)
    }
  }

  walk(originMap)
  return found
}

/**
 * Devices configured against a schema.
 *
 * @param {Array} devices the device store's data
 * @param {string} schemaUuid
 * @returns {Array} the matching device records
 */
export function devicesUsingSchema (devices, schemaUuid) {
  return (devices ?? []).filter((device) => {
    const map = device.deviceInformation?.originMap
    if (!map) return false
    return schemasInOriginMap(map).has(schemaUuid)
  })
}

const REF_RX = /^urn:uuid:([-0-9a-f]{36})$/i

/**
 * Every schema UUID a raw schema body references, at any depth.
 *
 * This walks the JSON directly rather than building a document model.
 * Counting references does not need the typed tree, and parsing deep
 * clones every node, so going through the model made this quadratic.
 */
export function refsInBody (body) {
  const found = new Set()
  const walk = (value) => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value.$ref === 'string') {
      const m = value.$ref.match(REF_RX)
      if (m) found.add(m[1].toLowerCase())
    }
    for (const inner of Object.values(value)) walk(inner)
  }
  walk(body)
  return found
}

/**
 * Count, in one pass, how many schemas reference each schema and how
 * many devices use it.
 *
 * The list shows both figures for every row. Computing them per row
 * meant re-reading every schema and every device once per row, which is
 * quadratic: 139 schemas took about a second of blocked main thread
 * before this existed. Build the index once and look rows up in it.
 *
 * @param {Array} schemas the schema store's data
 * @param {Array} devices the device store's data
 * @returns {{referencedBy: Map<string, number>, devices: Map<string, number>}}
 */
export function buildUsageIndex (schemas, devices) {
  const referencedBy = new Map()
  const deviceCounts = new Map()

  const bump = (map, uuid) => map.set(uuid, (map.get(uuid) ?? 0) + 1)

  for (const entry of schemas ?? []) {
    if (!entry.schema) continue
    let refs
    try {
      refs = refsInBody(entry.schema)
    } catch {
      /* A body we cannot read references nothing we can count. It is
       * still listed, so it is not hidden. */
      continue
    }
    for (const ref of refs) {
      /* A schema referencing itself would inflate its own count. */
      if (ref !== entry.uuid) bump(referencedBy, ref)
    }
  }

  for (const device of devices ?? []) {
    const map = device.deviceInformation?.originMap
    if (!map) continue
    for (const uuid of schemasInOriginMap(map)) bump(deviceCounts, uuid)
  }

  return { referencedBy, devices: deviceCounts }
}

/**
 * Schemas that reference a schema as a component, at any depth.
 *
 * Forking or changing a widely-referenced schema (Common/Metric, say)
 * reaches much further than its own device count suggests.
 *
 * For a whole list of rows use buildUsageIndex instead; this walks every
 * schema and is meant for a single lookup.
 *
 * @param {Array} schemas the schema store's data
 * @param {string} schemaUuid
 * @returns {Array} the referencing schema records
 */
export function schemasReferencing (schemas, schemaUuid) {
  return (schemas ?? []).filter((entry) => {
    if (!entry.schema || entry.uuid === schemaUuid) return false
    try {
      return refsInBody(entry.schema).has(schemaUuid)
    } catch {
      return false
    }
  })
}

/**
 * Devices the Directory has seen publish this schema.
 *
 * Returns null when the Directory cannot be reached, so the caller can
 * distinguish "none" from "unknown" rather than reporting a reassuring
 * zero.
 *
 * @param {object} client the Factory+ service client
 * @param {string} schemaUuid
 * @returns {Promise<Array<string>|null>} device UUIDs, or null
 */
export async function devicesPublishingSchema (client, schemaUuid) {
  try {
    const [st, body] = await client.Directory.fetch(
      `/v1/schema/${schemaUuid}/devices`)
    if (st !== 200 || !Array.isArray(body)) return null
    return body
  } catch (e) {
    console.debug('Directory schema usage lookup failed', e)
    return null
  }
}

/**
 * Everything the publish gate needs to describe the reach of a change.
 *
 * @returns {Promise<object>} configured devices, referencing schemas and
 *   the live publishing count (null when the Directory is unreachable)
 */
export async function blastRadius (opts) {
  const { client, schemaUuid, devices, schemas } = opts

  const configured = devicesUsingSchema(devices, schemaUuid)
  const referencedBy = schemasReferencing(schemas, schemaUuid)
  const publishing = client
    ? await devicesPublishingSchema(client, schemaUuid)
    : null

  return {
    configured,
    referencedBy,
    publishing,
    /* Devices seen publishing that we also hold config for, so the two
     * numbers can be shown without implying they are disjoint. */
    publishingCount: publishing === null ? null : publishing.length,
  }
}
