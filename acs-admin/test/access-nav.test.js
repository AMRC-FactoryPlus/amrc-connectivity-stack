// @vitest-environment jsdom
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The menu, the cluster tree and the page gate, mounted in jsdom with
 * the access store set by hand. The rules themselves are tested in
 * access-sections.test.js.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createPinia, defineStore } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import Nav from '../src/components/Nav/Nav.vue'
import EdgeNav from '../src/components/Nav/EdgeNav.vue'
import PageGate from '../src/components/PageGate.vue'
import { SidebarProvider } from '../src/components/ui/sidebar'
import { useAccessStore } from '../src/store/useAccessStore.js'
import { useServiceClientStore } from '../src/store/serviceClientStore.js'

/* The service client needs Kerberos libraries jsdom can't load, and
 * these components use only its UUIDs. The menu reads only `loaded`
 * from the client store. */
vi.mock('@amrc-factoryplus/service-client', async () => ({
  UUIDs: await import('../../lib/js-service-client/lib/uuids.js'),
}))
/* The tree itself starts the edge stores; only whether it shows is
 * under test here. */
vi.mock('../src/components/Nav/EdgeClusterList.vue', () => ({
  default: { render: () => h('div', 'cluster tree') },
}))
vi.mock('../src/store/serviceClientStore.js', () => ({
  useServiceClientStore: defineStore('service-client', { state: () => ({ loaded: false }) }),
}))
import { make_checker, Status } from '../src/lib/access/acl.js'
import { BUILD_DATASETS, READ_OBJECT } from '../src/lib/access/i3x-access.js'

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener () {}, removeEventListener () {} })
})

const DEVICE = '1a2b3c4d-0000-4000-8000-000000000001'
const DEVICE_DATA = [
  { permission: READ_OBJECT, target: DEVICE },
  { permission: BUILD_DATASETS, target: DEVICE },
]

let app = null
let el = null
afterEach(() => { app?.unmount(); el?.remove(); app = el = null })

/* Mounts `render` with the access store holding `check`. Returns the
 * element and the access store, to change the check afterwards. */
async function mount (render, check) {
  el = document.createElement('div')
  document.body.appendChild(el)
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  app = createApp({ render: () => h(SidebarProvider, null, { default: render }) })
  app.use(pinia).use(router)
  const access = useAccessStore(pinia)
  access.check = check
  useServiceClientStore(pinia).loaded = true
  await router.push('/')
  await router.isReady()
  app.mount(el)
  await nextTick()
  return { el, access }
}

const items = el => [...el.querySelectorAll('a')].map(a => a.textContent.trim())
const skeletons = el => el.querySelectorAll('[data-sidebar="menu-skeleton"]').length

describe('Nav', () => {
  it('shows Home and placeholders while the ACL loads', async () => {
    const { el } = await mount(() => h(Nav), make_checker({ status: Status.Loading }))
    expect(items(el)).toEqual(['Home'])
    expect(skeletons(el)).toBeGreaterThan(0)
  })

  it('shows only Home to a user with no grants', async () => {
    const { el } = await mount(() => h(Nav), make_checker({ status: Status.Ready, acl: [] }))
    expect(items(el)).toEqual(['Home'])
    expect(skeletons(el)).toBe(0)
  })

  it('shows the Explorer and Datasets for Device data on one device', async () => {
    const { el } = await mount(() => h(Nav), make_checker({ status: Status.Ready, acl: DEVICE_DATA }))
    expect(items(el)).toEqual(['Home', 'Explorer', 'Datasets'])
  })

  it('shows every item to root', async () => {
    const { el } = await mount(() => h(Nav), make_checker({ status: Status.Ready, root: true }))
    expect(items(el)).toEqual([
      'Home', 'Explorer', 'Live Activity', 'Alerts', 'Cassettes', 'Access Control',
      'ConfigDB', 'Files', 'Bridges', 'Gateway Depot', 'ISA-95', 'Units', 'Schemas', 'Datasets',
    ])
  })

  it('adds items when a grant arrives, without a reload', async () => {
    const { el, access } = await mount(() => h(Nav), make_checker({ status: Status.Ready, acl: [] }))
    access.check = make_checker({ status: Status.Ready, acl: DEVICE_DATA })
    await nextTick()
    expect(items(el)).toEqual(['Home', 'Explorer', 'Datasets'])
  })
})

describe('EdgeNav', () => {
  it('shows to root', async () => {
    const { el } = await mount(() => h(EdgeNav), make_checker({ status: Status.Ready, root: true }))
    expect(el.textContent).toContain('Edge Clusters & Devices')
    expect(el.textContent).toContain('cluster tree')
  })

  it('is hidden while loading and from a user who can not read clusters', async () => {
    const loading = await mount(() => h(EdgeNav), make_checker({ status: Status.Loading }))
    expect(loading.el.textContent).not.toContain('Edge Clusters')
    app.unmount(); el.remove()
    const none = await mount(() => h(EdgeNav), make_checker({ status: Status.Ready, acl: DEVICE_DATA }))
    expect(none.el.textContent).not.toContain('Edge Clusters')
  })
})

describe('PageGate', () => {
  const page = section => () => h(PageGate, { section }, { default: () => h('p', 'page content') })

  it('says so when the user can not read the page', async () => {
    const { el } = await mount(page('configdb'), make_checker({ status: Status.Ready, acl: DEVICE_DATA }))
    expect(el.textContent).toContain("You don't have access to the ConfigDB.")
    expect(el.textContent).toContain('ask a Factory+ administrator')
    expect(el.textContent).not.toContain('page content')
  })

  it('shows the page when the user can read it', async () => {
    const { el } = await mount(page('explorer'), make_checker({ status: Status.Ready, acl: DEVICE_DATA }))
    expect(el.textContent).toContain('page content')
  })

  it('shows neither while the ACL loads', async () => {
    const { el } = await mount(page('configdb'), make_checker({ status: Status.Loading }))
    expect(el.textContent).not.toContain('page content')
    expect(el.textContent).not.toContain("don't have access")
    expect(el.querySelector('[role="status"]')).not.toBe(null)
  })

  it('always shows a page with no section', async () => {
    const { el } = await mount(page(null), make_checker({ status: Status.Ready, acl: [] }))
    expect(el.textContent).toContain('page content')
  })
})
