/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Constants for the schema composer.
 *
 * The composer works in a closed vocabulary of node kinds. Anything a
 * schema contains that does not map onto one of them is held as an
 * OPAQUE node and round-trips untouched.
 */

/**
 * Schemas which define the Sparkplug metric contract. A property whose
 * `allOf` references one of these is a metric.
 *
 * This is a set rather than a single UUID so that a future Metric-v2 can
 * be recognised without changing the parser.
 */
export const METRIC_SCHEMAS = new Set([
  'b16275f1-e443-4c41-a482-fcbdfbd20769', // Common/Metric-v1
])

/** The metric schema used when the composer creates a new metric. */
export const DEFAULT_METRIC_SCHEMA = 'b16275f1-e443-4c41-a482-fcbdfbd20769'

/** Property names owned by Factory+ rather than by the author. */
export const RESERVED_PROPERTIES = new Set([
  'Schema_UUID',
  'Instance_UUID',
])

/** The pattern used for a new component list. Matches the library's. */
export const DEFAULT_LIST_PATTERN = '^[a-zA-Z0-9_]*$'

export const NodeKind = {
  /* Schema_UUID / Instance_UUID. Shown but never editable. */
  RESERVED: 'reserved',
  /* allOf: [{$ref: Metric}, {properties: {...}}] */
  METRIC: 'metric',
  /* $ref: urn:uuid:... */
  COMPONENT: 'component',
  /* type: object with patternProperties holding a single $ref */
  COMPONENT_LIST: 'componentList',
  /* type: object with properties */
  GROUP: 'group',
  /* anything else, preserved verbatim */
  OPAQUE: 'opaque',
}

/**
 * The metric fields the composer edits. Everything else inside a metric
 * constraint block is preserved but not surfaced.
 *
 * `location` says where the value sits inside the constraint block:
 *   enum    - constraint.properties.<name>.enum, an array
 *   default - constraint.properties.<name>.default, a scalar
 */
export const METRIC_FIELDS = [
  {
    name: 'Sparkplug_Type',
    label: 'Sparkplug type',
    location: 'enum',
    type: 'string',
    /* Removing an allowed type is breaking; adding one is not. */
    setSemantics: true,
  },
  { name: 'Documentation', label: 'Documentation', location: 'default', type: 'string' },
  { name: 'Eng_Unit', label: 'Unit', location: 'default', type: 'string' },
  { name: 'Eng_Low', label: 'Low', location: 'default', type: 'number' },
  { name: 'Eng_High', label: 'High', location: 'default', type: 'number' },
  { name: 'Deadband', label: 'Deadband', location: 'default', type: 'string' },
  { name: 'Tooltip', label: 'Tooltip', location: 'default', type: 'string' },
  { name: 'Method', label: 'Method', location: 'default', type: 'string' },
  {
    name: 'Record_To_Historian',
    label: 'Record to historian',
    location: 'default',
    type: 'boolean',
  },
]

export const METRIC_FIELDS_BY_NAME = Object.fromEntries(
  METRIC_FIELDS.map(f => [f.name, f]),
)

/**
 * The Sparkplug B data types, as enumerated by Common/Metric-v1. Held
 * here rather than read from the schema store so the composer works
 * before the store has loaded. The list is fixed by the Sparkplug
 * specification.
 */
export const SPARKPLUG_TYPES = [
  'Unknown',
  'Int8', 'Int16LE', 'Int16BE', 'Int32LE', 'Int32BE', 'Int64LE', 'Int64BE',
  'UInt8', 'UInt16LE', 'UInt16BE', 'UInt32LE', 'UInt32BE', 'UInt64LE', 'UInt64BE',
  'FloatLE', 'FloatBE', 'DoubleLE', 'DoubleBE',
  'Boolean', 'String', 'DateTime', 'Text', 'UUID',
  'DataSet', 'Bytes', 'File', 'Template',
]

/** The JSON Schema dialect new schemas declare. */
export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** Strip the urn:uuid: prefix from a ref. Returns null if it is not one. */
export function refToUuid (ref) {
  if (typeof ref !== 'string') return null
  const m = ref.match(/^urn:uuid:([-0-9a-fA-F]{36})$/)
  return m ? m[1].toLowerCase() : null
}

/** Build a urn:uuid: ref from a bare UUID. */
export function uuidToRef (uuid) {
  return `urn:uuid:${uuid}`
}
