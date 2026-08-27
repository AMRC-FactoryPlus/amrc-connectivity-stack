/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The driver custom UI contract.
 *
 * These tests exist mostly to pin down what happens when a driver document
 * misbehaves, because that document is third-party code and the Manager has
 * to survive it sending anything at all.
 */

import { describe, it, expect } from 'vitest'

import {
  CONTRACT_VERSION,
  ENVELOPE,
  PROPOSABLE,
  REDACTED,
  THEME_TOKENS,
  HOST_PAGE,
  ui_document,
  redact_config,
  build_document_message,
  build_init,
  parse_message,
  validate_proposal,
  apply_proposal,
} from '../src/lib/driver-ui/contract.js'

const TYPES = ['Int32', 'Float', 'Double', 'String', 'Boolean']

/* Modelled on the Pathfindr connection schema. */
const CONN_SCHEMA = {
  properties: {
    baseURL:      { type: 'string' },
    clientId:     { type: 'string' },
    clientSecret: { type: 'string', format: 'password' },
  },
}

describe('redact_config', () => {
  it('replaces password-format fields', () => {
    const out = redact_config(
      { baseURL: 'https://x.test', clientId: 'abc', clientSecret: 'hunter2' },
      CONN_SCHEMA)

    expect(out.baseURL).toEqual('https://x.test')
    expect(out.clientId).toEqual('abc')
    expect(out.clientSecret).toEqual(REDACTED)
  })

  it('never returns the secret under any key', () => {
    const out = redact_config({ clientSecret: 'hunter2' }, CONN_SCHEMA)
    expect(JSON.stringify(out)).not.toContain('hunter2')
  })

  it('leaves an unset secret alone so the UI can tell it is unset', () => {
    expect(redact_config({ clientSecret: '' }, CONN_SCHEMA).clientSecret).toEqual('')
    expect(redact_config({ clientSecret: null }, CONN_SCHEMA).clientSecret).toBeNull()
  })

  it('does not mutate the caller config', () => {
    const config = { clientSecret: 'hunter2' }
    redact_config(config, CONN_SCHEMA)
    expect(config.clientSecret).toEqual('hunter2')
  })

  it('tolerates a missing schema or config', () => {
    expect(redact_config({ a: 1 }, undefined)).toEqual({ a: 1 })
    expect(redact_config(undefined, CONN_SCHEMA)).toEqual({})
    expect(redact_config(null, null)).toEqual({})
  })
})

describe('ui_document', () => {
  it('returns the document for a matching contract version', () => {
    const doc = '<!doctype html><p>hi</p>'
    expect(ui_document({ ui: { version: CONTRACT_VERSION, document: doc } }))
      .toEqual(doc)
  })

  it('returns null when the driver ships no UI', () => {
    expect(ui_document({})).toBeNull()
    expect(ui_document(null)).toBeNull()
    expect(ui_document(undefined)).toBeNull()
  })

  it('refuses a contract version it does not know', () => {
    /* Falling back is the whole point: a UI written for a later Manager
     * must not be half-interpreted by an older one. */
    expect(ui_document({ ui: { version: 99, document: '<p>x</p>' } })).toBeNull()
    expect(ui_document({ ui: { document: '<p>x</p>' } })).toBeNull()
  })

  it('refuses an empty or non-string document', () => {
    expect(ui_document({ ui: { version: CONTRACT_VERSION, document: '' } })).toBeNull()
    expect(ui_document({ ui: { version: CONTRACT_VERSION, document: '   ' } })).toBeNull()
    expect(ui_document({ ui: { version: CONTRACT_VERSION, document: 42 } })).toBeNull()
  })

  it('is unaffected by a driver that only sets presentation', () => {
    expect(ui_document({ presentation: { address: { title: 'Thing' } } })).toBeNull()
  })
})

describe('build_init', () => {
  it('carries config, metric, constraints and theme', () => {
    const msg = build_init({
      config:        { baseURL: 'https://example.test' },
      metric:        { Address: 'assets', Sparkplug_Type: 'Float' },
      allowed_types: TYPES,
    })

    expect(msg[ENVELOPE]).toEqual(CONTRACT_VERSION)
    expect(msg.type).toEqual('init')
    expect(msg.config).toEqual({ baseURL: 'https://example.test' })
    expect(msg.metric.Address).toEqual('assets')
    expect(msg.constraints.allowed_types).toEqual(TYPES)
    expect(msg.constraints.proposable).toEqual([...PROPOSABLE.keys()])
    expect(msg.theme.background).toEqual(THEME_TOKENS.background)
  })

  it('copies the metric so a document cannot alias the live model', () => {
    const metric = { Address: 'assets' }
    const msg = build_init({ metric, allowed_types: TYPES })
    msg.metric.Address = 'tampered'
    expect(metric.Address).toEqual('assets')
  })

  it('tolerates being given nothing', () => {
    const msg = build_init({})
    expect(msg.config).toEqual({})
    expect(msg.metric).toEqual({})
    expect(msg.constraints.allowed_types).toEqual([])
  })

  it('allows theme overrides', () => {
    const msg = build_init({ theme: { background: '#000000' } })
    expect(msg.theme.background).toEqual('#000000')
    expect(msg.theme.border).toEqual(THEME_TOKENS.border)
  })

  it('never sends a credential into the sandbox', () => {
    /* The whole point of the sandbox is that the document is untrusted.
     * Handing it the client secret would defeat that entirely. */
    const msg = build_init({
      config:        { baseURL: 'https://x.test', clientSecret: 'hunter2' },
      config_schema: CONN_SCHEMA,
      allowed_types: TYPES,
    })

    expect(msg.config.clientSecret).toEqual(REDACTED)
    expect(JSON.stringify(msg)).not.toContain('hunter2')
  })
})

describe('build_document_message', () => {
  it('wraps the document in a versioned envelope', () => {
    const msg = build_document_message('<!doctype html><p>hi</p>')
    expect(msg[ENVELOPE]).toEqual(CONTRACT_VERSION)
    expect(msg.type).toEqual('document')
    expect(msg.document).toEqual('<!doctype html><p>hi</p>')
  })
})

describe('HOST_PAGE', () => {
  it('is a same-origin path, so frame-src self covers it', () => {
    /* The shell must be served by our own nginx for its separate CSP to
     * apply. A cross-origin URL here would silently break containment. */
    expect(HOST_PAGE.startsWith('/')).toBe(true)
    expect(HOST_PAGE).not.toContain('//')
  })
})

describe('parse_message', () => {
  const wrap = o => ({ [ENVELOPE]: CONTRACT_VERSION, ...o })

  it('accepts host-ready from the shell', () => {
    expect(parse_message(wrap({ type: 'host-ready' })))
      .toEqual({ type: 'host-ready' })
  })

  it('accepts ready', () => {
    expect(parse_message(wrap({ type: 'ready' }))).toEqual({ type: 'ready' })
  })

  it('accepts propose with an object of values', () => {
    const got = parse_message(wrap({ type: 'propose', values: { Address: 'a' } }))
    expect(got).toEqual({ type: 'propose', values: { Address: 'a' } })
  })

  it('ignores traffic that is not ours', () => {
    /* The console shares a window with other libraries; unrelated
     * postMessage traffic must not be mistaken for a proposal. */
    expect(parse_message({ type: 'propose', values: {} })).toBeNull()
    expect(parse_message({ someOtherLib: 1, type: 'ready' })).toBeNull()
    expect(parse_message('ready')).toBeNull()
    expect(parse_message(null)).toBeNull()
    expect(parse_message(undefined)).toBeNull()
  })

  it('ignores a mismatched contract version', () => {
    expect(parse_message({ [ENVELOPE]: 99, type: 'ready' })).toBeNull()
  })

  it('rejects propose without a values object', () => {
    expect(parse_message(wrap({ type: 'propose' }))).toBeNull()
    expect(parse_message(wrap({ type: 'propose', values: 'nope' }))).toBeNull()
    expect(parse_message(wrap({ type: 'propose', values: ['a'] }))).toBeNull()
  })

  it('rejects unknown message types', () => {
    expect(parse_message(wrap({ type: 'writeConfigDB' }))).toBeNull()
  })

  it('clamps an absurd resize rather than rejecting it', () => {
    expect(parse_message(wrap({ type: 'resize', height: 400 })))
      .toEqual({ type: 'resize', height: 400 })
    expect(parse_message(wrap({ type: 'resize', height: 99999 })))
      .toEqual({ type: 'resize', height: 2000 })
    expect(parse_message(wrap({ type: 'resize', height: 400.6 })))
      .toEqual({ type: 'resize', height: 401 })
  })

  it('rejects a nonsensical resize', () => {
    expect(parse_message(wrap({ type: 'resize', height: -1 }))).toBeNull()
    expect(parse_message(wrap({ type: 'resize', height: 'tall' }))).toBeNull()
    expect(parse_message(wrap({ type: 'resize', height: Infinity }))).toBeNull()
    expect(parse_message(wrap({ type: 'resize' }))).toBeNull()
  })
})

describe('validate_proposal', () => {
  it('passes well-formed values through', () => {
    const { values, errors } = validate_proposal({
      Address:             'assets',
      Path:                '$.enviro.latest_temperature',
      Sparkplug_Type:      'Float',
      Eng_Unit:            '°C',
      Eng_Low:             -20,
      Eng_High:            60,
      Record_To_Historian: true,
    }, { allowed_types: TYPES })

    expect(errors).toEqual([])
    expect(values.Address).toEqual('assets')
    expect(values.Eng_Low).toEqual(-20)
    expect(values.Record_To_Historian).toEqual(true)
  })

  it('drops keys outside the allowlist', () => {
    /* This is the load-bearing one. A driver UI must not be able to write
     * arbitrary keys into the metric model. */
    const { values, dropped } = validate_proposal({
      Address:  'assets',
      Value:    'static injection',
      __proto__: { polluted: true },
      Name:     'renamed',
    }, { allowed_types: TYPES })

    expect(values).toEqual({ Address: 'assets' })
    expect(dropped).toContain('Value')
    expect(dropped).toContain('Name')
  })

  it('does not pollute the prototype', () => {
    validate_proposal(JSON.parse('{"__proto__":{"polluted":true}}'),
      { allowed_types: TYPES })
    expect({}.polluted).toBeUndefined()
  })

  it('rejects a Sparkplug type outside the metric schema enum', () => {
    const { values, errors } = validate_proposal(
      { Sparkplug_Type: 'Quaternion' }, { allowed_types: TYPES })
    expect(values.Sparkplug_Type).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Sparkplug_Type')
  })

  it('rejects wrong primitive types', () => {
    const { values, errors } = validate_proposal({
      Address:             42,
      Eng_Low:             'cold',
      Record_To_Historian: 'yes',
    }, { allowed_types: TYPES })

    expect(values).toEqual({})
    expect(errors).toHaveLength(3)
  })

  it('rejects NaN and Infinity as numbers', () => {
    const { errors } = validate_proposal(
      { Eng_Low: NaN, Eng_High: Infinity }, { allowed_types: TYPES })
    expect(errors).toHaveLength(2)
  })

  it('accepts null as an instruction to clear a field', () => {
    const { values, errors } = validate_proposal(
      { Path: null }, { allowed_types: TYPES })
    expect(errors).toEqual([])
    expect(values).toEqual({ Path: null })
  })

  it('keeps good values when others fail', () => {
    /* Partial acceptance would leave the model half-updated with no way for
     * the operator to tell. The caller decides what to do; the validator's
     * job is to report both sides accurately. */
    const { values, errors } = validate_proposal(
      { Address: 'assets', Eng_Low: 'cold' }, { allowed_types: TYPES })
    expect(values).toEqual({ Address: 'assets' })
    expect(errors).toHaveLength(1)
  })

  it('tolerates empty and missing input', () => {
    expect(validate_proposal({}, { allowed_types: TYPES }).values).toEqual({})
    expect(validate_proposal(undefined, {}).values).toEqual({})
    expect(validate_proposal(null).values).toEqual({})
  })
})

describe('apply_proposal', () => {
  it('mutates the model in place rather than returning a copy', () => {
    /* Load-bearing. The origin map editor holds the metric by reference and
     * its @input handler ignores the emitted value, so only a mutation of
     * that same object survives a save. An earlier version returned a new
     * object and every proposed value was silently discarded. */
    const model = { Address: 'old', Sparkplug_Type: 'String' }
    const out = apply_proposal(model, { Address: 'new' })

    expect(model.Address).toEqual('new')
    expect(out).toBe(model)
  })

  it('keeps fields it was not asked to change', () => {
    const model = { Address: 'old', Sparkplug_Type: 'String' }
    apply_proposal(model, { Address: 'new' })
    expect(model.Sparkplug_Type).toEqual('String')
  })

  it('removes keys proposed as null', () => {
    const model = { Address: 'a', Path: '$.x' }
    apply_proposal(model, { Path: null })
    expect(model).toEqual({ Address: 'a' })
    expect('Path' in model).toBe(false)
  })

  it('tolerates empty input', () => {
    expect(apply_proposal(null, null)).toBeNull()
    const model = { a: 1 }
    expect(apply_proposal(model, {})).toBe(model)
    expect(model).toEqual({ a: 1 })
  })
})
