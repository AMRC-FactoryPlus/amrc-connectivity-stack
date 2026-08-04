/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The change classifier.
 *
 * Given the published body of a schema and the draft body, work out what
 * changed and whether any of it breaks devices already using the schema.
 *
 * This deliberately does not diff arbitrary JSON Schema. It diffs the
 * composer model, which is a closed vocabulary, and treats any change
 * touching a node the composer does not understand as breaking without
 * attempting to analyse it. General JSON Schema semantic diffing is an
 * open problem; this is a table of cases.
 *
 * The rule the classification serves: a device's origin map addresses
 * metrics by name and path. Anything that moves, removes or retypes an
 * existing address breaks that device. Anything purely additive does not.
 */

import { NodeKind } from './constants.js'
import { parse, serialise } from './document.js'

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export const ChangeKind = {
  ADDED: 'added',
  REMOVED: 'removed',
  RENAMED: 'renamed',
  MODIFIED: 'modified',
  RETYPED: 'retyped',
}

function change (kind, path, summary, breaking, extra = {}) {
  return { kind, path, summary, breaking, ...extra }
}

const show = path => path.join(' / ')

/**
 * Pair up removals and additions within one container that carry
 * identical bodies. Those are renames rather than a delete plus a
 * create, which makes for a far more useful change list even though both
 * classify as breaking.
 */
function detectRenames (removed, added) {
  const renames = []
  const remaining = { removed: [...removed], added: [...added] }

  for (const gone of [...remaining.removed]) {
    const match = remaining.added.find(a =>
      a.node.kind === gone.node.kind && deepEqual(a.body, gone.body))
    if (!match) continue
    renames.push({ from: gone, to: match })
    remaining.removed = remaining.removed.filter(r => r !== gone)
    remaining.added = remaining.added.filter(a => a !== match)
  }

  return { renames, removed: remaining.removed, added: remaining.added }
}

/** Compare the composer-visible fields of two metrics. */
function compareMetric (before, after, path, out) {
  const oldFields = before.fields ?? {}
  const newFields = after.fields ?? {}

  const oldTypes = oldFields.Sparkplug_Type ?? []
  const newTypes = newFields.Sparkplug_Type ?? []

  const lost = oldTypes.filter(t => !newTypes.includes(t))
  const gained = newTypes.filter(t => !oldTypes.includes(t))

  /* Narrowing the allowed types invalidates data already being
   * published; widening them does not. */
  if (lost.length)
    out.push(change(ChangeKind.MODIFIED, path,
      `${show(path)}: no longer accepts ${lost.join(', ')}`, true))
  if (gained.length)
    out.push(change(ChangeKind.MODIFIED, path,
      `${show(path)}: also accepts ${gained.join(', ')}`, false))

  for (const name of Object.keys({ ...oldFields, ...newFields })) {
    if (name === 'Sparkplug_Type') continue
    if (deepEqual(oldFields[name], newFields[name])) continue
    out.push(change(ChangeKind.MODIFIED, path,
      `${show(path)}: ${name} changed`, false))
  }

  /* Anything outside the fields the composer knows about. Compare what
   * is left of the raw bodies after the known fields are stripped. */
  if (!deepEqual(strippedMetric(before), strippedMetric(after)))
    out.push(change(ChangeKind.MODIFIED, path,
      `${show(path)}: changed outside the editable fields`, true))
}

/**
 * A metric's raw body with the composer-managed constraint block
 * removed, so two metrics can be compared on the parts the composer does
 * not manage.
 */
function strippedMetric (node) {
  const raw = JSON.parse(JSON.stringify(node.raw ?? {}))
  if (Array.isArray(raw.allOf) && node.constraintIndex >= 0)
    raw.allOf[node.constraintIndex] = null
  return raw
}

function compareNode (before, after, path, out) {
  if (before.kind !== after.kind) {
    out.push(change(ChangeKind.RETYPED, path,
      `${show(path)}: changed from ${label(before.kind)} to ${label(after.kind)}`,
      true))
    return
  }

  switch (before.kind) {
    case NodeKind.METRIC:
      compareMetric(before, after, path, out)
      break

    case NodeKind.COMPONENT:
      if (before.ref !== after.ref)
        out.push(change(ChangeKind.MODIFIED, path,
          `${show(path)}: now uses a different component`, true))
      break

    case NodeKind.COMPONENT_LIST:
      if (before.ref !== after.ref)
        out.push(change(ChangeKind.MODIFIED, path,
          `${show(path)}: now uses a different component`, true))
      /* The pattern constrains what instances may be named. */
      if (before.pattern !== after.pattern)
        out.push(change(ChangeKind.MODIFIED, path,
          `${show(path)}: naming pattern changed`, true))
      break

    case NodeKind.GROUP:
      compareChildren(before, after, path, out)
      break

    case NodeKind.RESERVED:
    case NodeKind.OPAQUE:
    default:
      /* Not editable through the composer, so any difference came from
       * the raw view or a fork. Classified breaking without analysis. */
      if (!deepEqual(before.raw, after.raw))
        out.push(change(ChangeKind.MODIFIED, path,
          `${show(path)}: changed`, true))
      break
  }
}

function label (kind) {
  switch (kind) {
    case NodeKind.METRIC: return 'a metric'
    case NodeKind.COMPONENT: return 'a component'
    case NodeKind.COMPONENT_LIST: return 'a component list'
    case NodeKind.GROUP: return 'a group'
    case NodeKind.RESERVED: return 'a reserved property'
    default: return 'raw schema'
  }
}

function compareChildren (before, after, path, out) {
  const oldByKey = new Map((before.children ?? []).map(n => [n.key, n]))
  const newByKey = new Map((after.children ?? []).map(n => [n.key, n]))

  const removed = []
  const added = []

  for (const [key, node] of oldByKey)
    if (!newByKey.has(key))
      removed.push({ key, node, body: node.raw })

  for (const [key, node] of newByKey)
    if (!oldByKey.has(key))
      added.push({ key, node, body: node.raw })

  const paired = detectRenames(removed, added)

  for (const { from, to } of paired.renames)
    out.push(change(ChangeKind.RENAMED, [...path, to.key],
      `${show([...path, from.key])} renamed to ${to.key}`, true,
      { from: from.key, to: to.key }))

  for (const gone of paired.removed)
    out.push(change(ChangeKind.REMOVED, [...path, gone.key],
      `${show([...path, gone.key])} removed`, true))

  for (const fresh of paired.added)
    out.push(change(ChangeKind.ADDED, [...path, fresh.key],
      `${show([...path, fresh.key])} added`, false))

  /* Nodes present in both. Order is not compared: JSON Schema property
   * order carries no meaning, so reordering is presentation. */
  for (const [key, oldNode] of oldByKey) {
    const newNode = newByKey.get(key)
    if (newNode) compareNode(oldNode, newNode, [...path, key], out)
  }
}

/** Compare the top-level `required` arrays. */
function compareRequired (before, after, out) {
  const oldReq = Array.isArray(before.raw?.required) ? before.raw.required : []
  const newReq = Array.isArray(after.raw?.required) ? after.raw.required : []

  const gained = newReq.filter(r => !oldReq.includes(r))
  const lost = oldReq.filter(r => !newReq.includes(r))

  /* Requiring something that was optional invalidates instances that
   * omit it. Dropping a requirement cannot invalidate anything. */
  if (gained.length)
    out.push(change(ChangeKind.MODIFIED, ['required'],
      `${gained.join(', ')} now required`, true))
  if (lost.length)
    out.push(change(ChangeKind.MODIFIED, ['required'],
      `${lost.join(', ')} no longer required`, false))
}

/**
 * Classify the difference between two schema bodies.
 *
 * @param {object} publishedBody the schema as published
 * @param {object} draftBody the schema as edited
 * @returns {{changes: Array, breaking: boolean, additive: boolean}}
 */
export function classify (publishedBody, draftBody) {
  const before = parse(publishedBody)
  const after = parse(draftBody)

  const changes = []

  if ((before.title ?? null) !== (after.title ?? null))
    changes.push(change(ChangeKind.MODIFIED, ['title'], 'Title changed', false))

  /* Whether a schema is offered as a device's own schema says nothing
   * about the data it describes, so it cannot invalidate a device that
   * is already using it. */
  if (before.topLevel !== after.topLevel)
    changes.push(change(ChangeKind.MODIFIED, ['topLevel'],
      after.topLevel
        ? 'Marked as a top-level schema'
        : 'No longer a top-level schema',
      false))

  compareChildren(before, after, [], changes)
  compareRequired(before, after, changes)

  const breaking = changes.some(c => c.breaking)

  return {
    changes,
    breaking,
    additive: changes.length > 0 && !breaking,
  }
}

/**
 * Has the draft diverged from what was published at all? Used to decide
 * whether publishing has anything to do.
 */
export function hasChanges (publishedBody, draftBody) {
  return !deepEqual(serialise(parse(publishedBody)), serialise(parse(draftBody)))
}
