import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import App from './App.vue'

import Welcome from '@pages/Welcome.vue'


const routes = [
  {
    path: '/',
    component: Welcome,
  },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
