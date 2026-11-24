/*
 * ACS Admin
 * ISA-95 hierarchy: the tree view, device counts, the duplicate check
 * and the writes behind adding, renaming and moving nodes
 * Copyright 2026 University of Sheffield AMRC
 *
 * Everything except the writers at the end is pure, so it can be
 * tested without a browser. The writers take the ConfigDB client as an
 * argument. `vocab` is always the result of `vocabulary_of`.
 */

import { ISA95_LEVELS, UUIDs } from '@amrc-factoryplus/service-client'

const by_name = (a, b) => a.name.localeCompare(b.name)

/** The level one below `level`, or null for a Work Unit. */
export function child_level (level) {
  const ix = ISA95_LEVELS.indexOf(level)
  return ix < 0 ? null : ISA95_LEVELS[ix + 1] ?? null
}

/** The level one above `level`, or null for an Enterprise. */
export function parent_level (level) {
  const ix = ISA95_LEVELS.indexOf(level)
  return ix > 0 ? ISA95_LEVELS[ix - 1] : null
}

/** The plural of a level name. */
export function level_plural (level) {
  return `${level}s`
}

/** A level with its indefinite article, such as "an Area". */
export function level_with_article (level) {
  return `${/^[AEIOU]/.test(level) ? 'an' : 'a'} ${level}`
}

/** The names from the top of the hierarchy down to a node, following
 * its first parent at each step. Used to show where a node is. */
export function node_path (vocab, uuid) {
  const out = []
  const seen = new Set()
  let cur = uuid
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = vocab.nodes.get(cur)
    if (!n) break
    out.unshift(n.name)
    cur = vocab.parents.get(cur)?.[0]
  }
  return out
}

/** Every node at or under `uuid`, the node included. */
function subtree (vocab, uuid) {
  const out = new Set()
  const todo = [uuid]
  while (todo.length) {
    const u = todo.pop()
    if (out.has(u)) continue
    out.add(u)
    for (const c of vocab.nodes.get(u)?.children ?? []) todo.push(c)
  }
  return out
}

/** Every node above `uuid` through any parent, the node included. */
function ancestors (vocab, uuid) {
  const out = new Set()
  const todo = [uuid]
  while (todo.length) {
    const u = todo.pop()
    if (out.has(u)) continue
    out.add(u)
    for (const p of vocab.parents.get(u) ?? []) todo.push(p)
  }
  return out
}

/** How many devices sit on each node, and at or below it.
 * A device counts once at each node, however many paths lead down to
 * it, so a node under two parents adds its devices to both but only
 * once to a node above both.
 * @arg placements A Map or array of `[device, placement]` pairs.
 * @returns A Map from node UUID to `{ here, total }`.
 */
export function device_counts (vocab, placements) {
  const here = new Map()
  const under = new Map()
  for (const [device, p] of placements ?? []) {
    const node = p?.node
    if (!node || !vocab.nodes.has(node)) continue
    here.set(node, (here.get(node) ?? 0) + 1)
    for (const a of ancestors(vocab, node)) {
      if (!under.has(a)) under.set(a, new Set())
      under.get(a).add(device)
    }
  }
  const out = new Map()
  for (const uuid of vocab.nodes.keys())
    out.set(uuid, { here: here.get(uuid) ?? 0, total: under.get(uuid)?.size ?? 0 })
  return out
}

/** A name folded for comparison: lower case, letters and digits only. */
export function fold_name (name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

/** The initials of a name's words, keeping digit runs whole, so
 * "Plant 7" gives "p7" and "Knowledge Transfer Centre" "ktc".
 * One-word names have no abbreviation. */
export function abbreviation (name) {
  const words = String(name ?? '').toLowerCase().normalize('NFKD')
    .split(/[^a-z0-9]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/)
    .filter(Boolean)
  if (words.length < 2) return null
  return words.map(w => /^[0-9]+$/.test(w) ? w : w[0]).join('')
}

/* Levenshtein distance, giving up once it passes `max`. */
function edit_distance (a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/* How far apart two folded names may be and still look like the same
 * name: none for very short names, one edit, and two only for long
 * names, so "South Works" and "North Works" stay apart. */
const edit_allowance = len => len < 4 ? 0 : len < 12 ? 1 : 2

/** Why `typed` looks like the node `n`, or null when it doesn't.
 * The checks run strongest first, so the reason given is the best one.
 * `strong` is false for a name that only contains the other, which is
 * worth showing when someone adds a node but too noisy to flag in the
 * tree ("Cell 1" and "Cell 10"). */
export function name_match (typed, n) {
  const raw = String(typed ?? '').trim()
  const t = fold_name(raw)
  if (!t) return null
  const names = [n.name, ...(n.aliases ?? [])]

  if (n.name.trim().toLowerCase() === raw.toLowerCase())
    return { why: 'same name', strong: true }
  if (fold_name(n.name) === t)
    return { why: 'same name, ignoring punctuation', strong: true }
  for (const a of n.aliases ?? []) {
    if (fold_name(a) === t)
      return { why: `alias "${a}"`, strong: true }
  }
  for (const name of names) {
    const ab = abbreviation(name)
    if (ab && ab.length >= 2 && ab === t)
      return { why: `abbreviation of "${name}"`, strong: true }
    const tab = abbreviation(raw)
    if (tab && tab.length >= 2 && tab === fold_name(name))
      return { why: `"${raw}" abbreviates to "${name}"`, strong: true }
  }
  /* Names whose numbers differ ("Cell 1", "Cell 10") are different
   * things, however close the spelling. */
  const digits = s => (s.match(/[0-9]+/g) ?? []).join(',')
  for (const name of names) {
    const f = fold_name(name)
    if (digits(f) !== digits(t)) continue
    const allow = edit_allowance(Math.min(f.length, t.length))
    if (allow > 0 && edit_distance(f, t, allow) <= allow)
      return { why: 'similar name', strong: true }
  }
  for (const name of names) {
    const f = fold_name(name)
    const [short, long] = f.length <= t.length ? [f, t] : [t, f]
    if (short.length >= 3 && long.includes(short))
      return { why: `contains "${f.length <= t.length ? name : raw}"`, strong: false }
  }
  return null
}

/** Nodes at `level` anywhere in the hierarchy whose name or aliases
 * look like `name`, for the warning shown before a node is added or
 * renamed. Sorted by the devices at or under each node, most first,
 * so the node most devices already use comes first.
 * @arg opts.level The level of the new or renamed node.
 * @arg opts.name The name typed.
 * @arg opts.exclude A node to leave out (the one being renamed).
 * @arg opts.counts From `device_counts`, or omitted.
 * @returns `[{ uuid, name, level, path, why, devices }]`.
 */
export function similar_nodes (vocab, { level, name, exclude, counts }) {
  const out = []
  for (const n of vocab.nodes.values()) {
    if (n.level !== level || n.uuid === exclude) continue
    const m = name_match(name, n)
    if (!m) continue
    out.push({
      uuid:     n.uuid,
      name:     n.name,
      level:    n.level,
      path:     node_path(vocab, n.uuid).slice(0, -1).join(' / '),
      why:      m.why,
      devices:  counts?.get(n.uuid)?.total ?? 0,
    })
  }
  return out.sort((a, b) => b.devices - a.devices || by_name(a, b))
}

/* The nodes listed together at the top of the tree or under one
 * parent: Enterprises and parentless nodes, or a parent's children. */
function sibling_groups (vocab) {
  const groups = [[...vocab.nodes.values()].filter(n => !vocab.parents.get(n.uuid)?.length)]
  for (const n of vocab.nodes.values())
    groups.push(n.children.map(c => vocab.nodes.get(c)).filter(Boolean))
  return groups
}

/** Nodes that look like a duplicate of a sibling (same parent, same
 * level, a strong name match). The node with fewer devices is flagged
 * and points at the other; with equal counts both are flagged.
 * Siblings only, because "Cell 1" in two different Areas is normal.
 * @returns A Map from the flagged node's UUID to the likely original's.
 */
export function duplicate_flags (vocab, counts) {
  const total = u => counts?.get(u)?.total ?? 0
  const out = new Map()
  for (const group of sibling_groups(vocab)) {
    for (const a of group) {
      for (const b of group) {
        if (a.uuid === b.uuid || a.level !== b.level) continue
        const m = name_match(a.name, b) ?? (a.aliases ?? []).map(x => name_match(x, b)).find(Boolean)
        if (!m?.strong) continue
        if (total(a.uuid) > total(b.uuid)) continue
        const prev = out.get(a.uuid)
        if (!prev || total(b.uuid) > total(prev)) out.set(a.uuid, b.uuid)
      }
    }
  }
  return out
}

/** Where `query` matches a name, split for highlighting, or null. */
export function highlight (name, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return null
  const ix = name.toLowerCase().indexOf(q)
  if (ix < 0) return null
  return { pre: name.slice(0, ix), mid: name.slice(ix, ix + q.length), post: name.slice(ix + q.length) }
}

/** Does a node's name or one of its aliases contain `query`? */
export function node_matches (n, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return true
  const fq = fold_name(q)
  return [n.name, ...(n.aliases ?? [])].some(x =>
    x.toLowerCase().includes(q) || (fq && fold_name(x).includes(fq)))
}

/** The nodes at the top of the tree: every node with no parent,
 * Enterprises first, so a node orphaned by a mistake still shows. */
export function tree_roots (vocab) {
  return [...vocab.nodes.values()]
    .filter(n => !vocab.parents.get(n.uuid)?.length)
    .sort((a, b) => ISA95_LEVELS.indexOf(a.level) - ISA95_LEVELS.indexOf(b.level) || by_name(a, b))
}

/** The tree flattened to the rows on screen.
 * A node under two parents appears under each. Each row has a `key`
 * made of the UUIDs on its path, so the two appearances are told
 * apart. With a search, only matching nodes and the nodes above them
 * show, and every row with a match below it is open.
 * @arg opts.open A Set of row keys the user has opened.
 * @arg opts.query The search text.
 * @returns `[{ key, uuid, depth, parent, hasKids, expanded, also }]`,
 *   where `also` lists the names of the node's other parents.
 */
export function tree_rows (vocab, { open, query } = {}) {
  const searching = !!String(query ?? '').trim()
  const visible = new Map()
  const shows = (uuid, seen = new Set()) => {
    if (visible.has(uuid)) return visible.get(uuid)
    if (seen.has(uuid)) return false
    seen.add(uuid)
    const n = vocab.nodes.get(uuid)
    const v = !!n && (node_matches(n, query) || n.children.some(c => shows(c, seen)))
    visible.set(uuid, v)
    return v
  }

  const rows = []
  const walk = (uuid, depth, parent, path) => {
    const n = vocab.nodes.get(uuid)
    if (!n || path.includes(uuid)) return
    if (searching && !shows(uuid)) return
    const key = [...path, uuid].join('/')
    const kids = n.children
      .map(c => vocab.nodes.get(c)).filter(Boolean)
      .filter(c => !searching || shows(c.uuid))
      .sort(by_name)
    const expanded = kids.length > 0 && (searching || !!open?.has(key))
    const parents = vocab.parents.get(uuid) ?? []
    rows.push({
      key, uuid, depth, parent,
      hasKids:  kids.length > 0,
      expanded,
      also:     parents.filter(p => p !== parent).map(p => vocab.nodes.get(p)?.name).filter(Boolean),
    })
    if (expanded)
      for (const k of kids) walk(k.uuid, depth + 1, uuid, [...path, uuid])
  }
  for (const r of tree_roots(vocab)) walk(r.uuid, 0, null, [])
  return rows
}

/** Every row key in the tree that has children, for "Expand all". */
export function all_branch_keys (vocab) {
  const keys = new Set()
  const walk = (uuid, path) => {
    const n = vocab.nodes.get(uuid)
    if (!n || path.includes(uuid)) return
    const next = [...path, uuid]
    if (n.children.length) keys.add(next.join('/'))
    for (const c of n.children) walk(c, next)
  }
  for (const r of tree_roots(vocab)) walk(r.uuid, [])
  return keys
}

/** The nodes `uuid` can move under: every node one level up, except
 * any under the node itself. Current parents are marked. Sorted by
 * path. */
export function move_targets (vocab, uuid) {
  const n = vocab.nodes.get(uuid)
  const level = n && parent_level(n.level)
  if (!level) return []
  const below = subtree(vocab, uuid)
  const current = new Set(vocab.parents.get(uuid) ?? [])
  return [...vocab.nodes.values()]
    .filter(o => o.level === level && !below.has(o.uuid))
    .map(o => ({
      uuid:     o.uuid,
      name:     o.name,
      path:     node_path(vocab, o.uuid).slice(0, -1).join(' / '),
      current:  current.has(o.uuid),
    }))
    .sort((a, b) => (a.path + '/' + a.name).localeCompare(b.path + '/' + b.name))
}

/** Plan moving a node from one parent to another.
 * Only the link from `from` is replaced, so a node with two parents
 * keeps the other one. `from` may be null for a node with no parent.
 * @returns `{ steps }`, each `{ vocabulary: uuid, config }`, or `{ error }`.
 */
export function plan_move (vocab, uuid, from, to) {
  const n = vocab.nodes.get(uuid)
  const t = vocab.nodes.get(to)
  if (!n || !t) return { error: 'Both nodes must be in the vocabulary' }
  if (t.level !== parent_level(n.level))
    return { error: `${n.name} is ${level_with_article(n.level)}, so it can only go under ${level_with_article(parent_level(n.level) ?? 'nothing')}` }
  if (subtree(vocab, uuid).has(to))
    return { error: `${t.name} is under ${n.name}` }
  if (from === to) return { steps: [] }

  const steps = []
  if (!t.children.includes(uuid))
    steps.push({ vocabulary: to, config: { aliases: t.aliases, children: [...t.children, uuid] } })
  const f = from && vocab.nodes.get(from)
  if (f)
    steps.push({ vocabulary: from, config: { aliases: f.aliases, children: f.children.filter(c => c !== uuid) } })
  return { steps }
}

/** Apply vocabulary steps from `plan_move`, in order. */
export async function apply_vocabulary_steps (cdb, steps) {
  for (const s of steps)
    await cdb.put_config(UUIDs.App.ISA95Vocabulary, s.vocabulary, s.config)
}

/** Create a node and link it under its parent.
 * The new node's own entries go in before the link, so the tree never
 * shows a child with no name.
 * @arg opts.level The new node's level.
 * @arg opts.name Its name, already checked.
 * @arg opts.parent The parent's UUID, or null for an Enterprise.
 * @arg opts.class_uuid The ConfigDB class for the level.
 * @returns The new node's UUID.
 */
export async function create_node (cdb, vocab, { level, name, parent, class_uuid }) {
  if (parent) {
    const p = vocab.nodes.get(parent)
    if (!p) throw new Error('The parent is no longer in the vocabulary')
    if (child_level(p.level) !== level)
      throw new Error(`${level_with_article(level)} cannot go under ${level_with_article(p.level)}`)
  }
  const uuid = await cdb.create_object(class_uuid)
  await cdb.put_config(UUIDs.App.Info, uuid, { name: name.trim() })
  await cdb.put_config(UUIDs.App.ISA95Vocabulary, uuid, { aliases: [], children: [] })
  if (parent) {
    const p = vocab.nodes.get(parent)
    await cdb.put_config(UUIDs.App.ISA95Vocabulary, parent, {
      aliases: p.aliases, children: [...p.children, uuid],
    })
  }
  return uuid
}

/** Rename a node. Only its Info name changes. */
export async function rename_node (cdb, uuid, name) {
  await cdb.put_config(UUIDs.App.Info, uuid, { name: name.trim() })
}

/** Add an alias to a node, unless it is already its name or an alias. */
export async function add_alias (cdb, vocab, uuid, alias) {
  const n = vocab.nodes.get(uuid)
  const a = String(alias ?? '').trim()
  if (!n || !a) return false
  const fold = a.toLowerCase()
  if (n.name.trim().toLowerCase() === fold) return false
  if (n.aliases.some(x => x.trim().toLowerCase() === fold)) return false
  await cdb.put_config(UUIDs.App.ISA95Vocabulary, uuid, {
    aliases: [...n.aliases, a], children: n.children,
  })
  return true
}
