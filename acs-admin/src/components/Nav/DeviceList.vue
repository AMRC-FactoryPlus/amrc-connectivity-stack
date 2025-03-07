<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <SidebarMenuItem v-for="device in devices" :key="device.uuid" v-if="devices.length">
    <Button
        title="View Device"
        size="sm"
        variant="ghost"
        class="w-full text-left justify-start"
    >
      <div class="flex items-center justify-center gap-2">
        <i :class="`fa-solid fa-microchip`"></i>
        <span>{{device.name}}</span>
      </div>
    </Button>
  </SidebarMenuItem>
  <Button disabled class="flex items-center justify-center gap-1 text-gray-400 my-1" variant="ghost" size="sm">
    <i class="fa-solid fa-plus"></i>
    <span>New Device</span>
  </Button>
</template>

<script>

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { Button } from '@components/ui/button'
import { useDeviceStore } from '@store/useDeviceStore.js'

export default {

  setup () {
    return {
      s: useDeviceStore(),
    }
  },

  components: {
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarMenuSub,
    Button,
  },

  props: {
    node: {
      type: Object,
    },
  },

  computed: {
    devices () {
      return Array.isArray(this.s.data) ? this.s.data.filter(e => e.node === this.node.uuid) : []
    },

    devicesLoading () {
      return this.s.loading
    },
  },

  async mounted () {
    await this.s.fetch()
  },
}
</script>
