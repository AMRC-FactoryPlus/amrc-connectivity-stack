/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Reading and writing schemas in the ConfigDB.
 *
 * The ConfigDB is where a deployment's schemas live. The acs-schemas git
 * repo is an AMRC-provided starting library, not an authoring channel;
 * nothing here ever writes to git.
 *
 * Two rules follow, and the first is forced by code that already exists:
 *
 *  - A library schema is never edited in place. acs-git's schema hook
 *    re-writes any schema whose stored `source` matches the repo it
 *    pulled from, so an in-place edit would be reverted on the next
 *    pull. Editing a library schema forks it.
 *
 *  - A local schema follows the change classifier. Additive edits update
 *    in place; breaking edits fork to a new UUID and bump the version.
 *
 * Forks always mint a new UUID. That is what puts a local schema beyond
 * the reach of both schema loaders (the git hook and the install-time
 * acs-schemas image), neither of which knows local schemas exist.
 *
 * Provenance and lineage rules live in lineage.js, which is free of any
 * client dependency; this module is the side-effecting half.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { v4 as uuidv4 } from 'uuid'

import { serialise } from './document.js'
import { LOCAL_SOURCE } from './lineage.js'

export {
  LOCAL_SOURCE,
  derivedFromOf,
  isLibrarySchema,
  newestVersion,
  replacesOf,
  successorIndex,
  unresolvedReferences,
  versionOf,
} from './lineage.js'

/** Class holding drafts. Deliberately not Class.Schema: a draft must be
 * invisible to the schema store, the origin map editor, acs-i3x and the
 * edge agent until it is published. */
export const SCHEMA_DRAFT_CLASS = '962cea2c-1b0c-4397-b01b-03d3eb863fc1'

/** App holding a draft's working state. */
export const SCHEMA_DRAFT_APP = '874ae1f3-7335-4a39-ad9e-d729b27a935b'

const now = () => Math.floor(Date.now() / 1000)

/* --------------------------------------------------------------- drafts */

/**
 * Create a draft.
 *
 * @param {object} client the Factory+ service client
 * @param {object} draft {name, schemaUuid, body, basedOn, derivedFrom, version}
 * @returns {Promise<string>} the draft object UUID
 */
export async function createDraft (client, draft) {
  const cdb = client.ConfigDB
  const uuid = await cdb.create_object(SCHEMA_DRAFT_CLASS, null)

  await cdb.put_config(UUIDs.App.Info, uuid, { name: `${draft.name} (draft)` })
  await cdb.put_config(SCHEMA_DRAFT_APP, uuid, {
    name: draft.name,
    schemaUuid: draft.schemaUuid,
    body: draft.body,
    /* The published schema this draft edits, if any. Null for a new
     * schema or a fork, both of which publish as something new. */
    basedOn: draft.basedOn ?? null,
    /* The schema this was forked from, carried through to publication. */
    derivedFrom: draft.derivedFrom ?? null,
    version: draft.version ?? 1,
  })

  return uuid
}

/** Save working state back to a draft. */
export async function saveDraft (client, uuid, draft) {
  await client.ConfigDB.put_config(SCHEMA_DRAFT_APP, uuid, draft)
  await client.ConfigDB.put_config(UUIDs.App.Info, uuid,
    { name: `${draft.name} (draft)` })
}

export async function deleteDraft (client, uuid) {
  await client.ConfigDB.delete_object(uuid)
}

/* ------------------------------------------------------------ publishing */

/**
 * Publish a draft as a new schema object.
 *
 * Used for a brand new schema, for every fork, and for any edit the
 * classifier found breaking. In all three cases whatever came before is
 * left exactly as it is, so nothing moves under a running device.
 *
 * @returns {Promise<string>} the published schema UUID
 */
export async function publishNew (client, opts) {
  const { name, version, body, replaces, derivedFrom } = opts
  const cdb = client.ConfigDB

  const schemaUuid = body?.properties?.Schema_UUID?.const
  if (!schemaUuid)
    throw new Error('Schema body has no Schema_UUID')

  await cdb.create_object(UUIDs.Class.Schema, schemaUuid)
  await cdb.put_config(UUIDs.App.Info, schemaUuid,
    { name: `${name} (v${version})` })
  await cdb.put_config(UUIDs.App.SchemaInformation, schemaUuid, {
    name,
    version,
    source: LOCAL_SOURCE,
    created: now(),
    modified: now(),
    ...(replaces ? { replaces } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
  })
  await cdb.put_config(UUIDs.App.Schema, schemaUuid, body)

  return schemaUuid
}

/**
 * Update a published schema in place.
 *
 * Only reached when the classifier found every change additive and the
 * schema is locally authored. A library schema never gets here.
 */
export async function publishInPlace (client, opts) {
  const { schemaUuid, name, version, body, existing } = opts
  const cdb = client.ConfigDB

  await cdb.put_config(UUIDs.App.Schema, schemaUuid, body)
  await cdb.put_config(UUIDs.App.SchemaInformation, schemaUuid, {
    ...(existing ?? {}),
    name,
    version,
    source: LOCAL_SOURCE,
    modified: now(),
  })
  await cdb.put_config(UUIDs.App.Info, schemaUuid,
    { name: `${name} (v${version})` })

  return schemaUuid
}

/**
 * Mint the identity for a new schema and stamp it into the body.
 *
 * The serialiser owns $id and Schema_UUID together; the git loader
 * rejects a schema whose $id does not match its Schema_UUID.
 */
export function mintSchemaIdentity (doc, title) {
  const uuid = uuidv4()
  doc.uuid = uuid
  if (title) doc.title = title
  return { uuid, body: serialise(doc) }
}
