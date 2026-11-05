/*
 * ACS Admin
 * ISA-95 placements: reading, bulk import and vocabulary merges
 * Copyright 2026 University of Sheffield AMRC
 *
 * Each device's ISA-95 position is its placement: one vocabulary node,
 * stored in the ISA-95 Placement app. The levels above the node come
 * from the vocabulary. The origin map's ISA95_Hierarchy is not read.
 *
 * Everything here is pure, so it can be tested without a browser. The
 * two writers at the end take the ConfigDB client as an argument.
 */

import {
  ISA95_LEVELS, UUIDs, isa95_chain, isa95_resolve, isa95_subtree,
  isa95_value_problem, isa95_vocabulary, render_isa95,
} from '@amrc-factoryplus/service-client'

/** Index the ISA-95 store's nodes for the functions below. */
export function vocabulary_of (nodes) {
  return isa95_vocabulary(nodes ?? [])
}

/** The vocabulary nodes from a placement's Enterprise down to its
 * node, or [] when there is no placement or its chain is broken. */
export function placement_chain (vocab, placement) {
  if (!placement?.node) return []
  return isa95_chain(vocab, placement.node).chain ?? []
}

/** The level names of a placement, Enterprise first. */
export function placement_path (vocab, placement) {
  return placement_chain(vocab, placement).map(n => n.name)
}

/** Where a device stands: 'placed' when its placement renders, so the
 * device is on the UNS; 'unplaced' when it has none; 'broken' when its
 * placement does not render (with the reason). */
export function placement_state (vocab, placement, device) {
  if (!placement?.node) return { state: 'unplaced' }
  const r = render_isa95(placement, vocab, device ?? '00000000-0000-0000-0000-000000000000')
  if (r.error) return { state: 'broken', error: r.error }
  return { state: 'placed', path: r.segments }
}

/** Is the device on the UNS? */
export function on_uns (vocab, placement) {
  return placement_state(vocab, placement).state === 'placed'
}

/** What a placement state means for the device, as a sentence, or null
 * for a placed device. */
export function placement_explanation (state, error) {
  if (state === 'unplaced')
    return 'This device has no ISA-95 placement, so it is not on the UNS.'
  if (state !== 'broken') return null
  const why = String(error ?? '').trim()
  return 'The ISA-95 placement does not resolve, so this device is not on the UNS.'
    + (why ? ` ${why}${/[.!?]$/.test(why) ? '' : '.'}` : '')
}

const by_name = (a, b) => a.name.localeCompare(b.name)

/** The nodes a placement picker offers one level below `parent`, or
 * the Enterprises when `parent` is null. Only nodes a device can be
 * placed on are offered: a node whose chain is broken, or whose name
 * cannot go in a topic, is left out. Sorted by name. */
export function placement_options (vocab, parent) {
  let nodes
  if (parent == null) {
    nodes = [...vocab.nodes.values()].filter(n => n.level === ISA95_LEVELS[0])
  }
  else {
    const p = vocab.nodes.get(parent)
    if (!p) return []
    const level = ISA95_LEVELS[ISA95_LEVELS.indexOf(p.level) + 1]
    if (!level) return []
    nodes = p.children
      .map(c => vocab.nodes.get(c))
      .filter(n => n?.level === level)
  }
  return nodes.filter(n => on_uns(vocab, { node: n.uuid })).sort(by_name)
}

/** The nodes `node` can be merged into: the same level, not the node
 * itself and not under it. Sorted by name. */
export function merge_targets (vocab, node) {
  const n = vocab.nodes.get(node)
  if (!n) return []
  const under = isa95_subtree(vocab, node)
  return [...vocab.nodes.values()]
    .filter(o => o.level === n.level && !under.has(o.uuid))
    .sort(by_name)
}

export const PLACEMENT_CSV_COLUMNS = ['device_uuid', ...ISA95_LEVELS]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* Split one CSV line, honouring double quotes. */
function split_csv_line (line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    }
    else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

/** Parse a placement CSV.
 * The columns are `device_uuid, Enterprise, Site, Area, Work Center,
 * Work Unit`. A first line that starts with `device_uuid` is a header.
 * Blank lines are skipped. Trailing empty levels may be left out.
 * @returns `{ rows, errors }`: rows are `{ line, device, names }`.
 */
export function parse_placement_csv (text) {
  const rows = []
  const errors = []
  const lines = String(text ?? '').split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = i + 1
    if (raw.trim() === '') return
    const cells = split_csv_line(raw).map(c => c.trim())
    if (i === 0 && cells[0].toLowerCase() === 'device_uuid') return

    const [device, ...levels] = cells
    if (!UUID_RE.test(device)) {
      errors.push({ line, message: `"${device}" is not a device UUID` })
      return
    }
    if (levels.length > ISA95_LEVELS.length) {
      errors.push({ line, message: `more than ${ISA95_LEVELS.length} levels` })
      return
    }
    let gap = levels.findIndex(v => v === '')
    if (gap === -1) gap = levels.length
    if (levels.slice(gap).some(v => v !== '')) {
      errors.push({ line, message: `${ISA95_LEVELS[gap]} is empty but a lower level is not` })
      return
    }
    const names = levels.slice(0, gap)
    if (!names.length) {
      errors.push({ line, message: 'no Enterprise' })
      return
    }
    for (const [j, n] of names.entries()) {
      const problem = isa95_value_problem(n)
      if (problem) {
        errors.push({ line, message: `${ISA95_LEVELS[j]} "${n}" ${problem}` })
        return
      }
    }
    rows.push({ line, device: device.toLowerCase(), names })
  })
  return { rows, errors }
}

/** Plan a bulk import of placements.
 *
 * Each row's names must resolve, level by level, to an existing
 * vocabulary node with an unbroken chain; nothing is created. A device
 * that already has a placement is left alone unless `overwrite` is set.
 * A row that would not change anything is counted as unchanged, so the
 * import can be run again safely.
 *
 * @arg opts.rows From `parse_placement_csv`.
 * @arg opts.vocab From `vocabulary_of`.
 * @arg opts.devices A Map from device UUID to `{ name, placement }`.
 * @arg opts.overwrite Replace existing placements.
 * @returns `{ changes, unchanged, kept, errors }`. Each change is
 *   `{ line, device, name, from, to, placement }`, where `from` and `to`
 *   are level-name arrays (`from` is null for an unplaced device) and
 *   `placement` is the config to write.
 */
export function plan_placements ({ rows, vocab, devices, overwrite }) {
  const changes = []
  const kept = []
  const errors = []
  let unchanged = 0
  const seen = new Map()

  for (const { line, device, names } of rows) {
    const dev = devices.get(device)
    if (!dev) {
      errors.push({ line, message: `no device ${device}` })
      continue
    }
    if (seen.has(device)) {
      errors.push({ line, message: `device ${device} is also on line ${seen.get(device)}` })
      continue
    }
    seen.set(device, line)

    const matched = isa95_resolve(vocab, names)
    if (matched.length < names.length) {
      const missing = names[matched.length]
      errors.push({ line, message: `${ISA95_LEVELS[matched.length]} "${missing}" is not in the vocabulary${matched.length ? ' under ' + names[matched.length - 1] : ''}` })
      continue
    }
    const node = matched.at(-1)
    const { chain, error } = isa95_chain(vocab, node)
    if (error) {
      errors.push({ line, message: error })
      continue
    }

    const current = dev.placement
    if (current?.node === node) {
      unchanged++
      continue
    }
    const from = current?.node ? placement_path(vocab, current) : null
    if (current?.node && !overwrite) {
      kept.push({ line, device, name: dev.name, from })
      continue
    }
    changes.push({
      line, device,
      name:       dev.name,
      from,
      to:         chain.map(n => n.name),
      /* Keep the device's Instance_UUIDs. */
      placement:  { ...(current ?? {}), node },
    })
  }
  return { changes, unchanged, kept, errors }
}

/** Plan merging one vocabulary node into another of the same level.
 *
 * The duplicate's children move to the target, its name and aliases
 * become aliases of the target, every placement on it moves to the
 * target, and it is unlinked from its parents and deleted. Placements
 * below it are untouched: their nodes move with the children.
 *
 * @arg vocab From `vocabulary_of`.
 * @arg from The UUID of the duplicate node.
 * @arg into The UUID of the node to keep.
 * @arg placements A Map from device UUID to placement config.
 * @returns `{ steps }` in the order to apply them, or `{ error }`.
 *   Steps are `{ vocabulary: uuid, config }`, `{ placement: device,
 *   config }` and `{ delete: uuid }`.
 */
export function plan_merge (vocab, from, into, placements) {
  const a = vocab.nodes.get(from)
  const b = vocab.nodes.get(into)
  if (!a || !b) return { error: 'Both nodes must be in the vocabulary' }
  if (from === into) return { error: 'A node cannot be merged into itself' }
  if (a.level !== b.level)
    return { error: `${a.name} is a ${a.level} and ${b.name} is a ${b.level}` }
  if (isa95_subtree(vocab, from).has(into))
    return { error: `${b.name} is under ${a.name}` }

  const steps = []
  const aliases = [...b.aliases]
  for (const name of [a.name, ...a.aliases]) {
    const fold = name.trim().toLowerCase()
    if (fold === b.name.trim().toLowerCase()) continue
    if (aliases.some(x => x.trim().toLowerCase() === fold)) continue
    aliases.push(name)
  }
  const children = [...b.children]
  for (const c of a.children)
    if (!children.includes(c)) children.push(c)

  steps.push({ vocabulary: into, config: { aliases, children } })
  /* Now the children have the target as a parent too; take them off
   * the duplicate so each has one parent again. */
  steps.push({ vocabulary: from, config: { aliases: a.aliases, children: [] } })
  for (const p of vocab.parents.get(from) ?? []) {
    const parent = vocab.nodes.get(p)
    steps.push({ vocabulary: p, config: {
      aliases: parent.aliases,
      children: parent.children.filter(c => c !== from),
    } })
  }
  for (const [device, placement] of placements ?? []) {
    if (placement?.node === from)
      steps.push({ placement: device, config: { ...placement, node: into } })
  }
  steps.push({ delete: from })
  return { steps }
}

/** The devices placed at or under a node. */
export function devices_placed_under (vocab, placements, node) {
  const under = isa95_subtree(vocab, node)
  return [...(placements ?? [])]
    .filter(([, p]) => p?.node && under.has(p.node))
    .map(([d]) => d)
}

/** Write the changes of a bulk import, one at a time.
 * Only placement configs are written: the placement watcher updates
 * the Edge Agent configs. A failed write does not stop the rest.
 * @arg cdb The ConfigDB client.
 * @arg changes From `plan_placements`.
 * @arg progress Called with the number written so far.
 * @returns The changes that failed, each with the error `message`.
 */
export async function apply_placements (cdb, changes, progress) {
  const failed = []
  let done = 0
  for (const c of changes) {
    try {
      await cdb.put_config(UUIDs.App.ISA95Placement, c.device, c.placement)
    }
    catch (err) {
      failed.push({ ...c, message: err?.message })
    }
    progress?.(++done)
  }
  return failed
}

/** Apply the steps of a merge, in order, stopping at the first error.
 * A merge that stopped part way can be planned and applied again.
 * @arg cdb The ConfigDB client.
 * @arg steps From `plan_merge`.
 */
export async function apply_merge (cdb, steps) {
  for (const step of steps) {
    if (step.vocabulary)
      await cdb.put_config(UUIDs.App.ISA95Vocabulary, step.vocabulary, step.config)
    else if (step.placement)
      await cdb.put_config(UUIDs.App.ISA95Placement, step.placement, step.config)
    else if (step.delete)
      await cdb.delete_object(step.delete)
  }
}
