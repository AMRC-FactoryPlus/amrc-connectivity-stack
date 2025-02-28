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
import EdgeCluster from '@pages/EdgeCluster.vue'

const routes = [
  {
    path: '/',
    component: Home,
    meta: {
      name: 'Home',
      icon: 'house',
    },
  }, {
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
    path: '/access-control',
    component: AccessControl,
    meta: {
      name: 'Access Control',
      icon: 'user-shield',
    },
  }, {
    path: '/edge-cluster/:uuid',
    component: EdgeCluster,
    meta: {
      name: 'Edge Cluster',
    },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
