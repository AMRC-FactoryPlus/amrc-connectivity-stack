<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Design preview of the sidebar for a user with a given set of
  - permissions, beside one page behind its access gate. Built from the
  - same components as App.vue. See README.md for the query parameters.
  -
  - Not part of the shipped application.
  -->

<template>
  <SidebarProvider>
    <Sidebar class="bg-white z-20">
      <SidebarHeader class="border-b h-16">
        <SidebarMenu>
          <SidebarMenuItem>
            <div class="flex items-center gap-2.5 h-12 pl-2">
              <div class="flex aspect-square size-6 items-center justify-center">
                <img src="/favicon.svg">
              </div>
              <div class="flex flex-col gap-0.5 leading-none">
                <h1 class="font-bold text-base h-4">ACS preview</h1>
                <h2 class="text-gray-500 text-sm">{{ user }}</h2>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <Nav/>
        <EdgeNav/>
      </SidebarContent>
    </Sidebar>

    <SidebarInset>
      <header class="flex items-center gap-2 border-b px-4 h-16 lg:px-6">
        <i :class="`fa-solid fa-${$route.params.deviceuuid ? 'microchip' : page?.icon ?? 'house'}`"></i>
        <h3 class="text-lg font-bold tracking-tight">{{ $route.params.deviceuuid ? 'Device' : page?.title ?? 'Home' }}</h3>
        <span class="ml-auto text-xs text-gray-400">Preview: nav, acl={{ acl }}</span>
      </header>
      <main class="flex flex-col lg:p-4">
        <!-- `#/edge-clusters/c/nodes/n/devices/<uuid>?surface=nav` shows
             the real device page, which gates its own parts. -->
        <Device v-if="$route.params.deviceuuid"/>
        <PageGate v-else :section="page?.key">
          <div class="p-10 text-sm text-gray-500">The {{ page?.title ?? 'Home' }} page shows here.</div>
        </PageGate>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>

<script>
import Nav from '@components/Nav/Nav.vue'
import EdgeNav from '@components/Nav/EdgeNav.vue'
import PageGate from '@components/PageGate.vue'
import Device from '@pages/EdgeManager/Devices/Device.vue'
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarProvider,
} from '@components/ui/sidebar'
import { section } from '@/lib/access/sections.js'
import { USERS } from './nav-fixtures.js'

export default {
  name: 'NavPreview',

  components: {
    Nav, EdgeNav, PageGate, Device,
    Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarProvider,
  },

  computed: {
    acl () {
      return this.$route.query.acl ?? 'none'
    },

    user () {
      return USERS[this.acl]?.name ?? this.acl
    },

    page () {
      return section(this.$route.query.page ?? 'home')
    },
  },
}
</script>
