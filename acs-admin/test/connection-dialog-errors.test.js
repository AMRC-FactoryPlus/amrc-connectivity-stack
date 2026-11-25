// @vitest-environment jsdom
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The new-connection dialog, mounted in jsdom with fake stores. A
 * required field shows its error only once someone has touched it, so
 * a dialog that has just opened shows no errors, and the name field
 * says its rule before anyone types.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import mitt from 'mitt'

const DRIVERS = [
  { uuid: 'd-ads', name: 'ADS', definition: { image: { repository: 'edge-ads' }, schema: {
    type: 'object', required: ['host'], properties: { host: { type: 'string', title: 'Host' } } } } },
  { uuid: 'd-ext', name: 'External driver', definition: { external: true, polled: false } },
]

/* The service client's index pulls in GSSAPI, which the browser build
 * stubs out. The dialog only needs UUIDs to save. */
vi.mock('@amrc-factoryplus/service-client', () => ({ UUIDs: { App: {}, Class: {}, Service: {} } }))
vi.mock('@store/serviceClientStore.js', () => ({ useServiceClientStore: () => ({ client: {} }) }))
vi.mock('@store/useDriverStore.js', () => ({ useDriverStore: () => ({ data: DRIVERS, ready: true }) }))
vi.mock('@store/useEdgeClusterStore.js', () => ({ useEdgeClusterStore: () => ({ data: [] }) }))
vi.mock('@store/useConnectionStore.js', () => ({ useConnectionStore: () => ({ data: [] }) }))
vi.mock('@store/useNodeStore.js', () => ({ useNodeStore: () => ({ data: [] }) }))
vi.mock('@store/useDeviceStore.js', () => ({ useDeviceStore: () => ({ data: [] }) }))
vi.mock('@store/useAccessStore.js', () => ({ useAccessStore: () => ({ check: {} }) }))
vi.mock('@/lib/access/perms-edge.js', () => ({
  can_new_connection: () => true, can_edit_connection: () => true, can_delete_connection: () => false,
}))
vi.mock('@/lib/edge-secrets.js', () => ({
  load_secret_access: async () => true, save_edge_secret: async () => {},
}))
vi.mock('@utils/edgeAgentConfigUpdater.js', () => ({ updateEdgeAgentConfig: async () => {} }))

const { default: NewConnectionDialog } = await import('../src/components/EdgeManager/Connections/NewConnectionDialog.vue')
const { CONNECTION_NAME_HINT, EXTERNAL_NAME_HINT } = await import('../src/lib/edge-names.js')

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
  window.events = mitt()
})

let app = null
let el = null
afterEach(() => {
  app?.unmount(); el?.remove(); app = el = null
  document.body.innerHTML = ''
  window.events.all.clear()
})

const settle = async () => { for (let i = 0; i < 5; i++) await nextTick() }

async function open () {
  el = document.createElement('div')
  document.body.appendChild(el)
  app = createApp(NewConnectionDialog)
  const vm = app.mount(el)
  window.events.emit('show-new-connection-dialog-for-node', {
    node: { uuid: 'n1', name: 'Cell', deployment: { cluster: 'c1' } },
  })
  await settle()
  return vm
}

const errors = () => [...document.querySelectorAll('.text-red-500')]
  .map(e => e.textContent.trim())
  .filter(t => t && t !== '*')

describe('NewConnectionDialog', () => {
  it('shows no errors when it opens', async () => {
    await open()
    expect(document.body.textContent).toContain('Create a New Connection')
    expect(errors()).toEqual([])
    expect(document.body.textContent).not.toContain('Value is required')
    expect(document.body.textContent).not.toContain('Please select a driver')
  })

  it('shows no errors when opened a second time', async () => {
    const vm = await open()
    vm.handleOpen(false)
    await settle()
    window.events.emit('show-new-connection-dialog-for-node', {
      node: { uuid: 'n1', name: 'Cell', deployment: { cluster: 'c1' } },
    })
    await settle()
    expect(errors()).toEqual([])
  })

  it('says the name rule before anyone types', async () => {
    await open()
    expect(document.body.textContent).toContain(CONNECTION_NAME_HINT)
  })

  it('does not flag the driver fields as soon as a driver is picked', async () => {
    const vm = await open()
    vm.v$.selectedDriverId.$model = 'd-ads'
    await settle()
    expect(document.body.textContent).toContain('Host')
    expect(errors()).toEqual([])
  })

  it('shows a name error once the name is touched', async () => {
    const vm = await open()
    vm.v$.name.$model = 'PLC/1'
    await settle()
    expect(errors().join(' ')).toMatch(/Only letters, numbers/)
    vm.v$.name.$model = ''
    await settle()
    expect(errors()).toContain('Give the connection a name')
  })

  it('gives an external driver the stricter rule, and says so', async () => {
    const vm = await open()
    vm.v$.selectedDriverId.$model = 'd-ext'
    await settle()
    expect(document.body.textContent).toContain(EXTERNAL_NAME_HINT)
    vm.v$.name.$model = 'my driver'
    await settle()
    expect(errors().join(' ')).toMatch(/external driver/)
  })

  it('shows every error on save', async () => {
    const vm = await open()
    await vm.save()
    await settle()
    expect(errors()).toContain('Give the connection a name')
    expect(errors()).toContain('Please select a driver')
  })
})
