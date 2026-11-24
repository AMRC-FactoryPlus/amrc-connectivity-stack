/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Edge Scout: reading and indexing a snapshot.
 *
 * load.js runs this file as the snapshot worker, from its source text,
 * and model.js re-exports it for the panel and the tests. It must import
 * nothing, because the worker runs it without bundling.
 *
 * Every string in an item comes from the device, so it is untrusted. Nothing
 * here builds HTML from it.
 */

/* The plain Sparkplug B type names an item may carry. */
export const ITEM_TYPES = [
  'Int8', 'Int16', 'Int32', 'Int64', 'UInt8', 'UInt16', 'UInt32', 'UInt64',
  'Float', 'Double', 'Boolean', 'String', 'Text', 'DateTime', 'UUID',
  'Bytes', 'File', 'DataSet', 'Template',
]

/* ---------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------- */

const ITEM_KEYS = new Set(ITEM_TYPES)
const ACCESS = new Set(['r', 'w', 'rw'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DETAIL_MAX = 2048

const is_obj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const str_max = (v, max, min = 0) =>
  typeof v === 'string' && v.length >= min && v.length <= max
const opt_str = (v, max, min = 0) => v == null || str_max(v, max, min)

/**
 * Check one item against lib/edge-scout-schemas/schemas/item.schema.json.
 *
 * The Admin UI cannot compile JSON Schemas at run time, because the
 * console's Content-Security-Policy forbids `eval`, so this mirrors the
 * schema by hand. The tests run it over the shared fixtures, so a schema
 * change that this misses fails there.
 *
 * @param {*} item A parsed snapshot line.
 * @returns {boolean}
 */
export function validate_item (item) {
  if (!is_obj(item)) return false
  if (!str_max(item.id, 512, 1)) return false
  if (!('parent' in item)) return false
  if (item.parent !== null && !str_max(item.parent, 512, 1)) return false
  if (!str_max(item.name, 256)) return false
  if (item.kind !== 'folder' && item.kind !== 'value') return false

  if ('address' in item && !opt_str(item.address, 1024, 1)) return false
  if (item.kind === 'value' && typeof item.address !== 'string') return false
  if ('path' in item && !opt_str(item.path, 1024)) return false
  if ('type' in item && item.type !== null && !ITEM_KEYS.has(item.type)) return false
  if ('access' in item && item.access !== null && !ACCESS.has(item.access)) return false
  if ('unit' in item && !opt_str(item.unit, 64)) return false
  if ('description' in item && !opt_str(item.description, 1024)) return false
  if ('sample' in item && !opt_str(item.sample, 256)) return false
  if ('more' in item && typeof item.more !== 'boolean') return false
  if ('root' in item && !opt_str(item.root, 1024)) return false
  if ('detail' in item && item.detail !== null) {
    if (!is_obj(item.detail)) return false
    if (JSON.stringify(item.detail).length > DETAIL_MAX) return false
  }
  return true
}

/** Check a snapshot header line. */
export function validate_header (line) {
  if (!is_obj(line)) return false
  if (line.version !== 1) return false
  for (const key of ['scan', 'connection'])
    if (typeof line[key] !== 'string' || !UUID_RE.test(line[key])) return false
  for (const key of ['driver', 'started', 'root', 'folder_id', 'options'])
    if (!(key in line)) return false
  if (!opt_str(line.driver, 128)) return false
  if (typeof line.started !== 'string') return false
  if (!opt_str(line.root, 1024)) return false
  if (!opt_str(line.folder_id, 1024, 1)) return false
  return is_obj(line.options)
}

/** Check a snapshot end line. */
export function validate_end (line) {
  if (!is_obj(line) || !is_obj(line.end)) return false
  const e = line.end
  for (const key of ['finished', 'exhaustive', 'truncated', 'reason', 'excluded',
    'rejected', 'items', 'branches'])
    if (!(key in e)) return false
  if (typeof e.exhaustive !== 'boolean' || typeof e.truncated !== 'boolean') return false
  if (e.truncated ? typeof e.reason !== 'string' : e.reason !== null) return false
  if (!Number.isInteger(e.items) || e.items < 0) return false
  if (!Number.isInteger(e.rejected) || e.rejected < 0) return false
  if (!Array.isArray(e.excluded) || !Array.isArray(e.branches)) return false
  return true
}

/* ---------------------------------------------------------------------
 * Reading a snapshot
 * ------------------------------------------------------------------- */

/**
 * Read a snapshot from its NDJSON lines.
 *
 * The first line is the header, the last the end line, and each line in
 * between one item. A snapshot with no end line, a first line that is not
 * a header, or an end count that does not match the item lines is
 * invalid, and the panel shows none of it. Items that fail validation or
 * repeat an id are dropped and counted, because one bad line should not
 * hide a scan of thousands.
 *
 * @param {string[]} lines The text lines. Blank lines are ignored.
 * @returns {{valid: boolean, problems: string[], header: object|null,
 *   end: object|null, items: object[], dropped: number}}
 */
export function parse_snapshot (lines) {
  const text = lines.filter(l => l.trim() !== '')
  const out = { valid: false, problems: [], header: null, end: null, items: [], dropped: 0 }

  const parse = l => { try { return JSON.parse(l) } catch { return undefined } }

  if (text.length < 2) {
    out.problems.push('The snapshot has no header and end line.')
    return out
  }

  const header = parse(text[0])
  if (!validate_header(header))
    out.problems.push('The first line is not a snapshot header.')
  const last = parse(text.at(-1))
  if (!validate_end(last))
    out.problems.push('The snapshot has no end line, so it is incomplete.')

  const body = text.slice(1, -1)
  if (validate_end(last) && last.end.items !== body.length)
    out.problems.push(`The end line counts ${last.end.items} addresses but the file holds ${body.length}.`)

  if (out.problems.length) return out

  const seen = new Set()
  for (const line of body) {
    const item = parse(line)
    if (!validate_item(item) || seen.has(item.id)) {
      out.dropped++
      continue
    }
    seen.add(item.id)
    out.items.push(item)
  }

  out.valid = true
  out.header = header
  out.end = last.end
  return out
}

/**
 * Gunzip and read a snapshot. Runs in the worker, and in the main thread
 * where workers are not available.
 *
 * @param {ArrayBuffer|Uint8Array} bytes The gzipped NDJSON.
 * @returns {Promise<object>} As `parse_snapshot`.
 */
export async function decode_snapshot (bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
  const lines = []
  let rest = ''
  const reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const parts = (rest + value).split('\n')
    rest = parts.pop()
    for (const p of parts) lines.push(p)
  }
  if (rest) lines.push(rest)
  return parse_snapshot(lines)
}

/* ---------------------------------------------------------------------
 * Identity and index
 * ------------------------------------------------------------------- */

/** The binding identity of an address and path. */
export function identity (address, path) {
  return `${address}\0${path ?? ''}`
}

/* Folders with no address match by id, kept apart from addresses. */
const folder_key = id => `\u0001${id}`

/** The diff and binding key of an item. */
export function item_key (item) {
  return typeof item.address === 'string'
    ? identity(item.address, item.path)
    : folder_key(item.id)
}

/**
 * Index a snapshot's items for the tree.
 *
 * @param {object[]} items Valid items in snapshot order.
 * @returns {object} The index.
 */
export function build_index (items) {
  const by_id = new Map()
  const by_key = new Map()
  const addresses = new Set()
  const children = new Map()
  let incomplete = false

  for (const item of items) by_id.set(item.id, item)

  for (const item of items) {
    const parent = item.parent != null && by_id.has(item.parent) ? item.parent : null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(item.id)
    const key = item_key(item)
    if (!by_key.has(key)) by_key.set(key, item)
    if (typeof item.address === 'string') addresses.add(item.address)
    if (item.kind === 'folder' && (item.more || item.detail?.denied)) incomplete = true
  }

  return { items, by_id, by_key, addresses, children, incomplete }
}
