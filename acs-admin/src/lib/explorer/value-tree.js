/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The current values of a composition, as a tree. i3X answers a
 * composition's value with a flat map of leaf element IDs; the tree
 * comes from the has-children relationship, which also gives the names.
 */

// How many levels below a composition are read in one go. Deeper
// compositions are read when they are expanded.
export const LOAD_DEPTH = 3
// Stop reading further levels once this many rows are loaded, so a
// composition high in the hierarchy does not flood the browser.
export const MAX_ROWS = 500

const HAS_CHILDREN = 'i3x:rel:has-children'

/**
 * A row of the tree. `children` is null until that level is read, or
 * when reading it failed, with the reason in `error`; `vqt` is the value
 * of a leaf, null if the server did not report one.
 */
export function mk_node (obj) {
  return {
    elementId: obj.elementId,
    displayName: obj.displayName ?? obj.elementId,
    isComposition: !!obj.isComposition,
    children: null,
    error: null,
    vqt: null,
  }
}

/**
 * Read up to `depth` levels of structure below `top`, and the values of
 * the leaves in them, into `top`. The structure takes one request per
 * level and the values one request, made alongside. Compositions left
 * at the bottom, or past `max_rows`, keep `children: null`.
 */
export async function load_subtree (i3x, top, { depth = LOAD_DEPTH, max_rows = MAX_ROWS } = {}) {
  const values = i3x.getValueBulk([top.elementId], depth)

  let frontier = [top]
  let rows = 0
  for (let level = 0; level < depth && frontier.length; level++) {
    const byId = new Map(frontier.map(n => [n.elementId, n]))
    const related = await i3x.getRelatedBulk([...byId.keys()], HAS_CHILDREN)
    const next = []
    for (const r of related) {
      const parent = byId.get(r.elementId)
      if (!parent) continue
      if (!r.success) {
        parent.error = r.error?.message ?? 'Failed to load'
        continue
      }
      parent.children = r.result.map(mk_node)
      rows += parent.children.length
      next.push(...parent.children.filter(c => c.isComposition))
    }
    if (rows >= max_rows) break
    frontier = next
  }

  const result = (await values)[0]
  const components = result?.success ? result.result?.components ?? {} : {}
  const fill = node => {
    if (!node.isComposition) node.vqt = components[node.elementId] ?? null
    node.children?.forEach(fill)
  }
  fill(top)
}

/**
 * Read the levels below a composition the user expanded. They are read
 * into a copy, so the rows appear with their values.
 */
export async function expand (i3x, node, opts) {
  const loaded = mk_node(node)
  await load_subtree(i3x, loaded, opts)
  node.children = loaded.children
  node.error = loaded.error
}

/**
 * How a leaf's value reads. The server leaves out of a composition's
 * value any leaf it has no value for, and when the cache only holds
 * part of a composition it answers with that part alone, so a leaf
 * that is left out is not known to have no data.
 */
export function leaf_state (node) {
  if (!node.vqt) return 'not-reported'
  return node.vqt.value == null ? 'no-value' : 'value'
}

/** Count the leaves loaded under `node`, and those the server reported. */
export function count_leaves (node) {
  const count = { leaves: 0, reported: 0 }
  const walk = n => {
    for (const c of n.children ?? []) {
      if (c.isComposition) walk(c)
      else {
        count.leaves++
        if (c.vqt) count.reported++
      }
    }
  }
  walk(node)
  return count
}
