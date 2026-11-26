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
import NavPreview from './NavPreview.vue'
import * as navfx from './nav-fixtures.js'
import { devices, drafts, schemas } from './fixtures.js'

import { useSchemaStore } from '../src/store/useSchemaStore.js'
import { useSchemaDraftStore } from '../src/store/useSchemaDraftStore.js'
import { useDeviceStore } from '../src/store/useDeviceStore.js'
import { useServiceClientStore } from '../src/store/serviceClientStore.js'
import { useISA95Store } from '../src/store/useISA95Store.js'
import { useObjectStore } from '../src/store/useObjectStore.js'
import { usePrincipalStore } from '../src/store/usePrincipalStore.js'
import * as i3x from './i3x-fixtures.js'
import * as isa95fx from './isa95-fixtures.js'
import { useAccessStore } from '../src/store/useAccessStore.js'
import { useConnectionStore } from '../src/store/useConnectionStore.js'
import { useDriverStore } from '../src/store/useDriverStore.js'
import { useEngUnitStore } from '../src/store/useEngUnitStore.js'
import { Status, make_checker } from '../src/lib/access/acl.js'
import { useEdgeClusterStore } from '../src/store/useEdgeClusterStore.js'
import { useNodeStore } from '../src/store/useNodeStore.js'
import { useDeploymentStore } from '../src/store/useDeploymentStore.js'
import { useHelmChartStore } from '../src/store/useHelmChartStore.js'
import { useDepotGatewayStore } from '../src/store/useDepotGatewayStore.js'
import * as clusterfx from './cluster-fixtures.js'

window.events = mitt()

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Preview, meta: { name: 'Schemas' } },
    { path: '/access-control/:kind/:id', component: Preview, meta: { name: 'Access Control' } },
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
      path: '/schemas/draft/:id/publish',
      component: Preview,
      meta: { name: 'Schemas' },
    },
    {
      path: '/schemas/:id',
      component: Preview,
      meta: { name: 'Schemas', schemaMode: 'schema' },
    },
    {
      path: '/edge-clusters/:clusteruuid/nodes/:nodeuuid/devices/:deviceuuid',
      component: Preview,
    },
    { path: '/edge-clusters/:clusteruuid', component: Preview },
    /* The nav surface's links go nowhere. */
    { path: '/:any(.*)*', component: Preview },
  ],
})

const query = new URL(window.location.hash.slice(1), window.location.origin).searchParams
const pinia = createPinia()
const app = createApp(query.get('surface') === 'nav' ? NavPreview : Preview).use(router).use(pinia)

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
   * Directory lookup is stubbed so the live figure is deterministic.
   * `?live=off` makes it fail, which is how the unknown-count state is
   * reached without taking a service down. */
  const live = new URL(window.location.hash.slice(1), window.location.origin)
    .searchParams.get('live')

  const surface = new URL(window.location.hash.slice(1), window.location.origin)
    .searchParams.get('surface') ?? ''

  /* The sidebar for one user: `acl` is none, empty, device, root or
   * loading (nav-fixtures.js). Root also sees the cluster tree. */
  if (surface === 'nav') {
    const user = navfx.USERS[query.get('acl') ?? 'none'] ?? navfx.USERS.none
    useAccessStore().check = user.check()
    useAccessStore().start = async () => {}
    stub(useEdgeClusterStore(), navfx.clusters)
    stub(useObjectStore(), navfx.objects)
    for (const store of [useNodeStore(), useDriverStore(), useDeploymentStore(), useHelmChartStore()])
      stub(store, [])
    s.client = {}
    return
  }
  /* The edge cluster page, with its Delete cluster button. `delete` is
   * offline, online or none (cluster-fixtures.js). */
  if (surface === 'edge-cluster') {
    stub(useEdgeClusterStore(), clusterfx.clusters)
    stub(useNodeStore(), clusterfx.nodes)
    stub(useDeploymentStore(), [])
    stub(useDepotGatewayStore(), [])
    useDepotGatewayStore().rxsub = { unsubscribe () {} }
    useAccessStore().check = navfx.USERS.root.check()
    useAccessStore().start = async () => {}
    s.client = clusterfx.make_client(query.get('delete') ?? 'offline')
    return
  }
  /* The ISA-95 hierarchy surfaces write to an in-memory ConfigDB.
   * `ro=1` shows them to someone with no edit rights. */
  if (surface.startsWith('isa95')) {
    const store = useISA95Store()
    stub(store, isa95fx.nodes)
    stub(useDeviceStore(), isa95fx.devices)
    s.client = isa95fx.make_client(store)
    const ro = new URL(window.location.hash.slice(1), window.location.origin).searchParams.get('ro')
    useAccessStore().check = make_checker({ status: ro ? Status.Loading : Status.Unknown })
    useAccessStore().start = async () => {}
    return
  }

  if (surface.startsWith('i3x')) {
    stub(useDeviceStore(), i3x.i3xDevices)
    stub(useISA95Store(), i3x.isa95)
    stub(useObjectStore(), i3x.objects)
    stub(usePrincipalStore(), i3x.principals)
    usePrincipalStore().rxsub = { unsubscribe () {} }
    s.client = i3x.i3xClient
    return
  }

  /* The Edge Scout surface mounts the real metric fields, which read
   * connections, drivers and units. */
  if (surface === 'scout') {
    stub(useConnectionStore(), [])
    stub(useDriverStore(), [])
    stub(useEngUnitStore(), [])
  }

  s.client = {
    Directory: {
      fetch: async () => {
        if (live === 'off') throw new Error('Directory unreachable (preview)')
        return [200, devices.slice(0, 3).map(d => d.uuid)]
      },
    },
    ConfigDB: {},
  }
}

router.isReady().then(() => {
  seed()
  app.mount('#app')
})
