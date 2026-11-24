/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The driver custom UI contract.
 *
 * These tests exist mostly to pin down what happens when a driver document
 * misbehaves, because that document is third-party code and the Manager has
 * to survive it sending anything at all.
 */

import { describe, it, expect, vi } from 'vitest'

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
  CONTRACT_VERSIONS,
  SCOUT_VERSION,
  ui_version,
  message_version,
  build_scout_changed,
  build_picked,
  build_scout_items,
} from '../src/lib/driver-ui/contract.js'
import { create_host } from '../src/lib/driver-ui/host.js'
import { build_index } from '../src/lib/scout/model.js'

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

/* ---- Contract version 2: Edge Scout ---- */

describe('contract version 2', () => {
  const v2 = o => ({ [ENVELOPE]: 2, ...o })
  const v1 = o => ({ [ENVELOPE]: 1, ...o })

  it('accepts version 1 and 2 documents and reports the version', () => {
    expect(CONTRACT_VERSIONS).toEqual([1, 2])
    expect(ui_document({ ui: { version: 2, document: '<p>x</p>' } })).toEqual('<p>x</p>')
    expect(ui_version({ ui: { version: 2, document: '<p>x</p>' } })).toEqual(2)
    expect(ui_version({ ui: { version: 1, document: '<p>x</p>' } })).toEqual(1)
    expect(ui_version({ ui: { version: 3, document: '<p>x</p>' } })).toBeNull()
    expect(message_version(v2({ type: 'ready' }))).toEqual(2)
    expect(message_version({ [ENVELOPE]: 3 })).toBeNull()
  })

  it('parses pick-address with an optional, cleaned filter', () => {
    expect(parse_message(v2({ type: 'pick-address' }))).toEqual({ type: 'pick-address', filter: {} })
    expect(parse_message(v2({ type: 'pick-address', filter: { prefix: 'ns=2;', kind: 'value', x: 1 } })))
      .toEqual({ type: 'pick-address', filter: { prefix: 'ns=2;', kind: 'value' } })
    expect(parse_message(v2({ type: 'pick-address', filter: { kind: 'evil' } })))
      .toEqual({ type: 'pick-address', filter: {} })
  })

  it('cuts scout-query limits to 500 and needs a prefix', () => {
    expect(parse_message(v2({ type: 'scout-query', prefix: 'a', limit: 10 })))
      .toEqual({ type: 'scout-query', prefix: 'a', limit: 10 })
    expect(parse_message(v2({ type: 'scout-query', prefix: 'a', limit: 100000 })).limit).toEqual(500)
    expect(parse_message(v2({ type: 'scout-query', prefix: 'a', limit: -1 })).limit).toEqual(500)
    expect(parse_message(v2({ type: 'scout-query', prefix: 'a' })).limit).toEqual(500)
    expect(parse_message(v2({ type: 'scout-query' }))).toBeNull()
  })

  it('ignores version 2 messages in a version 1 envelope', () => {
    expect(parse_message(v1({ type: 'pick-address' }))).toBeNull()
    expect(parse_message(v1({ type: 'scout-query', prefix: '' }))).toBeNull()
  })

  it('adds scout to init only for version 2', () => {
    const scout = { available: true, state: 'done', finished: 't', items: 4, secret: 'no' }
    expect(build_init({ scout })).not.toHaveProperty('scout')
    const msg = build_init({ version: 2, scout })
    expect(msg[ENVELOPE]).toEqual(2)
    expect(msg.scout).toEqual({ available: true, state: 'done', finished: 't', items: 4 })
    expect(build_init({ version: 2 }).scout).toEqual({ available: false, state: null, finished: null, items: 0 })
  })

  it('builds the version 2 host messages', () => {
    expect(build_scout_changed({ available: true, state: 'running', finished: null, items: 0 }))
      .toEqual({ [ENVELOPE]: SCOUT_VERSION, type: 'scout-changed',
        scout: { available: true, state: 'running', finished: null, items: 0 } })
    expect(build_picked(null)).toEqual({ [ENVELOPE]: 2, type: 'picked', item: null })
    expect(build_scout_items([{ id: 'a' }]).items).toEqual([{ id: 'a' }])
  })
})

describe('the host controller', () => {
  const items = [
    { id: 'L', parent: null, name: 'Line', kind: 'folder' },
    { id: 'L/a', parent: 'L', name: 'a', kind: 'value', address: 'ns=2;s=a', path: null, sample: '42' },
    { id: 'L/b', parent: 'L', name: 'b', kind: 'value', address: 'ns=2;s=b', path: null, sample: '7' },
  ]
  const index = build_index(items)

  function host ({ version = 2, share_samples = false, pick, has_index = true } = {}) {
    const sent = []
    const on = { ready: vi.fn(), failed: vi.fn(), resize: vi.fn(), propose: vi.fn(), problems: vi.fn() }
    const h = create_host({
      post: m => sent.push(m),
      document: '<p>doc</p>',
      version,
      share_samples,
      init_values: () => ({ config: {}, metric: { Address: 'x' }, allowed_types: ['Double'] }),
      scout: {
        summary: () => ({ available: true, state: 'done', finished: 't', items: 3 }),
        index: () => (has_index ? index : null),
        pick: pick ?? (async () => items[1]),
      },
      on,
    })
    return { h, sent, on }
  }
  const msg = (v, o) => ({ [ENVELOPE]: v, ...o })

  it('answers the shell in version 1 and the document in its own version', () => {
    const { h, sent, on } = host()
    h.handle(msg(1, { type: 'host-ready' }))
    expect(sent[0]).toMatchObject({ [ENVELOPE]: 1, type: 'document' })
    h.handle(msg(2, { type: 'ready' }))
    expect(on.ready).toHaveBeenCalled()
    expect(sent[1]).toMatchObject({ [ENVELOPE]: 2, type: 'init', scout: { items: 3 } })
  })

  it('ignores a document speaking a version it did not declare', () => {
    const { h, sent } = host({ version: 1 })
    h.handle(msg(2, { type: 'ready' }))
    h.handle(msg(2, { type: 'pick-address' }))
    expect(sent).toEqual([])
    h.handle(msg(1, { type: 'ready' }))
    expect(sent[0]).toMatchObject({ [ENVELOPE]: 1, type: 'init' })
    expect(sent[0]).not.toHaveProperty('scout')
  })

  it('answers pick-address with the item, without its sample', async () => {
    const { h, sent } = host()
    h.handle(msg(2, { type: 'pick-address' }))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ type: 'picked', item: { id: 'L/a', address: 'ns=2;s=a' } })
    expect(sent[0].item).not.toHaveProperty('sample')
  })

  it('shares samples when the DriverDef allows it', async () => {
    const { h, sent } = host({ share_samples: true })
    h.handle(msg(2, { type: 'pick-address' }))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].item.sample).toEqual('42')
  })

  it('answers a second pick-address at once with null', async () => {
    let release
    const { h, sent } = host({ pick: () => new Promise(r => { release = r }) })
    h.handle(msg(2, { type: 'pick-address' }))
    h.handle(msg(2, { type: 'pick-address' }))
    expect(sent).toEqual([{ [ENVELOPE]: 2, type: 'picked', item: null }])
    release(items[2])
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1].item.id).toEqual('L/b')
  })

  it('answers null with no snapshot or when the operator closes the picker', async () => {
    const none = host({ has_index: false })
    none.h.handle(msg(2, { type: 'pick-address' }))
    expect(none.sent).toEqual([{ [ENVELOPE]: 2, type: 'picked', item: null }])

    const closed = host({ pick: async () => null })
    closed.h.handle(msg(2, { type: 'pick-address' }))
    await vi.waitFor(() => expect(closed.sent).toHaveLength(1))
    expect(closed.sent[0].item).toBeNull()
  })

  it('answers scout-query in snapshot order with the sample rule', () => {
    const { h, sent } = host()
    h.handle(msg(2, { type: 'scout-query', prefix: 'ns=2;s=', limit: 1 }))
    expect(sent[0].type).toEqual('scout-items')
    expect(sent[0].items.map(i => i.id)).toEqual(['L/a'])
    expect(sent[0].items[0]).not.toHaveProperty('sample')
    h.handle(msg(2, { type: 'scout-query', prefix: 'nope' }))
    expect(sent[1].items).toEqual([])
  })

  it('answers scout-query with nothing when there is no snapshot', () => {
    const { h, sent } = host({ has_index: false })
    h.handle(msg(2, { type: 'scout-query', prefix: '' }))
    expect(sent[0].items).toEqual([])
  })

  it('sends scout-changed only to version 2 documents', () => {
    const two = host()
    two.h.scout_changed({ available: false, state: 'running', finished: null, items: 0 })
    expect(two.sent[0]).toMatchObject({ type: 'scout-changed', scout: { state: 'running' } })
    const one = host({ version: 1 })
    one.h.scout_changed({ available: false, state: 'running' })
    expect(one.sent).toEqual([])
  })

  it('gives a document no way to start or stop a scan', () => {
    const start = vi.fn()
    const cancel = vi.fn()
    const sent = []
    const h = create_host({
      post: m => sent.push(m),
      document: '<p>doc</p>',
      version: 2,
      init_values: () => ({ config: {}, metric: {}, allowed_types: [] }),
      /* Even if the editor handed over more than it should, the
       * controller only ever calls summary, index and pick. */
      scout: {
        summary: () => ({ available: false, state: null, finished: null, items: 0 }),
        index: () => null,
        pick: async () => null,
        start,
        cancel,
      },
      on: {},
    })
    for (const type of ['scan', 'start', 'scout', 'scout-start', 'scout-cancel', 'cancel', 'rescan'])
      for (const v of [1, 2]) {
        const m = msg(v, { type, connection: 'c', options: {} })
        expect(parse_message(m)).toBeNull()
        h.handle(m)
      }
    expect(start).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('ignores scout messages that come before the document is ready', () => {
    const { h, sent } = host()
    h.handle(msg(2, { type: 'scout-changed', scout: { available: true } }))
    h.handle(msg(2, { type: 'picked', item: { id: 'forged' } }))
    h.handle(msg(2, { type: 'scout-items', items: [] }))
    expect(sent).toEqual([])
  })

  it('validates proposals as before', () => {
    const { h, on } = host()
    h.handle(msg(2, { type: 'propose', values: { Address: 'a', Sparkplug_Type: 'Nope', Evil: 1 } }))
    expect(on.propose).toHaveBeenCalledWith({ Address: 'a' })
    expect(on.problems.mock.calls[0][0][0]).toMatch(/Sparkplug_Type/)
  })
})
