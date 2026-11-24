/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Find or create a metric in the origin map editor's model.
 *
 * This is the creation step `selectMetric` in OriginMapEditor.vue always
 * did, pulled out so the Addresses panel can fill a metric the operator
 * has not selected, or one with no origin map entry yet. It stays free of
 * Vue so it can be tested on plain objects.
 */

export const SPARKPLUG_METRIC_UUID = 'b16275f1-e443-4c41-a482-fcbdfbd20769'

const RESERVED = new Set(['Schema_UUID', 'Instance_UUID', 'patternProperties', '$meta', 'required'])

/* Read a value at a list of keys without creating anything. */
export function value_at (obj, path) {
  let cur = obj
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

/* Assign at a list of keys, creating plain objects on the way. The same
 * behaviour as the editor's `set`, which takes a dotted string. */
export function set_at (obj, path, value) {
  let cur = obj
  for (const key of path.slice(0, -1)) {
    if (!Object.prototype.hasOwnProperty.call(cur, key) || cur[key] === null
        || typeof cur[key] !== 'object')
      cur[key] = {}
    cur = cur[key]
  }
  cur[path.at(-1)] = value
}

/**
 * The schema chain for a metric path, in the shape SchemaGroup emits for
 * `selected`: the metric first, then each parent group up to the top.
 *
 * @param {object} schema The editor's dereferenced schema, with any
 *   `patternProperties` instances already made into `properties`.
 * @param {string[]} path The metric's keys, top first.
 * @returns {object[]|null} The chain, or null if the path is not a metric.
 */
export function schema_chain (schema, path) {
  const chain = []
  let node = schema
  for (let i = 0; i < path.length; i++) {
    const key = path[i]
    if (RESERVED.has(key)) return null
    const child = node?.properties?.[key]
    if (!child || typeof child !== 'object') return null
    const last = i === path.length - 1
    if (last) {
      if (!('allOf' in child)) return null
      chain.unshift({
        key,
        value: child,
        schemaUUID: child.allOf[0]?.properties?.Schema_UUID?.const,
      })
    }
    else {
      chain.unshift({ key, schemaUUID: child.properties?.Schema_UUID?.const })
    }
    node = child
  }
  return chain
}

/**
 * The value a new metric gets for one property: its default, or else the
 * first entry of its enum. Undefined when the schema gives neither.
 */
export function stamped_value (spec) {
  if (!spec || typeof spec !== 'object') return undefined
  if ('default' in spec) return spec.default
  if (Array.isArray(spec.enum)) return spec.enum[0]
  return undefined
}

/** The merged property schema of a metric node in the schema. */
export function metric_schema_of (node) {
  return { ...node.allOf[0]?.properties, ...node.allOf[1]?.properties }
}

/**
 * Find the metric at `chain`, or create it with its defaults and stamp
 * Schema_UUID and Instance_UUID up the chain.
 *
 * The returned `metric` is read back from the model, so it is the same
 * object the editor holds for that path. Callers must change it in place,
 * because the editor identifies metrics by object identity.
 *
 * @param {object} opts
 * @param {object} opts.model The origin map, changed in place.
 * @param {object[]} opts.chain From SchemaGroup or `schema_chain`.
 * @param {function} opts.new_uuid Mints an Instance_UUID.
 * @param {function} [opts.set] `(path_keys, value)` assignment, so the
 *   editor can use its own reactive setter.
 * @returns {{path: string[], metric: object, schema: object,
 *   created: boolean}|null} Null when the schema node is not a valid
 *   Factory+ metric.
 */
export function ensure_metric ({ model, chain, new_uuid, set }) {
  const assign = set ?? ((path, value) => set_at(model, path, value))
  const reversed = [...chain].reverse()
  const path = reversed.map(e => e.key)
  const node = chain[0].value
  const schema = metric_schema_of(node)

  const existing = value_at(model, path)
  if (existing !== null && existing !== undefined)
    return { path, metric: existing, schema, created: false }

  /* The template must be a Factory+ metric: an allOf holding the metric
   * schema reference and the overloads. */
  if (!('allOf' in node) || Object.keys(node).length !== 1 || node.allOf.length !== 2)
    return null

  const fresh = {}
  for (const [key, spec] of Object.entries(schema)) {
    const v = stamped_value(spec)
    if (v !== undefined) fresh[key] = v
  }
  assign(path, fresh)

  /* Every level with a Schema_UUID gets it stamped once, and an
   * Instance_UUID unless it is the metric itself. */
  reversed.forEach((e, ix) => {
    const here = path.slice(0, ix + 1)
    if (!e.schemaUUID || value_at(model, here)?.Schema_UUID) return
    assign([...here, 'Schema_UUID'], e.schemaUUID)
    if (e.schemaUUID !== SPARKPLUG_METRIC_UUID)
      assign([...here, 'Instance_UUID'], new_uuid())
  })

  return { path, metric: value_at(model, path), schema, created: true }
}

/**
 * Fill a metric from a discovered item, in place.
 *
 * The metric is found or created with `ensure_metric`, the values go
 * through the same allowlist and checks as a driver UI proposal, and they
 * land on the object the editor holds. An address replaces a static
 * value. The caller marks the editor dirty and re-renders, because a
 * metric that is not selected has no SparkplugMetric to emit `input`.
 *
 * @param {object} opts As `ensure_metric`, plus:
 * @param {object} opts.item A value item from the snapshot.
 * @param {function} opts.propose `(item, metric, {allowed_types,
 *   default_type})` giving the values, normally model.js
 *   `proposal_for_item`.
 * @param {function} opts.validate contract.js `validate_proposal`.
 * @param {function} opts.apply contract.js `apply_proposal`.
 * @returns {{path: string[], metric: object, errors: string[],
 *   created: boolean}|null}
 */
export function apply_item ({ item, propose, validate, apply, ...opts }) {
  const res = ensure_metric(opts)
  if (!res) return null
  const allowed_types = res.schema.Sparkplug_Type?.enum ?? []
  /* A new metric, or one `selectMetric` made earlier, holds the type this
   * stamped rather than one the operator chose. The proposal treats that
   * as unset, so the scanned type can replace it. */
  const default_type = stamped_value(res.schema.Sparkplug_Type) ?? null
  const metric = res.created ? { ...res.metric, Sparkplug_Type: '' } : res.metric
  const proposal = propose(item, metric, { allowed_types, default_type })
  const { values, errors } = validate(proposal, { allowed_types })
  apply(res.metric, values)
  if ('Value' in res.metric) delete res.metric.Value
  return { ...res, errors }
}
