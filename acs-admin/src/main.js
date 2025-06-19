/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import './assets/main.css'

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
import {useServiceClientStore} from "@store/serviceClientStore.js";
import Login from "@pages/Login.vue";
import EdgeCluster from '@pages/EdgeManager/EdgeClusters/EdgeCluster.vue'
import Node from '@pages/EdgeManager/Nodes/Node.vue'
import Device from '@pages/EdgeManager/Devices/Device.vue'
import ConfigDB from "@pages/ConfigDB/ConfigDB.vue";
import ApplicationEditor from "@pages/ConfigDB/Applications/ApplicationEditor.vue";
import ApplicationObjectEditor from "@pages/ConfigDB/Applications/ApplicationObjectEditor.vue";
import ObjectPage from "@pages/ConfigDB/Objects/ObjectPage.vue";
import Files from "@pages/Files/Files.vue";

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
      {path: ':selected?', component: ConfigDB, meta: {}}
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
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Setup auth guard.
// This should pull a token from local storage, but currently uses the users credentials to fetch tokens
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
  // Otherwise we are loading fresh and need to initialise the service client
  const optsString = localStorage.getItem('opts');
  // If there is no opts value stored, make sure we go to login
  if (!optsString) {
    // Make sure we go to login
    if (to.path !== "/login") {
      next({path: "/login"})
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
    next({path: "/login"})
    return
  }
})

const pinia = createPinia()
pinia.use(piniaPersist)

createApp(App).use(router).use(pinia).mount('#app')
