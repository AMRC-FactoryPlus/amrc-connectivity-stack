/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
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
      icon: "user-circle"
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
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Setup auth guard.
router.beforeEach((to, from, next) => {
  const s = useServiceClientStore();
  if(!s.loaded && to.path !== "/login"){
    next({path: "/login"})
  }else if(s.loaded && to.path === "/login"){
    next({path: "/"})
  }
  else{
    next();
  }
})

const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
