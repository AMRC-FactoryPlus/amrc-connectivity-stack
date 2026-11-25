// @vitest-environment jsdom
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The Addresses panel, mounted in jsdom with a fake scout, for each
 * state. This checks the components render, wire their events and keep
 * device strings as text. The state logic itself is tested in
 * scout-use.test.js and scout-model.test.js.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createApp, nextTick, reactive, ref, computed } from 'vue'

import ScoutPanel from '../src/components/EdgeManager/Devices/OriginMapEditor/Scout/ScoutPanel.vue'
import ScoutMapDialog from '../src/components/EdgeManager/Devices/OriginMapEditor/Scout/ScoutMapDialog.vue'
import ScoutChangeBar from '../src/components/EdgeManager/Devices/OriginMapEditor/Scout/ScoutChangeBar.vue'
import { build_index, diff } from '../src/lib/scout/model.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe () {} disconnect () {} }
})

const ITEMS = [
  { id: 'L', parent: null, name: 'Line', kind: 'folder' },
  { id: 'L/speed', parent: 'L', name: 'Speed', kind: 'value', address: 'ns=2;s=Speed', path: null, type: 'Double', access: 'r' },
  { id: 'L/evil', parent: 'L', name: '<img src=x onerror="window.pwned=1">', kind: 'value', address: 'ns=2;s=Evil', path: null },
]

function fake (state, extra = {}, { items = ITEMS, entry = undefined } = {}) {
  const index = build_index(items)
  const calls = []
  const status = ref({
    version: 1, node: 'n', supported: true, scan: 's', state: 'done',
    started: '2026-11-24T10:41:00Z',
    progress: { visited: 10, found: 3420 },
    current: { file: 'f', items: 3, finished: '2026-11-24T10:42:13Z', exhaustive: true, truncated: false,
      root: null, excluded: [], options_hash: 'sha256:a' },
    ...extra,
  })
  const raw = ref(entry === undefined ? status.value : entry)
  return {
    calls,
    scout: {
      state: computed(() => ({ state, code: state === 'refused' ? 'BUSY' : null })),
      status,
      entry: raw,
      trusted: computed(() => !!raw.value && raw.value.node === 'n'),
      current_index: ref(index),
      changes: ref(null),
      loading: reactive({ current: false }),
      load_error: ref(null),
      send_error: ref(null),
      can_scout: ref(state !== 'no_permission'),
      tick: ref(Date.parse('2026-11-24T10:42:00Z')),
      snapshots: reactive({ current: { header: { options: {} } } }),
      start: o => calls.push(['start', o]),
      cancel: () => calls.push(['cancel']),
      scan_branch: i => calls.push(['branch', i.id]),
      forget: () => calls.push(['forget']),
    },
  }
}

let app = null
let el = null
afterEach(() => { app?.unmount(); el?.remove(); app = el = null })

async function mount (component, props) {
  el = document.createElement('div')
  el.style.height = '600px'
  document.body.appendChild(el)
  const events = []
  app = createApp(component, {
    ...props,
    onUse: i => events.push(['use', i.id]),
    onMap: items => events.push(['map', items.map(i => i.id)]),
    onApply: c => events.push(['apply', c]),
  })
  app.mount(el)
  await nextTick()
  return { el, events }
}

const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))

describe('ScoutPanel', () => {
  it('renders a done scan as text, with Re-scan', async () => {
    const { scout, calls } = fake('done')
    const { el } = await mount(ScoutPanel, { scout, driver: { scout: { address_form: 'opcua' } } })
    expect(el.textContent).toContain('3 addresses, scanned')
    expect(el.textContent).toContain('Line')
    button(el, 'Re-scan').click()
    expect(calls[0][0]).toBe('start')
  })

  it('keeps hostile item names as text', async () => {
    const { scout } = fake('done')
    const { el } = await mount(ScoutPanel, { scout })
    /* Open the folder so the hostile row renders. */
    el.querySelector('[role="treeitem"] button').click()
    await nextTick()
    expect(el.textContent).toContain('<img src=x')
    expect(el.querySelector('img')).toBeNull()
    expect(window.pwned).toBeUndefined()
  })

  it('shows the running count and Stop', async () => {
    const { scout, calls } = fake('running')
    const { el } = await mount(ScoutPanel, { scout })
    expect(el.textContent).toContain('Found 3,420 addresses, 1 min 0 s.')
    button(el, 'Stop').click()
    expect(calls).toEqual([['cancel']])
  })

  it('disables Scan without the permission', async () => {
    const { scout } = fake('no_permission')
    const { el } = await mount(ScoutPanel, { scout })
    expect(el.textContent).toContain('Scan device addresses permission')
    expect(button(el, 'Re-scan').disabled).toBe(true)
  })

  it('offers to follow a running scan after BUSY', async () => {
    const { scout, calls } = fake('refused')
    const { el } = await mount(ScoutPanel, { scout })
    button(el, 'Follow the running scan').click()
    expect(calls).toEqual([['forget']])
  })

  it('uses an item for the selected metric with Enter', async () => {
    const { scout } = fake('done')
    const metric = { Address: 'ns=2;s=Speed' }
    const { el, events } = await mount(ScoutPanel, {
      scout, selectedMetric: { path: ['Speed'], model: metric },
    })
    await nextTick()
    /* The reverse view opened the folder and focused the metric's item. */
    const tree = el.querySelector('[role="tree"]')
    expect(tree.getAttribute('aria-activedescendant')).toBeTruthy()
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(events).toEqual([['use', 'L/speed']])
  })

  it('ticks items and asks to map them', async () => {
    const { scout } = fake('done')
    const { el, events } = await mount(ScoutPanel, { scout })
    el.querySelector('[role="treeitem"] button').click()
    await nextTick()
    el.querySelector('input[type="checkbox"][aria-label="Select Speed"]').click()
    await nextTick()
    button(el, 'Map selected').click()
    expect(events).toEqual([['map', ['L/speed']]])
  })

  it('shows the change bar against a previous scan', async () => {
    const { scout } = fake('done')
    const prev = build_index(ITEMS.slice(0, 2))
    const meta = scout.status.value.current
    scout.changes.value = diff(scout.current_index.value, prev, { cur: meta, prev: meta })
    const { el } = await mount(ScoutPanel, { scout })
    expect(el.textContent).toMatch(/New\s*1/)
  })

  it('searches', async () => {
    const { scout } = fake('done')
    const { el } = await mount(ScoutPanel, { scout })
    const input = el.querySelector('input[type="search"]')
    input.value = 'speed'
    input.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 200))
    await nextTick()
    expect(el.textContent).toContain('1 match')
    expect(el.textContent).toContain('ns=2;s=Speed')
  })
})

describe('ScoutMapDialog', () => {
  it('proposes metrics and applies the matched ones', async () => {
    const metric = t => ({ allOf: [{}, { properties: { Sparkplug_Type: { enum: [t] } } }] })
    const schema = { properties: { Speed: metric('DoubleBE'), Other: metric('String') } }
    const { events } = await mount(ScoutMapDialog, {
      open: true, items: [ITEMS[1], ITEMS[2]], schema, index: build_index(ITEMS),
    })
    await nextTick()
    const apply = button(document.body, 'Apply')
    expect(apply.textContent).toContain('Apply 1')
    apply.click()
    expect(events[0][0]).toBe('apply')
    expect(events[0][1]).toEqual([{
      item: ITEMS[1], path: ['Speed'], allowed_types: ['DoubleBE'], default_type: 'DoubleBE',
    }])
  })

  it('refuses to create an object over one the origin map already holds', async () => {
    const metric = t => ({ allOf: [{}, { properties: { Sparkplug_Type: { enum: [t] } } }] })
    const schema = {
      properties: {
        Motors: { patternProperties: { '^[A-Za-z0-9_]+$': { properties: { Speed: metric('DoubleBE') } } } },
      },
    }
    const items = [
      { ...ITEMS[1], id: 'a', name: 'Motor1', address: 'ns=2;s=A' },
      { ...ITEMS[1], id: 'b', name: 'Motor2', address: 'ns=2;s=B' },
    ]
    const model = { Motors: { Motor1: { Speed: { Address: 'ns=2;s=Old' } } } }
    const { events } = await mount(ScoutMapDialog, {
      open: true, items, schema, index: build_index(items), model,
    })
    await nextTick()
    button(document.body, 'Create').click()
    await nextTick()
    expect(document.body.textContent).toContain('An object with this name already exists.')
    const apply = button(document.body, 'Apply')
    expect(apply.textContent).toContain('Apply 1')
    apply.click()
    expect(events[0][1].map(c => c.path)).toEqual([['Motors', 'Motor2', 'Speed']])
  })
})

describe('ScoutPanel with an untrusted entry', () => {
  it('warns but still offers Scan', async () => {
    const { scout, calls } = fake('never', {}, { entry: { node: 'other', state: 'done' } })
    scout.status.value = null
    scout.current_index.value = null
    const { el } = await mount(ScoutPanel, { scout })
    expect(el.textContent).toContain('written by an Edge Agent that does not host it')
    const scan = button(el, 'Scan')
    expect(scan.disabled).toBe(false)
    scan.click()
    expect(calls[0][0]).toBe('start')
  })
})

describe('ScoutTree branch scans', () => {
  it('offers Scan this branch on a folder the scan did not list', async () => {
    const items = [
      { id: 'L', parent: null, name: 'Line', kind: 'folder' },
      { id: 'L/M', parent: 'L', name: 'Motor', kind: 'folder', more: true },
      { id: 'D', parent: null, name: 'Denied', kind: 'folder', more: true, detail: { denied: true } },
    ]
    const { scout, calls } = fake('done', {}, { items })
    const { el } = await mount(ScoutPanel, { scout })
    const line = [...el.querySelectorAll('[role="treeitem"]')].find(r => r.textContent.includes('Line'))
    line.querySelector('button[aria-label="Open"]').click()
    await nextTick()
    const rows = [...el.querySelectorAll('[role="treeitem"]')]
    const row = name => rows.find(r => r.textContent.includes(name))
    const branch = r => [...r.querySelectorAll('button')].find(b => b.textContent.trim() === 'Scan this branch')
    expect(branch(row('Motor'))).toBeTruthy()
    expect(branch(row('Denied'))).toBeTruthy()
    expect(row('Motor').querySelector('[aria-label="Not fully listed"]')).toBeTruthy()
    branch(row('Motor')).click()
    expect(calls).toEqual([['branch', 'L/M']])
  })
})

describe('ScoutChangeBar', () => {
  it('counts an item that changed and was renamed once', async () => {
    const changes = {
      added: new Set(), changed: new Map([['a', ['type']], ['b', ['access']]]),
      renamed: new Set(['a', 'c']), comparable: true, gone: [], not_seen: [],
    }
    const { el } = await mount(ScoutChangeBar, { changes, missing: null })
    expect(el.textContent).toMatch(/Changed\s*3/)
  })
})
