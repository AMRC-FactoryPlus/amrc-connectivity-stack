/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The driver custom UI contract.
 *
 * A driver definition may carry its own interface for the per-metric
 * configuration region. The Manager renders that document in a sandboxed
 * iframe and talks to it over postMessage.
 *
 * This module is the contract itself: the message shapes, the validation,
 * and the allowlist of fields a driver UI is permitted to propose. It is
 * deliberately free of Vue and of the DOM so it can be tested directly.
 *
 * The one rule that matters: **the driver document is untrusted**. It is
 * third-party code running in the operator's browser. Everything it sends
 * back is treated as hostile input, validated here, and only then handed to
 * the Manager, which remains the only thing that writes to ConfigDB.
 */

/** Bump only for breaking changes to the message shapes below.
 *
 * A driver document declares the version it was written against. The
 * Manager refuses anything it does not recognise and falls back to the
 * standard fields, rather than guessing at a format it does not know. */
export const CONTRACT_VERSION = 1

/** Every contract version the Manager speaks.
 *
 * Version 2 adds Edge Scout: `init.scout`, `scout-changed`, and the
 * document messages `pick-address` and `scout-query`. It changes nothing
 * a version 1 document sees, and the host answers each document in the
 * version it declared. The shell page (public/driver-ui/host.html) stays
 * on version 1 for its own `host-ready`, `host-failed` and `document`
 * messages. */
export const CONTRACT_VERSIONS = [1, 2]

/** The latest version, which adds Edge Scout. */
export const SCOUT_VERSION = 2

/* Message types only a version 2 document may send. */
const V2_ONLY = new Set(['pick-address', 'scout-query'])

/** Discriminator on every message in both directions, so a driver UI can
 * safely share a window with other postMessage traffic. */
export const ENVELOPE = 'fpDriverUi'

/** Shell page the driver document is written into.
 *
 * Driver documents are not loaded with `srcdoc`, because a srcdoc frame
 * inherits the embedder's Content-Security-Policy and that would force the
 * whole console to permit inline script. Serving the frame from its own URL
 * lets nginx give it a separate policy: inline script allowed,
 * `default-src 'none'` so it can reach nothing. See .docker/nginx.conf. */
export const HOST_PAGE = '/driver-ui/host.html'

/** How long the whole handshake has to complete before we give up and fall
 * back. Covers shell load, document delivery, and the document announcing
 * itself. A document that loads but never speaks would otherwise leave the
 * operator looking at an empty panel forever. */
export const HANDSHAKE_TIMEOUT_MS = 5000

/** Fields a driver UI may propose, and how each is checked.
 *
 * This is an allowlist, not a denylist. A UI cannot introduce keys into the
 * metric model that are not named here, whatever it sends. */
export const PROPOSABLE = new Map([
  ['Address',             'string'],
  ['Path',                'string'],
  ['Sparkplug_Type',      'type'],
  ['Eng_Unit',            'string'],
  ['Eng_Low',             'number'],
  ['Eng_High',            'number'],
  ['Deadband',            'number'],
  ['Documentation',       'string'],
  ['Record_To_Historian', 'boolean'],
])

/** Palette handed to driver documents so one that wants to look native can.
 *
 * These are passed, not enforced. A document that ignores them will look
 * foreign, which is the driver author's problem and not something the
 * Manager should police. The values track the console's own Tailwind greys
 * rather than a CSS variable palette, because the console does not define
 * one (tailwind.config.js extends `colors` with nothing). */
export const THEME_TOKENS = {
  background:  '#f3f4f6',
  surface:     '#ffffff',
  text:        '#111827',
  textMuted:   '#6b7280',
  border:      '#d1d5db',
  accent:      '#1f2937',
  danger:      '#b91c1c',
  radius:      '0.5rem',
  fontFamily:  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize:    '14px',
}

/**
 * Extract the UI document from a driver definition.
 *
 * @param {object|null} driver_info The driver definition, i.e. the object
 *   the Manager already reads `presentation` from.
 * @returns {string|null} The HTML document, or null if this driver ships no
 *   UI or ships one written against a contract version we do not know.
 */
export function ui_document (driver_info) {
  const ui = driver_info?.ui
  if (!ui || typeof ui !== 'object') return null
  if (!CONTRACT_VERSIONS.includes(ui.version)) return null
  const doc = ui.document
  if (typeof doc !== 'string' || doc.trim() === '') return null
  return doc
}

/**
 * The contract version a driver's UI document was written against.
 *
 * @param {object|null} driver_info The driver definition.
 * @returns {number|null} 1 or 2, or null when `ui_document` is null.
 */
export function ui_version (driver_info) {
  return ui_document(driver_info) == null ? null : driver_info.ui.version
}

/**
 * The envelope version of a message, or null if it is not one of ours.
 *
 * @param {*} data The raw `event.data`.
 * @returns {number|null}
 */
export function message_version (data) {
  if (!data || typeof data !== 'object') return null
  const v = data[ENVELOPE]
  return CONTRACT_VERSIONS.includes(v) ? v : null
}

/** Placeholder substituted for any config value we refuse to hand over. */
export const REDACTED = '__redacted__'

/**
 * Strip secrets out of a connection config before it crosses into the
 * sandbox.
 *
 * A driver document is third-party code running in the operator's browser,
 * and connection configs routinely hold credentials: the Pathfindr driver's
 * own schema has a `clientSecret`, and the stock REST driver has a
 * `password`. Neither has any business inside a vendor's UI.
 *
 * Secrets are identified the same way the console already identifies them
 * for form rendering: the connection schema marks them `format: password`.
 * Anything so marked is replaced rather than removed, so a UI can still see
 * that the field is set without learning its value.
 *
 * @param {object} config The connection configuration.
 * @param {object} [schema] The driver's connection schema.
 * @returns {object} A copy safe to post into the frame.
 */
export function redact_config (config, schema) {
  const props = schema?.properties
  const out = { ...(config ?? {}) }

  if (!props) return out

  for (const [key, spec] of Object.entries(props)) {
    if (spec?.format !== 'password') continue
    if (!(key in out)) continue
    /* Preserve "is it set?" without leaking "what is it?". */
    out[key] = out[key] == null || out[key] === '' ? out[key] : REDACTED
  }

  return out
}

/**
 * Build the init message sent to a driver document once it loads.
 *
 * The document gets the connection config with secrets redacted, the metric
 * it is editing, and the constraints it must respect. It gets nothing else:
 * no session, no token, no way to reach the network on the Manager's behalf.
 *
 * @param {object} opts
 * @param {object} opts.config Driver connection configuration.
 * @param {object} [opts.config_schema] Driver connection schema, used to
 *   locate secrets. Omitting it redacts nothing, so pass it.
 * @param {object} opts.metric Current values of the metric being edited.
 * @param {string[]} opts.allowed_types Permitted Sparkplug type names.
 * @param {object} [opts.theme] Theme token overrides.
 * @returns {object} The message to post into the frame.
 */
export function build_init ({ config, config_schema, metric, allowed_types, theme, version, scout }) {
  const v = CONTRACT_VERSIONS.includes(version) ? version : CONTRACT_VERSION
  const msg = {
    [ENVELOPE]: v,
    type:       'init',
    config:     redact_config(config, config_schema),
    metric:     { ...(metric ?? {}) },
    constraints: {
      proposable:    [...PROPOSABLE.keys()],
      allowed_types: [...(allowed_types ?? [])],
    },
    theme: { ...THEME_TOKENS, ...(theme ?? {}) },
  }
  /* Version 1 documents never see the scout key. */
  if (v >= SCOUT_VERSION) msg.scout = scout_state(scout)
  return msg
}

/* The scout summary a document sees. Copied field by field so nothing
 * else on the object crosses into the sandbox. */
function scout_state (scout) {
  return {
    available: !!scout?.available,
    state:     typeof scout?.state === 'string' ? scout.state : null,
    finished:  typeof scout?.finished === 'string' ? scout.finished : null,
    items:     Number.isInteger(scout?.items) ? scout.items : 0,
  }
}

/**
 * Tell a version 2 document that a scan started, finished or failed.
 *
 * @param {object} scout The summary, as in `init.scout`.
 */
export function build_scout_changed (scout) {
  return { [ENVELOPE]: SCOUT_VERSION, type: 'scout-changed', scout: scout_state(scout) }
}

/**
 * Answer a `pick-address`. `item` is null when the operator closed the
 * picker, there is no snapshot, or a picker was already open.
 *
 * @param {object|null} item The item, already passed through `share_item`.
 */
export function build_picked (item) {
  return { [ENVELOPE]: SCOUT_VERSION, type: 'picked', item: item ?? null }
}

/**
 * Answer a `scout-query`.
 *
 * @param {object[]} items At most 500 items, already shared.
 */
export function build_scout_items (items) {
  return { [ENVELOPE]: SCOUT_VERSION, type: 'scout-items', items: [...(items ?? [])] }
}

/** The most items one `scout-query` returns. */
export const SCOUT_QUERY_MAX = 500

/**
 * Message handing the driver document to the shell page for writing.
 *
 * @param {string} document The driver's HTML document.
 * @returns {object} The message to post into the frame.
 */
export function build_document_message (document) {
  return {
    [ENVELOPE]: CONTRACT_VERSION,
    type:       'document',
    document,
  }
}

/**
 * Validate an inbound message from the frame.
 *
 * Callers must have already confirmed the message came from the frame they
 * own; this checks the payload itself. Returns null for anything that is
 * not a well-formed message of ours, including traffic from unrelated
 * libraries that happen to share the window.
 *
 * The exchange runs: shell says `host-ready`, we send the document, the
 * document says `ready`, we send `init`, and thereafter the document sends
 * `propose` and `resize` as the operator works.
 *
 * @param {*} data The raw `event.data`.
 * A version 2 document may also send `pick-address`, with an optional
 * `filter` of `prefix` and `kind`, and `scout-query`, with a `prefix` and
 * a `limit` cut to 500. A version 1 envelope carrying either is ignored.
 *
 * @returns {{type: string, values?: object, height?: number,
 *   filter?: object, prefix?: string, limit?: number}|null}
 */
export function parse_message (data) {
  const version = message_version(data)
  if (version == null) return null
  if (V2_ONLY.has(data.type) && version < SCOUT_VERSION) return null

  switch (data.type) {
    case 'host-ready':
      return { type: 'host-ready' }
    case 'host-failed':
      /* The shell could not write the driver's document. Fall back at once
       * rather than making the operator wait out the handshake timeout. */
      return {
        type:   'host-failed',
        reason: typeof data.reason === 'string' ? data.reason : 'unknown',
      }
    case 'ready':
      return { type: 'ready' }
    case 'propose':
      if (!data.values || typeof data.values !== 'object') return null
      if (Array.isArray(data.values)) return null
      return { type: 'propose', values: data.values }
    case 'resize': {
      const h = data.height
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return null
      /* Clamp rather than reject. A document asking for a silly height is
       * far more likely to be buggy than malicious, and refusing outright
       * would leave it unusable. */
      return { type: 'resize', height: Math.min(Math.round(h), 2000) }
    }
    case 'pick-address': {
      /* The filter is optional, and a bad one is dropped rather than
       * refused, so the operator still gets a picker. */
      const f = data.filter
      const filter = {}
      if (f && typeof f === 'object' && !Array.isArray(f)) {
        if (typeof f.prefix === 'string') filter.prefix = f.prefix.slice(0, 1024)
        if (f.kind === 'folder' || f.kind === 'value') filter.kind = f.kind
      }
      return { type: 'pick-address', filter }
    }
    case 'scout-query': {
      if (typeof data.prefix !== 'string') return null
      const n = data.limit
      const limit = typeof n === 'number' && Number.isFinite(n) && n > 0
        ? Math.min(Math.floor(n), SCOUT_QUERY_MAX)
        : SCOUT_QUERY_MAX
      return { type: 'scout-query', prefix: data.prefix.slice(0, 1024), limit }
    }
    default:
      return null
  }
}

/** Check one proposed value against its declared kind. */
function check_value (kind, value, allowed_types) {
  switch (kind) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'type':
      return typeof value === 'string' && allowed_types.includes(value)
    default:
      return false
  }
}

/**
 * Validate a proposal from a driver document against the metric schema.
 *
 * Unknown keys are dropped rather than rejected, so a UI written against a
 * later contract does not break wholesale on an older Manager. Known keys
 * carrying the wrong type are errors, because silently discarding them
 * would leave the operator looking at a field they believe they have set.
 *
 * `null` is accepted for any key and means "clear this field", which is how
 * the existing editor represents an empty value.
 *
 * @param {object} values The proposed values.
 * @param {object} opts
 * @param {string[]} opts.allowed_types Permitted Sparkplug type names.
 * @returns {{values: object, errors: string[], dropped: string[]}}
 */
export function validate_proposal (values, { allowed_types } = {}) {
  const types   = [...(allowed_types ?? [])]
  const out     = {}
  const errors  = []
  const dropped = []

  for (const [key, value] of Object.entries(values ?? {})) {
    const kind = PROPOSABLE.get(key)

    if (!kind) {
      dropped.push(key)
      continue
    }

    if (value === null) {
      out[key] = null
      continue
    }

    if (!check_value(kind, value, types)) {
      errors.push(
        kind === 'type'
          ? `${key} must be one of: ${types.join(', ')}`
          : `${key} must be a ${kind}`)
      continue
    }

    out[key] = value
  }

  return { values: out, errors, dropped }
}

/**
 * Apply a validated proposal onto a metric model, in place.
 *
 * Mutating rather than returning a copy is deliberate and load-bearing. The
 * origin map editor identifies a metric by object identity: SparkplugMetric
 * is handed a reference to the model inside the editor's own tree, and the
 * editor's `@input` handler ignores its argument entirely and merely marks
 * the form dirty. Replacing the reference therefore writes into a detached
 * object, the save reports success, and nothing changes.
 *
 * That is not a theoretical hazard. The first version of this returned a new
 * object, and every value a driver UI proposed was silently discarded.
 *
 * Keys proposed as null are removed, matching how the editor treats cleared
 * fields.
 *
 * @param {object} model The metric model, mutated.
 * @param {object} values Validated values from `validate_proposal`.
 * @returns {object} The same model, for convenience.
 */
export function apply_proposal (model, values) {
  if (model == null) return model
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === null)
      delete model[key]
    else
      model[key] = value
  }
  return model
}
