/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The schema document model.
 *
 * parse() turns a Factory+ JSON Schema body into a tree of typed nodes
 * the composer can edit. serialise() turns it back.
 *
 * The model is lossless by construction. Every leaf node keeps the
 * original JSON it was parsed from, and serialising a leaf emits that
 * JSON with only the recognised fields patched. Containers rebuild their
 * `properties` from their children in order, which reproduces the
 * original exactly when nothing beneath them changed.
 *
 * The consequence, and the reason it is built this way: a schema the
 * composer does not fully understand can still be opened, navigated and
 * saved without damage. There is no shape that fails to load.
 */

import {
  DEFAULT_LIST_PATTERN,
  DEFAULT_METRIC_SCHEMA,
  METRIC_FIELDS,
  METRIC_FIELDS_BY_NAME,
  METRIC_SCHEMAS,
  NodeKind,
  RESERVED_PROPERTIES,
  SCHEMA_DIALECT,
  refToUuid,
  uuidToRef,
} from './constants.js'

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

const isPlainObject = v =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

let nodeCounter = 0
/* Stable identity for tree rendering and selection. Never serialised. */
const nextId = () => `n${++nodeCounter}`

/* ---------------------------------------------------------------- parse */

/**
 * Is this property a Sparkplug metric?
 *
 * A metric is an `allOf` containing a $ref to a known metric schema. The
 * constraint block is the first object member carrying `properties`.
 */
function readMetric (value) {
  if (!isPlainObject(value) || !Array.isArray(value.allOf)) return null

  let refIndex = -1
  let constraintIndex = -1

  value.allOf.forEach((entry, i) => {
    if (!isPlainObject(entry)) return
    const uuid = refToUuid(entry.$ref)
    if (uuid && METRIC_SCHEMAS.has(uuid) && refIndex < 0) refIndex = i
    else if (isPlainObject(entry.properties) && constraintIndex < 0) constraintIndex = i
  })

  if (refIndex < 0) return null
  return { refIndex, constraintIndex }
}

/** Read the composer-visible fields out of a metric constraint block. */
function readMetricFields (value, constraintIndex) {
  const fields = {}
  if (constraintIndex < 0) return fields

  const props = value.allOf[constraintIndex]?.properties
  if (!isPlainObject(props)) return fields

  for (const field of METRIC_FIELDS) {
    const entry = props[field.name]
    if (!isPlainObject(entry)) continue
    if (field.location === 'enum') {
      if (Array.isArray(entry.enum)) fields[field.name] = [...entry.enum]
    } else if ('default' in entry) {
      fields[field.name] = entry.default
    }
  }
  return fields
}

/**
 * Is this property a component list? A `type: object` carrying exactly
 * one patternProperties entry whose value is a $ref.
 */
function readComponentList (value) {
  if (!isPlainObject(value)) return null
  if (!isPlainObject(value.patternProperties)) return null

  const patterns = Object.keys(value.patternProperties)
  if (patterns.length !== 1) return null

  const inner = value.patternProperties[patterns[0]]
  if (!isPlainObject(inner)) return null

  const uuid = refToUuid(inner.$ref)
  if (!uuid) return null

  return { pattern: patterns[0], ref: uuid }
}

function parseNode (key, value) {
  const base = { id: nextId(), key, raw: clone(value) }

  if (RESERVED_PROPERTIES.has(key))
    return { ...base, kind: NodeKind.RESERVED }

  const metric = readMetric(value)
  if (metric) {
    return {
      ...base,
      kind: NodeKind.METRIC,
      refIndex: metric.refIndex,
      constraintIndex: metric.constraintIndex,
      /* The metric contract this conforms to. Not editable, but it is a
       * schema reference like any other and has to be counted as one. */
      metricRef: refToUuid(value.allOf[metric.refIndex]?.$ref),
      fields: readMetricFields(value, metric.constraintIndex),
    }
  }

  const list = readComponentList(value)
  if (list) {
    return {
      ...base,
      kind: NodeKind.COMPONENT_LIST,
      ref: list.ref,
      pattern: list.pattern,
    }
  }

  if (isPlainObject(value)) {
    const ref = refToUuid(value.$ref)
    /* A bare $ref with nothing else meaningful alongside it. */
    if (ref) return { ...base, kind: NodeKind.COMPONENT, ref }

    if (value.type === 'object' && isPlainObject(value.properties)) {
      return {
        ...base,
        kind: NodeKind.GROUP,
        children: Object.entries(value.properties)
          .map(([k, v]) => parseNode(k, v)),
      }
    }
  }

  return { ...base, kind: NodeKind.OPAQUE }
}

/**
 * Parse a schema body into a document.
 *
 * @param {object} body the JSON Schema as stored in ConfigDB
 * @returns {object} the document
 */
export function parse (body) {
  if (!isPlainObject(body))
    throw new Error('Schema body must be an object')

  const properties = isPlainObject(body.properties) ? body.properties : {}

  return {
    raw: clone(body),
    uuid: body.properties?.Schema_UUID?.const ?? refToUuid(body.$id) ?? null,
    title: typeof body.title === 'string' ? body.title : null,
    children: Object.entries(properties).map(([k, v]) => parseNode(k, v)),
  }
}

/* ------------------------------------------------------------ serialise */

/**
 * Write a metric field into a constraint block, or remove it when the
 * value is cleared. Only the named field is touched, so anything else in
 * the block survives.
 */
function writeMetricField (props, name, value) {
  const field = METRIC_FIELDS_BY_NAME[name]
  if (!field) return

  /* Only `undefined` means absent. An empty string and an explicit null
   * are both values that appear in the library (`Documentation:
   * {default: ""}`, `Eng_Unit: {default: null}`), and dropping them
   * would rewrite files the author never touched. Panels delete the
   * field from `fields` when they want the key gone. */
  const empty = value === undefined
    || (Array.isArray(value) && value.length === 0)

  if (empty) {
    if (isPlainObject(props[name])) {
      delete props[name][field.location]
      /* Drop the wrapper too once it holds nothing. */
      if (Object.keys(props[name]).length === 0) delete props[name]
    }
    return
  }

  if (!isPlainObject(props[name])) props[name] = {}
  props[name][field.location] = Array.isArray(value) ? [...value] : value
}

function serialiseMetric (node) {
  const out = clone(node.raw)

  if (!Array.isArray(out.allOf)) out.allOf = []

  /* Make sure the metric $ref is present. */
  if (node.refIndex < 0 || !out.allOf[node.refIndex]) {
    out.allOf.unshift({ $ref: uuidToRef(DEFAULT_METRIC_SCHEMA) })
    if (node.constraintIndex >= 0) node.constraintIndex += 1
    node.refIndex = 0
  }

  let ci = node.constraintIndex
  if (ci < 0 || !isPlainObject(out.allOf[ci])) {
    /* No constraint block yet. Only add one if we have something to put
     * in it, so a metric with no overrides stays as it was. */
    const hasFields = Object.values(node.fields ?? {}).some(v =>
      v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    if (!hasFields) return out
    out.allOf.push({ properties: {} })
    ci = out.allOf.length - 1
    node.constraintIndex = ci
  }

  if (!isPlainObject(out.allOf[ci].properties)) out.allOf[ci].properties = {}

  for (const field of METRIC_FIELDS)
    writeMetricField(out.allOf[ci].properties, field.name, node.fields?.[field.name])

  return out
}

function serialiseComponent (node) {
  const out = clone(node.raw) ?? {}
  out.$ref = uuidToRef(node.ref)
  return out
}

function serialiseComponentList (node) {
  /* `type: object` is not asserted here. Some library schemas declare it
   * on a component list and some do not, and adding it would rewrite a
   * file the author never touched. New lists get it from
   * newComponentList(). */
  const out = clone(node.raw) ?? {}

  const previous = isPlainObject(out.patternProperties)
    ? Object.keys(out.patternProperties)[0]
    : undefined
  const inner = previous !== undefined
    ? clone(out.patternProperties[previous]) ?? {}
    : {}

  inner.$ref = uuidToRef(node.ref)
  out.patternProperties = { [node.pattern ?? DEFAULT_LIST_PATTERN]: inner }
  return out
}

function serialiseGroup (node) {
  const out = clone(node.raw) ?? {}
  out.properties = serialiseChildren(node.children ?? [])
  return out
}

function serialiseNode (node) {
  switch (node.kind) {
    case NodeKind.METRIC: return serialiseMetric(node)
    case NodeKind.COMPONENT: return serialiseComponent(node)
    case NodeKind.COMPONENT_LIST: return serialiseComponentList(node)
    case NodeKind.GROUP: return serialiseGroup(node)
    /* Reserved and opaque nodes are never edited. */
    default: return clone(node.raw)
  }
}

function serialiseChildren (children) {
  const out = {}
  for (const child of children) out[child.key] = serialiseNode(child)
  return out
}

/**
 * Serialise a document back to a schema body.
 *
 * The serialiser owns `$id` and `Schema_UUID`; the git loader rejects a
 * schema whose $id does not match its Schema_UUID, so neither is exposed
 * to the author.
 *
 * @param {object} doc the document
 * @returns {object} the JSON Schema body
 */
export function serialise (doc) {
  const out = clone(doc.raw) ?? {}

  /* Nothing is defaulted in here. Some library schemas omit `$schema`
   * or `title`, and adding them would rewrite files the author never
   * touched. New documents get their defaults from newDocument(). */
  if (doc.title) out.title = doc.title
  else delete out.title

  out.properties = serialiseChildren(doc.children ?? [])

  if (doc.uuid) {
    out.$id = uuidToRef(doc.uuid)
    if (!isPlainObject(out.properties.Schema_UUID))
      out.properties = { Schema_UUID: { const: doc.uuid }, ...out.properties }
    else
      out.properties.Schema_UUID.const = doc.uuid
  }

  return out
}

/* -------------------------------------------------------------- editing */

/** A blank document for a brand new schema. */
export function newDocument (uuid, title) {
  return parse({
    $id: uuidToRef(uuid),
    $schema: SCHEMA_DIALECT,
    title,
    type: 'object',
    properties: {
      Schema_UUID: { const: uuid },
      Instance_UUID: {
        description:
          'The unique identifier for this object. (A UUID specified by RFC4122).',
        type: 'string',
        format: 'uuid',
      },
    },
    required: ['Schema_UUID', 'Instance_UUID'],
  })
}

/**
 * Copy a document under a new identity. Used when forking, which is the
 * only way a library schema is ever edited.
 */
export function forkDocument (doc, uuid, title) {
  const body = serialise(doc)
  body.$id = uuidToRef(uuid)
  if (isPlainObject(body.properties?.Schema_UUID))
    body.properties.Schema_UUID.const = uuid
  if (title) body.title = title
  return parse(body)
}

export function newMetric (key) {
  return parseNode(key, {
    allOf: [
      { $ref: uuidToRef(DEFAULT_METRIC_SCHEMA) },
      { properties: { Sparkplug_Type: { enum: ['String'] }, Documentation: { default: '' } } },
    ],
  })
}

export function newComponent (key, ref) {
  return parseNode(key, { $ref: uuidToRef(ref) })
}

export function newComponentList (key, ref) {
  return parseNode(key, {
    type: 'object',
    patternProperties: { [DEFAULT_LIST_PATTERN]: { $ref: uuidToRef(ref) } },
  })
}

export function newGroup (key) {
  return parseNode(key, { type: 'object', properties: {} })
}

/** Depth-first walk over every node in the document. */
export function walk (doc, visit, parent = null) {
  for (const node of doc.children ?? []) {
    visit(node, parent)
    if (node.kind === NodeKind.GROUP) walk(node, visit, node)
  }
}

/** Find a node and its parent container by node id. */
export function findNode (doc, id) {
  let found = null
  const search = (container) => {
    for (const node of container.children ?? []) {
      if (node.id === id) {
        found = { node, container }
        return true
      }
      if (node.kind === NodeKind.GROUP && search(node)) return true
    }
    return false
  }
  search(doc)
  return found
}

/** Every container in the document, so the UI can offer move targets. */
export function containers (doc) {
  const out = [{ id: null, node: doc, path: [] }]
  const collect = (container, path) => {
    for (const node of container.children ?? []) {
      if (node.kind !== NodeKind.GROUP) continue
      const here = [...path, node.key]
      out.push({ id: node.id, node, path: here })
      collect(node, here)
    }
  }
  collect(doc, [])
  return out
}

/** The dotted path to a node, for display and for change descriptions. */
export function pathOf (doc, id) {
  let result = null
  const search = (container, path) => {
    for (const node of container.children ?? []) {
      const here = [...path, node.key]
      if (node.id === id) {
        result = here
        return true
      }
      if (node.kind === NodeKind.GROUP && search(node, here)) return true
    }
    return false
  }
  search(doc, [])
  return result
}

/**
 * Is this key free in the container? Property names must be unique
 * within their object, and the reserved names are never available.
 */
export function keyAvailable (container, key, exceptId = null) {
  if (RESERVED_PROPERTIES.has(key)) return false
  return !(container.children ?? [])
    .some(n => n.key === key && n.id !== exceptId)
}

/**
 * Every schema UUID this document references, at any depth.
 *
 * Includes the metric contract each metric conforms to. That reference
 * is not editable in the composer, but it is still a dependency: a
 * schema whose metric contract is unpublished cannot be resolved, and
 * anything that changes the contract reaches every schema using it.
 */
export function referencedSchemas (doc) {
  const refs = new Set()
  walk(doc, node => {
    if (node.kind === NodeKind.COMPONENT || node.kind === NodeKind.COMPONENT_LIST) {
      if (node.ref) refs.add(node.ref)
    } else if (node.kind === NodeKind.METRIC) {
      if (node.metricRef) refs.add(node.metricRef)
    }
  })
  return refs
}

/** Just the component references, for the parts the composer manages. */
export function referencedComponents (doc) {
  const refs = new Set()
  walk(doc, node => {
    if (node.kind === NodeKind.COMPONENT || node.kind === NodeKind.COMPONENT_LIST)
      if (node.ref) refs.add(node.ref)
  })
  return refs
}
