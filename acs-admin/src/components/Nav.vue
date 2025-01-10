<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup lang="ts">
import {Button} from '@components/ui/button'
import {useServiceClientStore} from '@/store/serviceClientStore.js'

interface Item {
    title: string
    href: string,
    icon?: string,
    auth: boolean
    admin?: boolean
}

const sidebarNavItems: Item[] = [
    {
        title: 'Home',
        href: '/',
        icon: 'home',
        auth: false
    },
    {
        title: 'Live Activity',
        href: '/activity',
        icon: 'table-cells',
        auth: true
    },
    {
        title: 'Alerts',
        href: '/alerts',
        icon: 'bell',
        auth: true
    },
    {
        title: 'Access Control',
        href: '/access-control',
        icon: 'user-shield',
        auth: true
    }
]
</script>

<template>
  <nav class="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 mb-6">
    <RouterLink v-for="item in sidebarNavItems" :key="item.href" :to="item.href">
      <Button
          v-if="!item.auth || (item.auth && useServiceClientStore().loaded)"
          :key="item.title"
          :variant="$route.path === item.href ? 'default' : 'ghost'"
          class="w-full text-left justify-start"
      >
        <div class="flex items-center justify-center gap-2">
          <i :class="`fa-solid fa-${item.icon}`"></i>
          <span>{{item.title}}</span>
        </div>
      </Button>
    </RouterLink>
  </nav>
</template>
