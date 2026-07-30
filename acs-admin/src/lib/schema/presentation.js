/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Presentation conventions for the schema editor.
 *
 * One place for the decisions the design makes, so the tree, the panels,
 * the list and the publish page cannot drift apart.
 *
 * Colour is used sparingly and means something:
 *   green  additive, safe
 *   amber  breaking, and the group folder glyph the app already uses
 *   red    failure only. A breaking change is serious, not an error, so
 *          it is never red.
 */

import { NodeKind, SPARKPLUG_TYPES } from './constants.js'

/** Glyph, colour and label for each node kind. */
export const NODE_PRESENTATION = {
  [NodeKind.METRIC]: {
    icon: 'fa-gauge',
    colour: 'text-slate-400',
    label: 'metric',
    title: 'Metric',
    mono: true,
  },
  [NodeKind.COMPONENT]: {
    icon: 'fa-cube',
    colour: 'text-slate-700',
    label: 'component',
    title: 'Component',
    weight: 'font-medium',
  },
  [NodeKind.COMPONENT_LIST]: {
    icon: 'fa-cubes',
    colour: 'text-slate-700',
    label: 'component list',
    title: 'Component list',
    weight: 'font-medium',
  },
  [NodeKind.GROUP]: {
    icon: 'fa-folder',
    openIcon: 'fa-folder-open',
    colour: 'text-amber-500',
    label: 'group',
    title: 'Group',
  },
  [NodeKind.OPAQUE]: {
    icon: 'fa-file-code',
    colour: 'text-slate-300',
    label: 'Not modelled',
    title: 'Not modelled',
    mono: true,
  },
  [NodeKind.RESERVED]: {
    icon: 'fa-lock',
    colour: 'text-slate-400',
    label: 'set by the platform',
    title: 'Set by the platform',
    mono: true,
  },
}

export const presentationFor = kind =>
  NODE_PRESENTATION[kind] ?? NODE_PRESENTATION[NodeKind.OPAQUE]

/**
 * Sparkplug types, grouped so 28 of them stay legible when browsing.
 * Searching is the fast path; the groups are for the rest of the time.
 *
 * Hints are given only where the range is the thing that distinguishes
 * one entry from its neighbours.
 */
export const TYPE_GROUPS = [
  {
    label: 'Floating point',
    types: [
      { name: 'FloatLE', hint: '32-bit, little endian' },
      { name: 'FloatBE', hint: '32-bit, big endian' },
      { name: 'DoubleLE', hint: '64-bit, little endian' },
      { name: 'DoubleBE', hint: '64-bit, big endian' },
    ],
  },
  {
    label: 'Signed integers',
    types: [
      { name: 'Int8', hint: '-128 to 127' },
      { name: 'Int16LE', hint: '±32k' },
      { name: 'Int16BE', hint: '±32k' },
      { name: 'Int32LE', hint: '±2.1bn' },
      { name: 'Int32BE', hint: '±2.1bn' },
      { name: 'Int64LE' },
      { name: 'Int64BE' },
    ],
  },
  {
    label: 'Unsigned integers',
    types: [
      { name: 'UInt8', hint: '0 to 255' },
      { name: 'UInt16LE', hint: '0 to 65k' },
      { name: 'UInt16BE', hint: '0 to 65k' },
      { name: 'UInt32LE', hint: '0 to 4.3bn' },
      { name: 'UInt32BE', hint: '0 to 4.3bn' },
      { name: 'UInt64LE' },
      { name: 'UInt64BE' },
    ],
  },
  {
    label: 'Text and flags',
    types: [
      { name: 'Boolean' },
      { name: 'String' },
      { name: 'Text', hint: 'Long form' },
      { name: 'UUID' },
    ],
  },
  {
    label: 'Time',
    types: [{ name: 'DateTime' }],
  },
  {
    label: 'Structured',
    types: [
      { name: 'DataSet' },
      { name: 'Bytes' },
      { name: 'File' },
      { name: 'Template' },
    ],
  },
  {
    label: 'Other',
    types: [{ name: 'Unknown', hint: 'Type not declared' }],
  },
]

/* Every Sparkplug type must appear exactly once in the groups. A type
 * missing from here would be unreachable in the editor, so this is
 * asserted by the tests rather than left to inspection. */
export const GROUPED_TYPES = TYPE_GROUPS.flatMap(g => g.types.map(t => t.name))

export const TYPE_HINTS = Object.fromEntries(
  TYPE_GROUPS.flatMap(g => g.types.map(t => [t.name, t.hint ?? null])),
)

export { SPARKPLUG_TYPES }

/** Lifecycle badge for a schema row. Published carries no badge. */
export function lifecycleOf (row) {
  if (row.isDraft) return { kind: 'draft', label: 'Draft', icon: 'fa-pen' }
  if (row.supersededBy) return { kind: 'superseded', label: 'Superseded' }
  return null
}

/**
 * Origin glyph.
 *
 * The glyph carries origin; the name does not. The design had library
 * names sit muted so that origin read as ink weight, but a real
 * deployment is almost entirely library (139 of 141 here), so that
 * greyed the whole table and made it hard to read. Names are full
 * weight and full ink, the same as every other table in the app, and
 * grey is kept for genuinely secondary data.
 */
export function originOf (row) {
  if (row.origin === 'AMRC library') {
    return {
      icon: 'fa-lock',
      colour: 'text-slate-400',
      label: 'AMRC library',
    }
  }
  return {
    icon: 'fa-location-dot',
    colour: 'text-slate-700',
    label: 'Local',
  }
}
