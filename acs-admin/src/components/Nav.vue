<script setup lang="ts">
import {cn} from '@/lib/utils'
import {Button} from '@components/ui/button'
import { useServiceClientStore } from '@/store/serviceClientStore.js'

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

// const sideBarAdminNavItems: Item[] = [
//     {
//         title: 'Permissions & Access Control',
//         href: '/auth',
//         icon: 'shield-halved',
//         auth: true,
//         admin: true
//     },
//     {
//         title: 'Configuration Store',
//         href: '/configuration-store',
//         icon: 'code',
//         auth: true,
//         admin: true
//     }
// ]
</script>

<template>
  <nav class="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 mb-6">
    <RouterLink v-for="item in sidebarNavItems" :key="item.href" :to="item.href">
      <Button
          v-if="!item.auth || (item.auth && useServiceClientStore().loaded)"
          :key="item.title"
          :variant="$route.path === item.href ? 'default' : 'ghost'"
          :class="cn(
        'w-full text-left justify-start',
      )"
      >
        <div class="flex items-center justify-center gap-2">
          <i :class="`fa-solid fa-${item.icon}`"></i>
          {{item.title}}
        </div>
      </Button>
    </RouterLink>
  </nav>
<!--  <div>-->
<!--    <h2 class="font-bold ml-4 mb-1">Admin</h2>-->
<!--    <nav class="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1">-->
<!--      <RouterLink v-for="item in sideBarAdminNavItems" :to="item.href">-->
<!--        <Button-->
<!--            :key="item.title"-->
<!--            :variant="$route.path === item.href ? 'default' : 'ghost'"-->
<!--            :class="cn(-->
<!--        'w-full text-left justify-start',-->
<!--      )"-->
<!--        >-->
<!--          <div class="flex items-center justify-center gap-2">-->
<!--            <i :class="`fa-solid fa-${item.icon}`"></i>-->
<!--            {{item.title}}-->
<!--          </div>-->
<!--        </Button>-->
<!--      </RouterLink>-->
<!--    </nav>-->
<!--  </div>-->
</template>
