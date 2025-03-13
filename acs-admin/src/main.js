/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persist'
import { createRouter, createWebHashHistory } from 'vue-router'

import App from './App.vue'

import Home from '@pages/Home.vue'
import Activity from '@pages/Activity.vue'
import Alerts from '@pages/Alerts/Alerts.vue'
import AccessControl from '@pages/AccessControl/AccessControl.vue'
import {useServiceClientStore} from "@store/serviceClientStore.js";
import Login from "@pages/Login.vue";
import EdgeCluster from '@pages/EdgeManager/EdgeClusters/EdgeCluster.vue'
import ConfigDB from "@pages/ConfigDB/ConfigDB.vue";
import ApplicationEditor from "@pages/ConfigDB/Applications/ApplicationEditor.vue";
import ApplicationObjectEditor from "@pages/ConfigDB/Applications/ApplicationObjectEditor.vue";
import ObjectPage from "@pages/ConfigDB/Objects/ObjectPage.vue";

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
    path: '/edge-clusters/:clusteruuid',
    component: EdgeCluster,
    meta: {
      name: 'Edge Cluster',
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
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Setup auth guard.
router.beforeEach((to, from, next) => {
  const clientLoaded = localStorage.getItem('clientLoaded');
  if(!clientLoaded && to.path !== "/login"){
    next({path: "/login"})
  }else if(clientLoaded && to.path === "/login"){
    next({path: "/"})
  }
  else{
    next();
  }
})

const pinia = createPinia()
pinia.use(piniaPersist)

createApp(App).use(router).use(pinia).mount('#app')
