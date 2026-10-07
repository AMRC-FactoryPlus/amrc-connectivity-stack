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
 * at the bottom, or past `max_rows`, keep `children: null`. If the
 * server's maxDepthCap cut the values short, the compositions below the
 * cap are left unread too, to be read when they are expanded.
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

  const { results, partial } = await values
  if (partial) {
    const info = await i3x.getInfo()
    unread_below(top, info?.capabilities?.query?.maxDepthCap ?? 1)
  }

  const result = results[0]
  const components = result?.success ? result.result?.components ?? {} : {}
  const fill = node => {
    if (!node.isComposition) node.vqt = components[node.elementId] ?? null
    node.children?.forEach(fill)
  }
  fill(top)
}

/* Mark the compositions `depth` levels below `top` as unread. Their
 * leaves are one level further down, past what the values reached. */
function unread_below (top, depth) {
  const walk = (node, level) => {
    for (const c of node.children ?? []) {
      if (!c.isComposition) continue
      if (level >= depth) c.children = null
      else walk(c, level + 1)
    }
  }
  walk(top, 1)
}

/**
 * Read the levels below a composition the user expanded. They are read
 * into a copy, so the rows appear with their values. If `is_current`
 * says the selection changed while they were read, the node is left
 * alone and a failure is dropped. Returns whether the node was updated.
 */
export async function expand (i3x, node, { is_current = () => true, ...opts } = {}) {
  const loaded = mk_node(node)
  try {
    await load_subtree(i3x, loaded, opts)
  } catch (e) {
    if (is_current()) throw e
    return false
  }
  if (!is_current()) return false
  node.children = loaded.children
  node.error = loaded.error
  return true
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
