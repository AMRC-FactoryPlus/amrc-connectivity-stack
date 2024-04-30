import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'

import App from './App.vue'

import Welcome from '@pages/Welcome.vue'
import Activity from '@pages/Activity.vue'


const routes = [
  {
    path: '/',
    component: Welcome,
  },
  {
    path: '/activity',
    component: Activity,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
