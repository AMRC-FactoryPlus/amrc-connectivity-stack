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

/**
 * Schemas that reference a schema as a component, at any depth.
 *
 * Forking or changing a widely-referenced schema (Common/Metric, say)
 * reaches much further than its own device count suggests.
 *
 * @param {Array} schemas the schema store's data
 * @param {string} schemaUuid
 * @returns {Array} the referencing schema records
 */
export function schemasReferencing (schemas, schemaUuid) {
  return (schemas ?? []).filter((entry) => {
    if (!entry.schema || entry.uuid === schemaUuid) return false
    try {
      return referencedSchemas(parse(entry.schema)).has(schemaUuid)
    } catch {
      /* A schema body we cannot parse cannot be shown to reference
       * anything. It is still listed elsewhere, so it is not hidden. */
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
