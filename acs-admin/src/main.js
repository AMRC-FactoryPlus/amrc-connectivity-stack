/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'

import App from './App.vue'

import Home from '@pages/Home.vue'
import Activity from '@pages/Activity.vue'
import Alerts from '@pages/Alerts/Alerts.vue'
import AccessControl from '@pages/AccessControl/AccessControl.vue'
import EdgeDevicesAndClusters from '@pages/EdgeDevicesAndClusters/EdgeDevicesAndClusters.vue'

const routes = [
  {
    path: '/',
    component: Home,
    meta: {
      name: 'Home',
      icon: 'house'
    },
  },
  {
    path: '/devices',
    component: EdgeDevicesAndClusters,
    meta: {
      name: 'Edge Devices & Clusters',
      icon: 'microchip'
    },
  },
  {
    path: '/activity',
    component: Activity,
    meta: {
      name: 'Live Device Activity',
      icon: 'table-cells'
    },
  },
  {
    path: '/alerts',
    component: Alerts,
    meta: {
      name: 'Alerts',
      icon: 'bell'
    },
  },
  {
    path: '/access-control',
    component: AccessControl,
    meta: {
      name: 'Access Control',
      icon: 'user-shield'
    },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
