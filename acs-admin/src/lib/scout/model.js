/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Edge Scout: the pure logic behind the Addresses panel.
 *
 * Nothing here touches Vue or the DOM, in the same way as
 * lib/driver-ui/contract.js, so unit tests run it as it is. It covers
 * searching a snapshot, the address normalisers, the re-scan diff, which
 * mapped metrics a scan cannot find, the panel's state, and bulk
 * matching. Reading and indexing a snapshot live in snapshot.js, which is
 * also the worker, and are re-exported here.
 *
 * Every string in an item comes from the device, so it is untrusted. The
 * panel shows it as text only, and this module never builds HTML from it.
 */

import { QUERY_LIMIT, SCOUT_METRIC, WAIT_MS, WILDCARD } from './constants.js'
import { build_index, identity, item_key } from './snapshot.js'
import { stamped_value } from './ensure-metric.js'

export {
  build_index,
  child_order,
  decode_snapshot,
  identity,
  item_key,
  parse_snapshot,
  validate_end,
  validate_header,
  validate_item,
} from './snapshot.js'

const is_obj = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/* ---------------------------------------------------------------------
 * Identity and normalisers
 * ------------------------------------------------------------------- */

/* An OPC UA element address: a node id followed by a numeric range. */
const ELEMENT_RE = /^(.*)\[[0-9:,]+\]$/

/**
 * The address normalisers, named by the DriverDef's `scout.address_form`.
 *
 * Each takes a metric's address and a function saying whether the
 * snapshot holds an address, and returns the address in the driver's
 * canonical form. They are built in, so no code ever comes from ConfigDB.
 */
export const NORMALISERS = {
  /* edge-opcua prints namespace 0 without `ns=0;`, and an index range
   * reads the whole node unless the scan listed that exact element. */
  opcua (address, has) {
    let a = address.trim()
    if (a.startsWith('ns=0;')) a = a.slice(5)
    if (has?.(a)) return a
    const m = ELEMENT_RE.exec(a)
    return m ? m[1] : a
  },
  mqtt: address => address,
  exact: address => address,
}

/** Normalise an address with the named form, or `exact` if unknown. */
export function normalise_address (form, address, has) {
  if (typeof address !== 'string') return address
  const fn = NORMALISERS[form] ?? NORMALISERS.exact
  return fn(address, has)
}

/** The binding key of an origin map metric, normalised. */
export function metric_key (metric, form, index) {
  if (!metric || typeof metric.Address !== 'string' || metric.Address === '') return null
  const has = index ? a => index.addresses.has(a) : null
  return identity(normalise_address(form, metric.Address, has), metric.Path || null)
}

/* ---------------------------------------------------------------------
 * Indexing, tree and search
 * ------------------------------------------------------------------- */

/** The ids of an item's ancestors, top first. */
export function ancestors (index, id) {
  const out = []
  const seen = new Set([id])
  let cur = index.by_id.get(id)?.parent
  while (cur != null && index.by_id.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    out.unshift(cur)
    cur = index.by_id.get(cur).parent
  }
  return out
}

/** The names of an item's ancestors, joined for display. */
export function ancestor_path (index, id) {
  return ancestors(index, id).map(a => index.by_id.get(a).name).join(' / ')
}

/**
 * Search the snapshot. Covers name, address, path, description and unit,
 * ignoring case.
 *
 * @returns {{matches: Set<string>, ancestors: Set<string>}}
 */
export function search (index, query) {
  const q = String(query ?? '').trim().toLowerCase()
  const matches = new Set()
  const anc = new Set()
  if (!q) return { matches, ancestors: anc }

  for (const item of index.items) {
    const hay = [item.name, item.address, item.path, item.description, item.unit]
    if (hay.some(s => typeof s === 'string' && s.toLowerCase().includes(q))) {
      matches.add(item.id)
      for (const a of ancestors(index, item.id)) anc.add(a)
    }
  }
  return { matches, ancestors: anc }
}

/**
 * Flatten the tree into the rows the virtual list shows.
 *
 * With `keep`, only items in it, or with a descendant in it, are shown,
 * and those ancestors are opened. Otherwise `expanded` says which items
 * are open.
 *
 * @param {object} index
 * @param {object} opts
 * @param {Set<string>} [opts.expanded] Open item ids.
 * @param {Set<string>} [opts.keep] Item ids to keep, for search and filters.
 * @returns {{id: string, depth: number, open: boolean, has_children: boolean}[]}
 */
export function visible_rows (index, { expanded = new Set(), keep = null } = {}) {
  const rows = []
  const anc = keep ? keep_ancestors(index, keep) : null
  /* `filtering` is true while the walk is on the path to kept items. Below
   * a kept item the operator has opened, every child shows. */
  const walk = (parent, depth, filtering, seen) => {
    for (const id of index.children.get(parent) ?? []) {
      if (seen.has(id)) continue
      const kept = !filtering || keep.has(id)
      const on_path = filtering && anc.has(id)
      if (!kept && !on_path) continue
      const has_children = (index.children.get(id)?.length ?? 0) > 0
      const open = has_children && (on_path || expanded.has(id))
      rows.push({ id, depth, open, has_children })
      if (open) {
        seen.add(id)
        walk(id, depth + 1, filtering && !(kept && expanded.has(id)), seen)
        seen.delete(id)
      }
    }
  }
  walk(null, 0, !!keep, new Set())
  return rows
}

function keep_ancestors (index, keep) {
  const out = new Set()
  for (const id of keep)
    for (const a of ancestors(index, id)) out.add(a)
  return out
}

/* ---------------------------------------------------------------------
 * Re-scan diff
 * ------------------------------------------------------------------- */

const scopes_key = list => JSON.stringify((list ?? [])
  .map(s => [s.id, [...(s.prefixes ?? [])].sort()])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))

/**
 * Whether two snapshots can say an address is gone.
 *
 * Both must be exhaustive and untruncated, with the same options, root and
 * excluded scopes. An MQTT scan is never exhaustive, so it never says gone.
 *
 * @param {object} cur Status entry `current`.
 * @param {object} prev Status entry `previous`.
 * @returns {{ok: boolean, reason: string|null}}
 */
export function comparable (cur, prev) {
  if (!cur || !prev) return { ok: false, reason: 'no-previous' }
  if (!cur.exhaustive || !prev.exhaustive) return { ok: false, reason: 'not-exhaustive' }
  if (cur.truncated || prev.truncated) return { ok: false, reason: 'truncated' }
  if (cur.options_hash !== prev.options_hash) return { ok: false, reason: 'options' }
  if ((cur.root ?? null) !== (prev.root ?? null)) return { ok: false, reason: 'root' }
  if (scopes_key(cur.excluded) !== scopes_key(prev.excluded)) return { ok: false, reason: 'excluded' }
  return { ok: true, reason: null }
}

const dims = item => JSON.stringify(item?.detail?.dims ?? null)

/* The items in a subtree, or every item with no scope. */
function in_scope (index, scope) {
  if (scope == null) return index.items
  if (!index.by_id.has(scope)) return []
  const out = []
  const walk = id => {
    out.push(index.by_id.get(id))
    for (const c of index.children.get(id) ?? []) walk(c)
  }
  walk(scope)
  return out
}

/**
 * Compare the current snapshot with the previous one.
 *
 * After a branch scan, pass that folder's id as `scope`, so only that
 * subtree is compared.
 *
 * @returns {{comparable: boolean, reason: string|null, added: Set<string>,
 *   changed: Map<string, string[]>, renamed: Set<string>, gone: object[],
 *   not_seen: object[]}}
 */
export function diff (cur_index, prev_index, { cur, prev, scope = null } = {}) {
  const cmp = comparable(cur, prev)
  const out = {
    comparable: cmp.ok,
    reason: cmp.reason,
    added: new Set(),
    changed: new Map(),
    renamed: new Set(),
    gone: [],
    not_seen: [],
  }
  if (!cur_index || !prev_index) return out

  const cur_items = in_scope(cur_index, scope)
  const prev_items = in_scope(prev_index, scope)
  const prev_keys = new Map(prev_items.map(i => [item_key(i), i]))
  const cur_keys = new Set()

  for (const item of cur_items) {
    const key = item_key(item)
    cur_keys.add(key)
    const old = prev_keys.get(key)
    if (!old) {
      out.added.add(item.id)
      continue
    }
    const fields = ['type', 'access', 'kind']
      .filter(f => (item[f] ?? null) !== (old[f] ?? null))
    if (dims(item) !== dims(old)) fields.push('dims')
    if (fields.length) out.changed.set(item.id, fields)
    if (item.name !== old.name) out.renamed.add(item.id)
  }

  for (const [key, item] of prev_keys) {
    if (cur_keys.has(key)) continue
    if (cmp.ok) out.gone.push(item)
    else out.not_seen.push(item)
  }
  return out
}

/* ---------------------------------------------------------------------
 * Mapped metrics
 * ------------------------------------------------------------------- */

const METRIC_KEYS = ['Address', 'Value', 'Sparkplug_Type', 'Path', 'Method']

/** Whether an origin map node is a metric rather than a group. */
export function is_metric_node (node) {
  return is_obj(node) && METRIC_KEYS.some(k => k in node)
}

/**
 * Every metric in an origin map that reads from an address.
 *
 * @param {object} model The origin map.
 * @returns {{path: string[], metric: object}[]}
 */
export function collect_metrics (model) {
  const out = []
  const walk = (node, path) => {
    if (!is_obj(node)) return
    if (is_metric_node(node)) {
      if (typeof node.Address === 'string' && node.Address !== '' && !('Value' in node))
        out.push({ path, metric: node })
      return
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'Schema_UUID' || k === 'Instance_UUID') continue
      walk(v, [...path, k])
    }
  }
  walk(model, [])
  return out
}

/** Strip a byte order suffix from a Sparkplug type name. */
export function base_type (type) {
  return typeof type === 'string' ? type.replace(/(BE|LE)$/, '') : type
}

/** Whether a metric's type disagrees with what the scan found. */
export function type_conflict (item, metric) {
  if (!item?.type || !metric?.Sparkplug_Type) return false
  return base_type(metric.Sparkplug_Type) !== item.type
}

/* Whether the snapshot can say where an unfound address would be. */
function placed (meta, address) {
  for (const scope of meta?.excluded ?? [])
    for (const p of scope.prefixes ?? [])
      if (address.startsWith(p)) return true
  return false
}

/**
 * What the current scan says about one mapped metric.
 *
 * - `found`: the scan lists it.
 * - `skipped`: it sits inside a part the scan left out on purpose.
 * - `missing`: a complete scan of the whole device did not find it.
 * - `not_seen`: the scan did not find it but cannot say it is missing.
 *
 * @param {object} metric An origin map metric.
 * @param {object} index The current snapshot index.
 * @param {object} meta Status entry `current`.
 * @param {string} form The DriverDef `scout.address_form`.
 * @returns {{status: string, item: object|null, conflict: boolean}|null}
 */
export function metric_status (metric, index, meta, form) {
  const key = metric_key(metric, form, index)
  if (!key || !index) return null
  const item = index.by_key.get(key)
  if (item) return { status: 'found', item, conflict: type_conflict(item, metric) }

  const address = key.slice(0, key.indexOf('\0'))
  if (placed(meta, address)) return { status: 'skipped', item: null, conflict: false }

  const complete = meta && meta.root == null && meta.exhaustive && !meta.truncated
  const vague = (meta?.excluded ?? []).some(s => !s.prefixes?.length) || index.incomplete
  return {
    status: complete && !vague ? 'missing' : 'not_seen',
    item: null,
    conflict: false,
  }
}

/**
 * The "Mapped but missing" list for one device.
 *
 * @returns {{missing: object[], not_seen: object[], conflicts: object[]}}
 */
export function mapped_but_missing (model, index, meta, form) {
  const out = { missing: [], not_seen: [], conflicts: [] }
  if (!index) return out
  for (const entry of collect_metrics(model)) {
    const st = metric_status(entry.metric, index, meta, form)
    if (!st) continue
    if (st.status === 'missing') out.missing.push(entry)
    if (st.status === 'not_seen') out.not_seen.push(entry)
    if (st.conflict) out.conflicts.push({ ...entry, item: st.item })
  }
  return out
}

/**
 * Which devices on the connection use each address.
 *
 * @param {{name: string, model: object}[]} devices Every device on the
 *   connection, with its origin map.
 * @param {string} form The address form.
 * @param {object} index The snapshot index, for the normaliser.
 * @returns {Map<string, {device: string, path: string[]}[]>} By item key.
 */
export function usage (devices, form, index) {
  const out = new Map()
  for (const dev of devices ?? []) {
    for (const { path, metric } of collect_metrics(dev.model)) {
      const key = metric_key(metric, form, index)
      if (!key) continue
      if (!out.has(key)) out.set(key, [])
      out.get(key).push({ device: dev.name, path })
    }
  }
  return out
}

/* ---------------------------------------------------------------------
 * Applying an item to a metric
 * ------------------------------------------------------------------- */

/**
 * The Sparkplug_Type value a metric schema accepts for an item's type.
 * The name itself, then the BE form, then the LE form.
 *
 * @param {string|null} type The item's plain type.
 * @param {string[]} allowed The metric schema's enum.
 * @returns {string|null}
 */
export function place_type (type, allowed) {
  if (!type) return null
  for (const t of [type, `${type}BE`, `${type}LE`])
    if (allowed?.includes(t)) return t
  return null
}

const empty = v => v == null || v === ''

/**
 * The values to propose for a metric when an operator uses an item.
 *
 * Address and Path always. Sparkplug_Type when the metric has none and the
 * schema allows the item's type. A metric with no address whose type is
 * the one the editor stamps on a new metric (`default_type`) counts as
 * having none, because the editor fills the type when it creates a
 * metric, before the operator has chosen one. Eng_Unit and Documentation
 * only when the metric has none, and the unit only when the vocabulary
 * knows it.
 *
 * @param {object} item A value item.
 * @param {object} metric The metric's current values.
 * @param {object} opts
 * @param {string[]} opts.allowed_types The schema's Sparkplug_Type enum.
 * @param {string|null} [opts.default_type] The type a new metric gets.
 * @param {function} [opts.resolve_unit] The unit vocabulary's resolver.
 * @returns {object} Values for contract.js `validate_proposal`.
 */
export function proposal_for_item (item, metric, { allowed_types = [], default_type = null, resolve_unit } = {}) {
  const out = { Address: item.address, Path: item.path ?? null }
  const type = place_type(item.type, allowed_types)
  const stamped = !empty(default_type) && metric?.Sparkplug_Type === default_type
    && empty(metric?.Address)
  if (type && (empty(metric?.Sparkplug_Type) || stamped)) out.Sparkplug_Type = type
  if (!empty(item.unit) && empty(metric?.Eng_Unit)
      && (!resolve_unit || resolve_unit(item.unit)))
    out.Eng_Unit = item.unit
  if (!empty(item.description) && empty(metric?.Documentation))
    out.Documentation = item.description
  return out
}

/* ---------------------------------------------------------------------
 * Bulk mapping
 * ------------------------------------------------------------------- */

/** Lower case letters and digits only. */
export const norm_name = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const RESERVED = new Set(['Schema_UUID', 'Instance_UUID', 'patternProperties', '$meta', 'required'])

const metric_props = node => ({
  ...node.allOf?.[0]?.properties,
  ...node.allOf?.[1]?.properties,
})

/**
 * Every metric the device schema defines, including instances already
 * made from `patternProperties`.
 *
 * @param {object} schema The editor's dereferenced schema.
 * @returns {{path: string[], name: string, parent: string|null,
 *   allowed_types: string[], default_type: string|null}[]}
 */
export function metric_slots (schema) {
  const out = []
  const walk = (node, path) => {
    for (const [key, child] of Object.entries(node?.properties ?? {})) {
      if (RESERVED.has(key) || !is_obj(child)) continue
      if ('allOf' in child) {
        out.push({
          path: [...path, key],
          name: key,
          parent: path.at(-1) ?? null,
          allowed_types: metric_props(child).Sparkplug_Type?.enum ?? [],
          default_type: stamped_value(metric_props(child).Sparkplug_Type) ?? null,
        })
      }
      else if ('properties' in child) walk(child, [...path, key])
    }
  }
  walk(schema, [])
  return out
}

/**
 * The `patternProperties` collections in the schema, for "Create n objects
 * named after the items".
 *
 * @returns {{path: string[], pattern: string, metrics: object[]}[]}
 */
export function collections (schema) {
  const out = []
  const walk = (node, path) => {
    for (const [key, child] of Object.entries(node?.properties ?? {})) {
      if (RESERVED.has(key) || !is_obj(child)) continue
      if (child.patternProperties) {
        const [pattern, inst] = Object.entries(child.patternProperties)[0] ?? []
        if (inst) out.push({ path: [...path, key], pattern, metrics: metric_slots(inst) })
      }
      if ('properties' in child) walk(child, [...path, key])
    }
  }
  walk(schema, [])
  return out
}

/**
 * Propose a metric for each item, by normalised name, tie-broken by the
 * parent's name and then by type.
 *
 * Each row's `status` is `matched`, `ambiguous`, `type_conflict` or
 * `no_metric`. A metric two items both match is ambiguous for both, so
 * Apply never writes one metric twice.
 *
 * @param {object[]} items The selected value items.
 * @param {object[]} slots From `metric_slots`.
 * @param {object} index The snapshot index, for parent names.
 * @returns {{item: object, status: string, slot: object|null,
 *   candidates: object[], type: string|null}[]}
 */
export function auto_match (items, slots, index) {
  const by_name = new Map()
  for (const s of slots) {
    const k = norm_name(s.name)
    if (!by_name.has(k)) by_name.set(k, [])
    by_name.get(k).push(s)
  }

  const rows = items.map(item => {
    let cands = by_name.get(norm_name(item.name)) ?? []
    const all = cands
    if (cands.length > 1) {
      const parent = norm_name(index?.by_id.get(item.parent)?.name)
      const same = cands.filter(s => parent && norm_name(s.parent) === parent)
      if (same.length) cands = same
    }
    if (cands.length > 1 && item.type) {
      const typed = cands.filter(s => place_type(item.type, s.allowed_types))
      if (typed.length) cands = typed
    }
    if (cands.length === 0) return { item, status: 'no_metric', slot: null, candidates: all, type: null }
    if (cands.length > 1) return { item, status: 'ambiguous', slot: null, candidates: cands, type: null }
    const slot = cands[0]
    const type = place_type(item.type, slot.allowed_types)
    const status = item.type && !type ? 'type_conflict' : 'matched'
    return { item, status, slot, candidates: all, type }
  })

  const claims = new Map()
  for (const r of rows)
    if (r.slot) claims.set(r.slot, (claims.get(r.slot) ?? 0) + 1)
  for (const r of rows) {
    if (r.slot && claims.get(r.slot) > 1) {
      r.candidates = [r.slot]
      r.status = 'ambiguous'
      r.slot = null
    }
  }
  return rows
}

/**
 * Turn an item into an object name that fits a `patternProperties`
 * pattern, or null if no tidy form fits.
 */
export function object_name (item, pattern) {
  const raw = String(item.name ?? '').trim()
  for (const name of [raw, raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')])
    if (name && !name_breaks_path(name) && pattern_re(pattern).test(name)) return name
  return null
}

const pattern_re = pattern => {
  try { return new RegExp(pattern) }
  catch { return /.*/ }
}

/* The CSV import splits its tag paths on "/" and the editor's setter
 * splits model paths on ".", and "<new>" is the export's placeholder for
 * a collection with no objects. A name with any of them would land
 * somewhere other than the object it names. */
const name_breaks_path = name =>
  name.includes('/') || name.includes('.') || name === '<new>'

/**
 * Why an object name typed in the bulk mapping dialog cannot be used, or
 * null if it can.
 *
 * The dialog creates new objects, so a name the collection already holds
 * is refused. Applying it would write the address over that object's
 * metric.
 *
 * @param {string[]} names Every name in the dialog.
 * @param {number} i The one to check.
 * @param {string} pattern The collection's `patternProperties` pattern.
 * @param {Set<string>|string[]} [existing] The names the collection
 *   already holds in the origin map.
 * @returns {string|null}
 */
export function object_name_problem (names, i, pattern, existing = []) {
  const name = names[i]
  if (!name) return 'Give this object a name.'
  if (name_breaks_path(name)) return 'Object names cannot contain "/" or ".".'
  if (!pattern_re(pattern ?? '.*').test(name)) return 'The schema does not allow this name.'
  if (names.indexOf(name) !== i) return 'Another object has this name.'
  const have = existing instanceof Set ? existing : new Set(existing ?? [])
  if (have.has(name)) return 'An object with this name already exists. Choose another name.'
  return null
}

/**
 * The object names a collection already holds in an origin map.
 *
 * @param {object} model The origin map.
 * @param {string[]} path The collection's path.
 * @returns {Set<string>}
 */
export function existing_objects (model, path) {
  let node = model
  for (const key of path) {
    if (!is_obj(node)) return new Set()
    node = node[key]
  }
  if (!is_obj(node)) return new Set()
  return new Set(Object.keys(node).filter(k => !RESERVED.has(k)))
}

/**
 * The CSV import rows that apply a set of choices, so bulk mapping goes
 * through `applyCsvToModel`, which already creates metrics and instances.
 *
 * An address replaces a static value, as it does for a single item, so a
 * metric with a `Value` gets `Value: ''`, which the import deletes.
 *
 * @param {{item: object, path: string[], metric: object|null,
 *   allowed_types: string[], default_type?: string|null}[]} choices
 * @returns {{tagPath: string, fields: object}[]}
 */
export function bulk_rows (choices, { resolve_unit } = {}) {
  return choices.map(({ item, path, metric, allowed_types, default_type = null }) => {
    const values = proposal_for_item(item, metric ?? {}, { allowed_types, default_type, resolve_unit })
    const fields = {}
    for (const [k, v] of Object.entries(values))
      fields[k] = v == null ? '' : String(v)
    if (is_obj(metric) && 'Value' in metric) fields.Value = ''
    return { tagPath: path.join('/'), fields }
  })
}

/* ---------------------------------------------------------------------
 * Panel state
 * ------------------------------------------------------------------- */

/**
 * Work out the panel's state. The first match wins, in the order of the
 * spec's states table.
 *
 * @param {object} s
 * @param {boolean} s.hidden DriverDef `scout: false`.
 * @param {boolean|null} s.online The agent is up, or null if unknown.
 * @param {boolean} s.birth_seen An NBIRTH has arrived since loading.
 * @param {boolean} s.has_metric That NBIRTH has Node Control/Scout.
 * @param {object|null} s.entry The status entry, trusted or not.
 * @param {string} s.node The node that hosts the connection. An entry
 *   whose `node` differs counts as no entry.
 * @param {boolean|null} s.deployed The connection is in the agent config.
 * @param {boolean|null} s.can_scout The operator holds the permission.
 * @param {object|null} s.pending This browser's latest request.
 * @param {number} s.now The time now, in ms.
 * @returns {{state: string, code?: string|null, message?: string|null}}
 */
export function panel_state (s) {
  if (s.hidden) return { state: 'hidden' }
  if (s.online === false) return { state: 'offline' }
  if (s.online && s.birth_seen && !s.has_metric) return { state: 'agent_old' }

  /* An entry written by an agent that does not host this connection is
   * ignored, so the operator can still scan and the hosting agent's
   * write replaces it. The caller shows `untrusted_text` as well. */
  const entry = s.entry && s.entry.node === s.node ? s.entry : null

  const last = entry?.last_request ?? null
  if (s.deployed === false) return { state: 'undeployed' }
  /* The agent says UNDEPLOYED for a connection it has not loaded and for
   * one that is not a split driver. When the agent config does list the
   * connection, its message says which. */
  if (last?.code === 'UNDEPLOYED')
    return { state: 'undeployed', message: s.deployed ? (last.message ?? null) : null }
  if (entry?.supported === false) return { state: 'unsupported' }
  if (entry?.supported === 'library' || last?.code === 'LIBRARY') return { state: 'driver_old' }
  if (last?.code === 'NODRIVER') return { state: 'driver_down', message: last.message ?? null }
  if (s.can_scout === false) return { state: 'no_permission' }

  const pending = s.pending
  const mine = pending && (entry?.request === pending.request || last?.request === pending.request)
  const active = entry?.state === 'queued' || entry?.state === 'running'

  if (!entry?.current && !entry?.scan && !pending) return { state: 'never' }

  /* Offline has already returned, so an unknown online state counts as
   * up here, and a request the agent never records still times out. */
  if (pending && !mine) {
    if (s.now - pending.sent >= WAIT_MS) return { state: 'waiting' }
    return { state: 'sending' }
  }
  if (pending && last?.request === pending.request && last.code)
    return { state: 'refused', code: last.code, message: last.message ?? null }

  if (active) return { state: entry.state }
  switch (entry?.state) {
    case 'done':
      return { state: entry.current?.items === 0 ? 'done_empty' : 'done' }
    case 'cancelled':
      return { state: 'cancelled', code: entry.code ?? null, message: entry.message ?? null }
    case 'failed':
      return {
        state: entry.code === 'INTERRUPTED' ? 'interrupted' : 'failed',
        code: entry.code ?? null,
        message: entry.message ?? null,
      }
  }
  return { state: entry?.current ? 'done' : 'never' }
}

/** Whether a state lets the operator press Scan. */
export function can_start (state) {
  return ['never', 'done', 'done_empty', 'failed', 'cancelled', 'interrupted',
    'refused', 'waiting', 'undeployed', 'driver_down', 'driver_old'].includes(state)
}

/** Whether a state shows Stop. */
export const can_stop = state => state === 'queued' || state === 'running'

/**
 * Plain words for an error code, as the panel shows them.
 *
 * @param {string} code A code from the spec's codes table.
 * @param {object} [ctx]
 * @param {string|null} [ctx.message] The message the code came with.
 * @returns {string}
 */
export function code_text (code, { message = null } = {}) {
  const with_msg = text => message ? `${text} ${trim_sentence(message)}` : text
  switch (code) {
    case 'REQUEST': return with_msg('The Edge Agent could not read the request.')
    case 'UNDEPLOYED': return 'The Edge Agent has not loaded this connection yet. Save and deploy it, then try again.'
    case 'NODRIVER': return with_msg("The driver isn't ready.")
    case 'LIBRARY': return 'This driver was built before scouting. Update the driver image.'
    case 'BUSY': return 'A scan is already running on this connection.'
    case 'LIMIT': return 'The Edge Agent is already running as many scans as it allows. Try again when one finishes.'
    case 'NOTRUNNING': return 'There was no scan to stop.'
    case 'UNSUPPORTED': return "This driver can't list its addresses."
    case 'OPTIONS': return with_msg('The driver did not accept the scan options.')
    case 'CONN': return with_msg('The driver is not connected to the device.')
    case 'AUTH': return with_msg('The device refused the driver.')
    case 'CANCELLED': return 'The scan was stopped.'
    case 'ERR': return with_msg('The driver failed during the scan.')
    case 'TIMEOUT': return 'The scan took too long, or the driver stopped answering.'
    case 'LOST': return 'Messages from the driver went missing, so the scan stopped.'
    case 'INTERRUPTED': return 'The Edge Agent or the driver restarted during the scan.'
    case 'STORE': return with_msg('The Edge Agent could not save the result.')
    case 'AGENT': return with_msg('The Edge Agent failed during the scan.')
    default: return with_msg('The scan failed.')
  }
}

function trim_sentence (s) {
  const t = String(s).trim().slice(0, 512)
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** Plain words for a truncation reason, with what to do about it. */
export function truncated_text (reason) {
  const cap = {
    items: 'the address limit',
    depth: 'the depth limit',
    seconds: 'the time limit',
    size: 'the size limit',
    partial_access: 'parts the driver was not allowed to read',
  }[reason] ?? 'a limit'
  return `The scan stopped at ${cap}, so it is not complete. Scan a branch to see more of it.`
}

/* ---------------------------------------------------------------------
 * Permissions and the driver custom UI
 * ------------------------------------------------------------------- */

/**
 * Whether an expanded ACL grants a permission on a target.
 *
 * @param {{permission: string, target: string}[]} acl
 */
export function has_permission (acl, perm, target) {
  return (acl ?? []).some(ace => ace.permission === perm
    && (ace.target === target || ace.target === WILDCARD))
}

/**
 * Whether a DriverDef is for a split driver, which is the only kind the
 * Edge Agent can ask to scan. Split drivers run from an image, or are
 * external drivers that connect to the agent themselves.
 */
export const is_split_driver = def =>
  is_obj(def) && (!!def.image || def.external === true)

/** Whether an NBIRTH's metrics include the scout command. */
export const birth_has_scout = metrics =>
  (metrics ?? []).some(m => m?.name === SCOUT_METRIC)

/** An item as a driver custom UI may see it. */
export function share_item (item, share_samples) {
  const out = { ...item }
  if (item.detail) out.detail = { ...item.detail }
  if (!share_samples) delete out.sample
  return out
}

/**
 * Items whose address starts with a prefix, for `scout-query`.
 *
 * @returns {object[]} At most 500, in snapshot order.
 */
export function query_items (index, { prefix = '', limit = QUERY_LIMIT, share_samples = false } = {}) {
  if (!index) return []
  const max = Math.max(0, Math.min(Number.isFinite(limit) ? Math.floor(limit) : QUERY_LIMIT, QUERY_LIMIT))
  const p = typeof prefix === 'string' ? prefix : ''
  const out = []
  for (const item of index.items) {
    if (out.length >= max) break
    if (typeof item.address === 'string' && item.address.startsWith(p))
      out.push(share_item(item, share_samples))
  }
  return out
}

/** The `scout` summary sent to a driver custom UI in init and scout-changed. */
export function scout_summary (entry, trusted = true) {
  const e = trusted ? entry : null
  return {
    available: !!e?.current,
    state: e?.state ?? null,
    finished: e?.current?.finished ?? null,
    items: e?.current?.items ?? 0,
  }
}

/* ---------------------------------------------------------------------
 * Requests
 * ------------------------------------------------------------------- */

/** The NCMD value that starts a scan. */
export function start_request ({ request, connection, root = null, folder_id = null, options = {} }) {
  return { version: 1, op: 'start', request, connection, root, folder_id, options }
}

/** The NCMD value that stops a scan. */
export function cancel_request ({ request, connection }) {
  return { version: 1, op: 'cancel', request, connection }
}

/** "9,812 addresses". */
export const count_text = n =>
  `${Number(n ?? 0).toLocaleString('en-GB')} address${n === 1 ? '' : 'es'}`

/** "24 Nov 10:42". */
export function when_text (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} `
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** "1 min 41 s" from milliseconds. */
export function elapsed_text (ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m} min ${s % 60} s` : `${s} s`
}
