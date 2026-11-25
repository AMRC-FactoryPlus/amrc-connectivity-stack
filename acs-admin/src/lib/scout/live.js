/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Live values for the Addresses panel: which addresses to ask the Edge
 * Agent to read, the watch and unwatch requests, and what each row shows
 * from the values entry. Pure functions with no Vue or DOM, like
 * model.js.
 */

import { LIVE_MAX } from './constants.js'

/* ---------------------------------------------------------------------
 * JSONPath
 * ------------------------------------------------------------------- */

/**
 * Parse one of the JSONPath forms a scan writes for a JSON leaf: `$`
 * followed by `.key`, `['key']` and `[0]` steps, as in `$.a.b[0]` and
 * `$['odd key']`. Double quotes are accepted as well as single.
 *
 * @param {string} path
 * @returns {(string|number)[]|null} The steps, or null when the path is
 *   not in one of those forms.
 */
export function parse_path (path) {
  if (typeof path !== 'string' || path[0] !== '$') return null
  const steps = []
  let i = 1
  while (i < path.length) {
    const c = path[i]
    if (c === '.') {
      let j = i + 1
      while (j < path.length && path[j] !== '.' && path[j] !== '[') j++
      if (j === i + 1) return null
      steps.push(path.slice(i + 1, j))
      i = j
    }
    else if (c === '[') {
      const q = path[i + 1]
      if (q === "'" || q === '"') {
        let key = ''
        let j = i + 2
        for (; j < path.length && path[j] !== q; j++) {
          if (path[j] === '\\') j++
          if (j >= path.length) return null
          key += path[j]
        }
        if (path[j] !== q || path[j + 1] !== ']') return null
        steps.push(key)
        i = j + 2
      }
      else {
        const m = /^\[(\d+)\]/.exec(path.slice(i))
        if (!m) return null
        steps.push(Number(m[1]))
        i += m[0].length
      }
    }
    else return null
  }
  return steps
}

/**
 * Apply a scan's JSONPath to a parsed JSON value.
 *
 * @returns {{found: boolean, value?: *}}
 */
export function apply_path (data, path) {
  const steps = parse_path(path)
  if (!steps) return { found: false }
  let cur = data
  for (const step of steps) {
    if (typeof step === 'number') {
      if (!Array.isArray(cur) || step >= cur.length) return { found: false }
      cur = cur[step]
    }
    else {
      if (cur === null || typeof cur !== 'object' || Array.isArray(cur) || !Object.hasOwn(cur, step))
        return { found: false }
      cur = cur[step]
    }
  }
  return { found: true, value: cur }
}

/* ---------------------------------------------------------------------
 * Requests
 * ------------------------------------------------------------------- */

/**
 * The addresses to watch for the value items on screen: each address
 * once, because a JSON leaf shares its topic's address, and at most 40.
 *
 * @param {object[]} items Items in screen order.
 * @returns {string[]}
 */
export function watch_addresses (items) {
  const out = []
  const seen = new Set()
  for (const it of items ?? []) {
    if (out.length >= LIVE_MAX) break
    if (it?.kind !== 'value' || typeof it.address !== 'string' || it.address === '') continue
    if (it.address.length > 1024 || seen.has(it.address)) continue
    seen.add(it.address)
    out.push(it.address)
  }
  return out
}

/** The NCMD value that starts or renews a lease. */
export function watch_request ({ request, connection, lease, addresses }) {
  return { version: 1, op: 'watch', request, connection, lease, addresses }
}

/** The NCMD value that ends a lease. */
export function unwatch_request ({ request, connection, lease }) {
  return { version: 1, op: 'unwatch', request, connection, lease }
}

/* ---------------------------------------------------------------------
 * What a row shows
 * ------------------------------------------------------------------- */

const as_text = v => (typeof v === 'string' ? v : JSON.stringify(v))

/* An item's `path` is its driver's metric path. Only MQTT's JSON
 * leaves carry a JSONPath, which always starts with `$`. Other drivers
 * use the path for their own purposes (edge-test's is "0"), and their
 * read value is already the item's value. */
const is_json_path = path => typeof path === 'string' && path.startsWith('$')

/**
 * The live value for an item, from the values entry.
 *
 * @param {object} item A value item.
 * @param {object|null} entry The trusted values entry.
 * @returns {{text: string|null, error: string|null, read: string|null,
 *   type: string|null}|null} Null when the entry has nothing for the
 *   item's address, so the row keeps its value at scan.
 */
export function live_value (item, entry) {
  if (!item || typeof item.address !== 'string') return null
  const values = entry?.values
  if (!values || typeof values !== 'object' || !Object.hasOwn(values, item.address)) return null
  const v = values[item.address]
  if (!v || typeof v !== 'object') return null
  const out = {
    text: v.value == null ? null : String(v.value),
    error: v.error ? String(v.error) : null,
    read: typeof v.read === 'string' ? v.read : null,
    type: typeof v.type === 'string' ? v.type : null,
  }
  if (out.error || !is_json_path(item.path)) return out

  /* A JSON leaf: the driver sends the topic's whole payload, and the
   * panel picks the leaf out of it. */
  if (out.text == null) return { ...out, text: null, error: 'No message yet' }
  let data
  try {
    data = JSON.parse(out.text)
  }
  catch {
    return {
      ...out,
      text: null,
      error: out.text.length >= 1024
        ? 'The message is too long to read this field from.'
        : 'The latest message is not JSON.',
    }
  }
  const got = apply_path(data, item.path)
  if (!got.found) return { ...out, text: null, error: 'Not in the latest message' }
  return { ...out, text: as_text(got.value), type: null }
}

/**
 * How many of the watched addresses have a value, and how many the Edge
 * Agent left out, for the line beside the switch.
 */
export function live_counts (entry, addresses) {
  const values = entry?.values && typeof entry.values === 'object' ? entry.values : {}
  return {
    shown: (addresses ?? []).filter(a => Object.hasOwn(values, a)).length,
    dropped: Number.isInteger(entry?.dropped) && entry.dropped > 0 ? entry.dropped : 0,
  }
}
