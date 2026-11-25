<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The main menu. Each item shows only when the user's permissions
     let them read something on its page (lib/access/sections.js).
     While their permissions load, Home shows with placeholders below
     it, so items appear rather than flash up and vanish. -->
<script setup>
import { computed } from 'vue'
import { Button } from '@components/ui/button'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useAccessStore } from '@/store/useAccessStore.js'
import { Status } from '@/lib/access/acl.js'
import { nav_sections } from '@/lib/access/sections.js'
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuSkeleton } from '@/components/ui/sidebar'

const s = useServiceClientStore()
const access = useAccessStore()

const items = computed(() => nav_sections(access.check))
const loading = computed(() => s.loaded && access.check.status === Status.Loading)
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in items" :key="item.href">
          <RouterLink :to="item.href">
            <Button
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
        <template v-if="loading">
          <SidebarMenuItem v-for="n in 4" :key="`loading-${n}`" aria-hidden="true">
            <SidebarMenuSkeleton show-icon class="h-9 px-4"/>
          </SidebarMenuItem>
        </template>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
