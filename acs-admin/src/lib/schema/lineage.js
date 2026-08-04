/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Provenance and version lineage.
 *
 * Pure functions over schema store records. Deliberately free of any
 * dependency on the service client so the rules can be reasoned about
 * and tested without a browser or a live deployment.
 *
 * A schema store record looks like:
 *   { uuid, name, schema, schemaInformation: { name, version, source,
 *     replaces, derivedFrom } }
 */

/** The provenance marker this editor writes into SchemaInformation. */
export const LOCAL_SOURCE = 'acs-admin'

/** Key marking a schema as one a device can be built on directly. */
const TOP_LEVEL_KEY = 'topLevel'

/**
 * Is this a schema a device can be built on, rather than a component
 * used inside another schema?
 *
 * Undefined rather than false when the schema says nothing, so callers
 * can tell "not a device schema" from "this library predates the flag".
 */
export function topLevelOf (entry) {
  const body = entry?.schema
  if (!body || !(TOP_LEVEL_KEY in body)) return undefined
  return body[TOP_LEVEL_KEY] === true
}

/**
 * Does any schema here carry the flag?
 *
 * Until the library ships marked schemas nothing does, and filtering by
 * it would empty the list. In that case the filter stays inert.
 */
export function anyTopLevelMarked (schemas) {
  return (schemas ?? []).some(e => topLevelOf(e) !== undefined)
}

/**
 * Is this schema part of the AMRC library rather than locally authored?
 *
 * acs-git's schema hook stamps `source` with the repo it pulled from,
 * and re-writes any schema whose stored source matches that repo. So a
 * schema carrying a source that is not ours will be overwritten on the
 * next pull, and editing it in place would be silently undone.
 *
 * A schema with no source at all is treated as local: there is no
 * loader claiming it, so there is nothing to protect it from.
 */
export function isLibrarySchema (entry) {
  const source = entry?.schemaInformation?.source
  return !!source && source !== LOCAL_SOURCE
}

/** Display version for a schema, defaulting to 1 when unstamped. */
export function versionOf (entry) {
  const version = entry?.schemaInformation?.version
  return Number.isFinite(version) ? version : 1
}

/** The schema this one superseded, if any. */
export function replacesOf (entry) {
  return entry?.schemaInformation?.replaces ?? null
}

/** The schema this one was forked from, if any. */
export function derivedFromOf (entry) {
  return entry?.schemaInformation?.derivedFrom ?? null
}

/**
 * Index schemas by what they replace, so the list can mark a schema
 * superseded and a device can be flagged as being behind.
 *
 * @param {Array} schemas the schema store's data
 * @returns {Map<string, object>} replaced UUID to the schema replacing it
 */
export function successorIndex (schemas) {
  const index = new Map()
  for (const entry of schemas ?? []) {
    const replaced = replacesOf(entry)
    if (replaced) index.set(replaced, entry)
  }
  return index
}

/**
 * Follow the successor chain to the newest version of a schema.
 *
 * Guarded against cycles. SchemaInformation is a plain config entry that
 * an administrator can edit by hand, so two schemas pointing at each
 * other is reachable; terminating matters more than being right.
 */
export function newestVersion (schemas, schemaUuid) {
  const index = successorIndex(schemas)
  const seen = new Set([schemaUuid])
  let current = schemas?.find(s => s.uuid === schemaUuid) ?? null
  let next = index.get(schemaUuid)

  while (next && !seen.has(next.uuid)) {
    seen.add(next.uuid)
    current = next
    next = index.get(next.uuid)
  }

  return current
}

/**
 * Which of these referenced schemas are not published?
 *
 * Publishing a schema that references a draft would emit a reference no
 * consumer can resolve. The origin map editor's resolver reads
 * `found.schema` with no guard, so an unresolvable reference throws and
 * takes the editor down. The publish gate blocks on this.
 *
 * @param {Set<string>} referenced schema UUIDs the document refers to
 * @param {Array} schemas the published schema store
 * @returns {Array<string>} referenced UUIDs that are not published
 */
export function unresolvedReferences (referenced, schemas) {
  const published = new Set((schemas ?? []).map(s => s.uuid))
  return [...referenced].filter(ref => !published.has(ref))
}
