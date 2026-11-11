/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * What the Explorer page works out from the i3X model: what kind of
 * thing an object is, from its type, and how the objects round it are
 * related to it. Pure functions: unit-tested in
 * test/explorer-model.test.js.
 */

import { REL } from '@composables/useI3xClient.js'

// The i3X type of an ISA-95 level object.
export const ISA95_LEVEL_TYPE = 'isa95-level'

/* The kinds of object the page tells apart, with the words and the
 * icon it shows for each. */
export const KINDS = {
  level:   { label: 'ISA-95 level', icon: 'fa-sitemap text-sky-600' },
  object:  { label: 'Object',       icon: 'fa-folder text-amber-500' },
  number:  { label: 'Number',       icon: 'fa-hashtag text-slate-500' },
  boolean: { label: 'True or false', icon: 'fa-toggle-on text-slate-500' },
  string:  { label: 'Text',         icon: 'fa-font text-slate-500' },
  value:   { label: 'Value',        icon: 'fa-circle-dot text-slate-500' },
}

/**
 * The kind of an object. i3X gives every object a listed type, and a
 * data point's type has a scalar JSON Schema, so the kind of value
 * comes from `schema.type`. An object whose type is not loaded yet, or
 * has no one JSON type, is an 'object' if it is a composition and a
 * plain 'value' if it is not.
 *
 * @param node   an i3X object: { typeElementId, isComposition }
 * @param types  Map of type elementId -> i3X object type
 */
export function kind_of (node, types) {
  if (!node) return 'value'
  if (node.typeElementId === ISA95_LEVEL_TYPE) return 'level'
  if (node.isComposition) return 'object'
  const json = types?.get(node.typeElementId)?.schema?.type
  switch (Array.isArray(json) ? json.find(t => t !== 'null') : json) {
    case 'number': case 'integer': return 'number'
    case 'boolean': return 'boolean'
    case 'string': return 'string'
    default: return 'value'
  }
}

/**
 * An object's type as the page shows it: { id, name, namespaceUri,
 * kind, label, icon }. `name` is the type's display name, or null when
 * the type is not known, so the caller can fall back to the id.
 */
export function describe_type (node, types) {
  const type = types?.get(node?.typeElementId)
  const kind = kind_of(node, types)
  const named = type?.displayName && type.displayName !== type.elementId
  return {
    id: node?.typeElementId ?? null,
    name: named ? type.displayName : null,
    namespaceUri: type?.namespaceUri ?? null,
    kind,
    ...KINDS[kind],
  }
}

/* How the object at the far end of an edge stands to the object at
 * the near end, by the relationship that leads to it. */
const ROLES = {
  [REL.HasParent]: 'parent',
  [REL.ComponentOf]: 'parent',
  [REL.HasChildren]: 'child',
  [REL.HasComponent]: 'component',
}

export function role_of (sourceRelationship) {
  return ROLES[sourceRelationship] ?? 'related'
}

/**
 * The nodes and edges of the relationship graph round one object.
 *
 * @param root    { elementId, displayName }: the selected object
 * @param layers  one entry per step out from the root: the per-id
 *                results of a related lookup,
 *                [{ success, elementId, result: [object] }], each
 *                object with the `sourceRelationship` that leads to it
 * @returns { nodes, edges } as cytoscape elements. A node's `type` is
 *   'selected' for the root, else the role of the first edge that
 *   reached it. Each pair of objects gets one edge, labelled with the
 *   relationship read from `source` to `target`.
 */
export function graph_elements (root, layers) {
  const nodes = new Map()
  const edges = new Map()
  nodes.set(root.elementId, {
    data: { id: root.elementId, label: root.displayName || root.elementId, type: 'selected' },
  })
  for (const layer of layers ?? []) {
    for (const item of layer ?? []) {
      if (!item?.success || !nodes.has(item.elementId)) continue
      for (const rel of item.result ?? []) {
        if (!rel?.elementId) continue
        if (!nodes.has(rel.elementId)) {
          nodes.set(rel.elementId, {
            data: {
              id: rel.elementId,
              label: rel.displayName || rel.elementId,
              type: role_of(rel.sourceRelationship),
            },
          })
        }
        const key = [item.elementId, rel.elementId].sort().join(' ')
        if (edges.has(key)) continue
        edges.set(key, {
          data: {
            id: `${item.elementId}-${rel.elementId}`,
            source: item.elementId,
            target: rel.elementId,
            label: rel.sourceRelationship ?? '',
          },
        })
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/** The ids a layer of the graph reached that are not yet in `seen`,
 * which it adds them to: the objects to ask about next. */
export function next_layer (layer, seen) {
  const out = []
  for (const item of layer ?? []) {
    if (!item?.success) continue
    for (const rel of item.result ?? []) {
      if (!rel?.elementId || seen.has(rel.elementId)) continue
      seen.add(rel.elementId)
      out.push(rel.elementId)
    }
  }
  return out
}

/**
 * What an object holds, from the `relationships` of its i3X metadata:
 * [{ relationship, label, count }] for the downward relationships it
 * has, so "3 children" or "24 components". Empty for a data point.
 */
export function contents_of (metadata) {
  const rels = metadata?.relationships ?? {}
  const count = v => Array.isArray(v) ? v.length : v ? 1 : 0
  const out = []
  const add = (relationship, one, many) => {
    const n = count(rels[relationship])
    if (n) out.push({ relationship, count: n, label: `${n} ${n === 1 ? one : many}` })
  }
  add(REL.HasChildren, 'child', 'children')
  add(REL.HasComponent, 'component', 'components')
  return out
}

/** The id of an object's parent, from its metadata, whichever of the
 * two upward relationships leads to it; null for a root. */
export function parent_of (metadata) {
  const rels = metadata?.relationships ?? {}
  const up = rels[REL.HasParent] ?? rels[REL.ComponentOf]
  return (Array.isArray(up) ? up[0] : up) ?? null
}
