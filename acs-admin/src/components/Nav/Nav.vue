<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup lang="ts">
import {Button} from '@components/ui/button'
import {useServiceClientStore} from '@/store/serviceClientStore.js'
import {SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem} from '@/components/ui/sidebar'

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
    },
    {
      title: 'ConfigDB',
      href: '/configdb',
      icon: 'gears',
      auth: true
    },
  {
    title: 'Files',
    href: '/files',
    icon: 'file',
    auth: true
  },
  {
    title: 'Bridges',
    href: '/bridges',
    icon: 'arrow-down-up-across-line',
    auth: true
  }
]
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in sidebarNavItems" :key="item.href">
          <RouterLink v-if="!item.auth || (item.auth && useServiceClientStore().loaded)" :to="item.href">
            <Button
                v-if="!item.auth || (item.auth && useServiceClientStore().loaded)"
                :key="item.title"
                :variant="$route.path === item.href || $route.meta.name === item.title ? 'default' : 'ghost'"
                class="w-full text-left justify-start"
            >
              <div class="flex items-center justify-center gap-2">
                <i :class="`fa-solid fa-${item.icon}`"></i>
                <span>{{item.title}}</span>
              </div>
            </Button>
          </RouterLink>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
