/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Entry point for the design preview. Seeds the Pinia stores with
 * fixture data and neutralises their start/stop actions so no service
 * client is required. Not part of the shipped application. */

import '../src/assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import mitt from 'mitt'

import Preview from './Preview.vue'
import { devices, drafts, schemas } from './fixtures.js'

import { useSchemaStore } from '../src/store/useSchemaStore.js'
import { useSchemaDraftStore } from '../src/store/useSchemaDraftStore.js'
import { useDeviceStore } from '../src/store/useDeviceStore.js'
import { useServiceClientStore } from '../src/store/serviceClientStore.js'

window.events = mitt()

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Preview, meta: { name: 'Schemas' } },
    {
      path: '/schemas',
      component: Preview,
      meta: { name: 'Schemas', schemaMode: 'schema' },
    },
    {
      path: '/schemas/new',
      component: Preview,
      meta: { name: 'Schemas', schemaMode: 'new' },
    },
    {
      path: '/schemas/draft/:id',
      component: Preview,
      meta: { name: 'Schemas', schemaMode: 'draft' },
    },
    {
      path: '/schemas/:id',
      component: Preview,
      meta: { name: 'Schemas', schemaMode: 'schema' },
    },
  ],
})

const pinia = createPinia()
const app = createApp(Preview).use(router).use(pinia)

/* Stores have to be seeded after Pinia is installed but before the
 * components mount, so their mounted() hooks find data already there. */
const seed = () => {
  const stub = (store, data) => {
    store.start = async () => {}
    store.stop = () => {}
    store.data = data
    store.loading = false
    store.ready = true
  }

  stub(useSchemaStore(), schemas)
  stub(useSchemaDraftStore(), drafts)
  stub(useDeviceStore(), devices)

  const s = useServiceClientStore()
  s.ready = true
  s.loaded = true
  s.username = 'preview'
  /* Reads only. Writing is not part of what the preview shows, and the
   * Directory lookup is stubbed so the live figure is deterministic. */
  s.client = {
    Directory: { fetch: async () => [200, ['dev-a', 'dev-b']] },
    ConfigDB: {},
  }
}

router.isReady().then(() => {
  seed()
  app.mount('#app')
})
