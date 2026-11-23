/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import './assets/main.css'

/* Where Monaco finds its web workers.
 *
 * vite-plugin-monaco-editor-esm normally injects this as an inline script in
 * index.html, which would force the console's CSP to allow 'unsafe-inline'.
 * Setting it here instead puts it in the bundle, which is same-origin, and
 * a small plugin in vite.config.js strips the injected copy. The plugin is
 * still needed: it emits the worker bundles these paths point at.
 *
 * The plugin's version also carried a blob: fallback for workers served from
 * another origin. These are all local, so that path was dead code and is not
 * reproduced here.
 */
const MONACO_WORKERS = {
  editorWorkerService: '/monacoeditorwork/editor.worker.bundle.js',
  json:                '/monacoeditorwork/json.worker.bundle.js',
  yaml:                '/monacoeditorwork/monaco-yaml.bundle.js',
}

self.MonacoEnvironment = {
  globalAPI: true,
  getWorkerUrl (moduleId, label) {
    return MONACO_WORKERS[label] ?? MONACO_WORKERS.editorWorkerService
  },
}

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persist'
import { createRouter, createWebHashHistory } from 'vue-router'
import mitt from 'mitt'

import App from './App.vue'

import Home from '@pages/Home.vue'
import Activity from '@pages/Activity.vue'
import Alerts from '@pages/Alerts/Alerts.vue'
import AccessControl from '@pages/AccessControl/AccessControl.vue'
import { useServiceClientStore } from "@store/serviceClientStore.js";
import Login from "@pages/Login.vue";
import EdgeCluster from '@pages/EdgeManager/EdgeClusters/EdgeCluster.vue'
import Node from '@pages/EdgeManager/Nodes/Node.vue'
import Device from '@pages/EdgeManager/Devices/Device.vue'
import ConfigDB from "@pages/ConfigDB/ConfigDB.vue";
import ApplicationEditor from "@pages/ConfigDB/Applications/ApplicationEditor.vue";
import ApplicationObjectEditor from "@pages/ConfigDB/Applications/ApplicationObjectEditor.vue";
import ObjectPage from "@pages/ConfigDB/Objects/ObjectPage.vue";
import Files from "@pages/Files/Files.vue";
import Bridges from "@pages/Bridges/Bridges.vue";
import ISA95 from "@pages/ISA95/ISA95.vue";
import Datasets from '@pages/Datasets/Datasets.vue';
import DatasetPage from '@pages/Datasets/DatasetPage.vue';
import DatasetBuilder from '@pages/Datasets/DatasetBuilder.vue';
import DatasetCompare from '@pages/Datasets/DatasetCompare.vue';
import DatasetAddons from '@pages/Datasets/AddonsPage.vue';
import Kiosk from '@pages/Datasets/Kiosk.vue';

// Create an event bus
window.events = mitt()

const routes = [
  {
    path: '/',
    component: Home,
    meta: {
      name: 'Home',
      icon: 'house',
    },
  },
  {
    path: '/explorer',
    component: () => import('@pages/Explorer/Explorer.vue'),
    meta: {
      name: 'Explorer',
      icon: 'compass',
    },
  },
  {
    path: "/login",
    component: Login,
    meta: {
      name: "Login",
      icon: "user-circle",
      anonAllowed: true,
    }
  },
  {
    path: '/activity',
    component: Activity,
    meta: {
      name: 'Live Device Activity',
      icon: 'table-cells',
    },
  }, {
    path: '/alerts',
    component: Alerts,
    meta: {
      name: 'Alerts',
      icon: 'bell',
    },
  }, {
    path: '/cassette-decks',
    component: () => import('@pages/CassetteDecks/CassetteDecks.vue'),
    meta: {
      name: 'Cassettes',
      icon: 'cassette-tape',
    },
  }, {
    path: '/access-control/:tab?/:selected?',
    component: AccessControl,
    meta: {
      name: 'Access Control',
      icon: 'user-shield',
    },
  }, {
    name: 'Cluster',
    path: '/edge-clusters/:clusteruuid',
    component: EdgeCluster,
    meta: {
      name: 'Edge Cluster',
    },
  }, {
    name: 'Node',
    path: '/edge-clusters/:clusteruuid/nodes/:nodeuuid',
    component: Node,
    meta: {
      name: 'Node',
    },
  }, {
    name: 'Device',
    path: '/edge-clusters/:clusteruuid/nodes/:nodeuuid/devices/:deviceuuid',
    component: Device,
    meta: {
      name: 'Device',
    },
  },
  {
    path: '/configdb/:tab?',
    component: ConfigDB,
    meta: {
      name: 'ConfigDB',
      icon: 'gears'
    },
    children: [
      { path: ':selected?', component: ConfigDB, meta: {} }
    ]
  },
  {
    path: '/configdb/applications/:application',
    component: ApplicationEditor,
    meta: {
      name: 'ConfigDB',
      icon: 'gears'
    }
  },
  {
    name: 'ApplicationObjectEditor',
    path: '/configdb/applications/:application/:object',
    component: ApplicationObjectEditor,
    meta: {
      name: 'ConfigDB',
      icon: 'gears'
    }
  },
  {
    path: '/configdb/objects/:object',
    component: ObjectPage,
    meta: {
      name: 'ConfigDB',
      icon: 'gears'
    }
  },
  {
    path: '/files',
    component: Files,
    meta: {
      name: 'Files',
      icon: 'file'
    }
  },
  {
    path: '/bridges',
    component: Bridges,
    meta: {
      name: 'Bridges',
      icon: 'arrow-down-up-across-line'
    }
  },
  {
    path: '/isa95',
    component: ISA95,
    meta: {
      name: 'ISA-95',
      icon: 'sitemap'
    }
  },
  {
    path: '/schemas',
    component: () => import('@pages/Schemas/Schemas.vue'),
    meta: {
      name: 'Schemas',
      icon: 'shapes'
    }
  },
  {
    path: '/schemas/new',
    component: () => import('@pages/Schemas/SchemaEditor.vue'),
    meta: {
      name: 'Schemas',
      icon: 'shapes',
      schemaMode: 'new'
    }
  },
  {
    path: '/schemas/draft/:id',
    component: () => import('@pages/Schemas/SchemaEditor.vue'),
    meta: {
      name: 'Schemas',
      icon: 'shapes',
      schemaMode: 'draft'
    }
  },
  {
    path: '/schemas/draft/:id/publish',
    component: () => import('@pages/Schemas/PublishSchema.vue'),
    meta: {
      name: 'Schemas',
      icon: 'shapes'
    }
  },
  {
    path: '/schemas/:id',
    component: () => import('@pages/Schemas/SchemaEditor.vue'),
    meta: {
      name: 'Schemas',
      icon: 'shapes',
      schemaMode: 'schema'
    }
  },
  {
    path: '/data-access',
    redirect: '/datasets',
  },
  {
    path: '/datasets',
    component: Datasets,
    meta: {
      name: 'Datasets',
      icon: 'database'
    }
  },
  {
    path: '/datasets/new',
    component: DatasetBuilder,
    meta: {
      name: 'Datasets',
      icon: 'database'
    }
  },
  {
    path: '/datasets/compare',
    component: DatasetCompare,
    meta: {
      name: 'Datasets',
      icon: 'database'
    }
  },
  {
    path: '/datasets/add-ons',
    component: DatasetAddons,
    meta: {
      name: 'Datasets',
      icon: 'database'
    }
  },
  {
    path: '/datasets/:uuid/edit',
    component: DatasetBuilder,
    meta: {
      name: 'Datasets',
      icon: 'database'
    }
  },
  {
    path: '/datasets/:uuid/:tab?',
    component: DatasetPage,
    meta: {
      name: 'Datasets',
      icon: 'database'
    }
  },
  {
    path: '/gateway-depot',
    component: () => import('@pages/GatewayDepot/GatewayDepot.vue'),
    meta: {
      name: 'Gateway Depot',
      icon: 'warehouse'
    }
  },
  {
    name: 'GatewayDepotGateway',
    path: '/gateway-depot/:id',
    component: () => import('@pages/GatewayDepot/Gateway.vue'),
    meta: {
      name: 'Gateway Depot',
      icon: 'warehouse'
    }
  },
  {
    // Full screen, for a tablet next to the equipment.
    path: '/kiosk/:equipment?',
    component: Kiosk,
    meta: {
      name: 'Kiosk',
      icon: 'tablet-screen-button',
      kiosk: true,
    }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Setup auth guard.
router.beforeEach(async (to, from, next) => {
  // If we don't need auth, we can go straight through
  // This is only for login at the moment, but other pages may be accessible in future
  if (to.meta.anonAllowed) {
    next()
    return
  }
  // From here on, we do need auth
  // If we are navigating between pages with the service client ready
  if (useServiceClientStore().ready) {
    next()
    return
  }

  // When OIDC is configured, login() resumes an existing Keycloak session
  // from its own stored tokens, or redirects to Keycloak (navigating away
  // and never resolving) - there is no separate login form to send the
  // user to in this case.
  if (useServiceClientStore().oidcConfigured) {
    try {
      const store = useServiceClientStore()
      await store.login()
      // If we were sent to Keycloak mid-session (e.g. a refresh-token
      // failure) and are now coming back, restore the route we were on
      // rather than landing on whatever route triggered the redirect.
      // Setting location.hash (unlike history.replaceState) fires the
      // hash-router's own navigation, so abort this one and let that
      // one take over.
      const hash = store.oidc?.take_pending_hash()
      if (hash && hash !== location.hash) {
        next(false)
        location.hash = hash
        return
      }
      next()
    } catch (e) {
      console.error("OIDC login failed", e)
      next(false)
    }
    return
  }

  // Non-OIDC (dev) fallback: username/password form, persisted creds.
  const optsString = localStorage.getItem('opts');
  // If there is no opts value stored, make sure we go to login
  if (!optsString) {
    // Make sure we go to login
    if (to.path !== "/login") {
      next({ path: "/login" })
      return
    }
    // Allow through to the login page
    next()
    return
  }
  // We do have opts, we should try to use them
  try {
    const opts = JSON.parse(optsString)
    await useServiceClientStore().login(opts)
    // Seems to have worked! Go through
    next()
    return
  } catch (e) {
    // Login failed, lets remove opts and login again
    useServiceClientStore().logout()
    console.error("Login with stored credentials failed, credentials reset", e)
    next({ path: "/login" })
    return
  }
})

const pinia = createPinia()
pinia.use(piniaPersist)

createApp(App).use(router).use(pinia).mount('#app')
