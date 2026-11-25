// @vitest-environment jsdom
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The new-device dialog's name field, mounted in jsdom with fake
 * stores: it says its rule before anyone types, takes a hyphen, and
 * shows each error once.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import mitt from 'mitt'

vi.mock('@amrc-factoryplus/service-client', () => ({ UUIDs: { App: {}, Class: {} } }))
vi.mock('@amrc-factoryplus/service-client/lib/sparkplug/util.js', () => ({ sparkplug_safe_string: s => s }))
vi.mock('@store/serviceClientStore.js', () => ({ useServiceClientStore: () => ({ client: {} }) }))
vi.mock('@store/useDeviceStore.js', () => ({ useDeviceStore: () => ({ data: [] }) }))
vi.mock('@store/useISA95Store.js', () => ({
  useISA95Store: () => ({ ready: true, enterprises: [{ uuid: 'e1' }], start () {} }),
}))
vi.mock('@components/ISA95/ISA95PlacementPicker.vue', () => ({ default: { render: () => null } }))

const { default: NewDeviceDialog } = await import('../src/components/EdgeManager/Devices/NewDeviceDialog.vue')
const { DEVICE_NAME_HINT } = await import('../src/lib/edge-names.js')

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
  app = createApp(NewDeviceDialog)
  const vm = app.mount(el)
  window.events.emit('show-new-device-dialog-for-node', { uuid: 'n1', name: 'Cell' })
  await settle()
  return vm
}

const errors = () => [...document.querySelectorAll('.text-red-500')]
  .map(e => e.textContent.trim())
  .filter(Boolean)

describe('NewDeviceDialog name', () => {
  it('says the rule before anyone types, and shows no errors', async () => {
    await open()
    expect(document.body.textContent).toContain(DEVICE_NAME_HINT)
    expect(errors()).toEqual([])
  })

  it('takes a hyphen', async () => {
    const vm = await open()
    vm.v$.name.$model = 'Press-1'
    await settle()
    expect(errors()).toEqual([])
  })

  it('shows a bad name error once', async () => {
    const vm = await open()
    vm.v$.name.$model = 'Press/1'
    await settle()
    expect(errors()).toHaveLength(1)
    expect(errors()[0]).toMatch(/Only letters, numbers/)
  })
})
