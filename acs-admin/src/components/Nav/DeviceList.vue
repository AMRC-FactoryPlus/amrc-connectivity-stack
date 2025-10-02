<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <SidebarMenuItem v-for="device in devices" :key="device.uuid" v-if="devices.length">
    <RouterLink :to="`/edge-clusters/${cluster.uuid}/nodes/${node.uuid}/devices/${device.uuid}`">
      <Button
          title="View Device"
          size="sm"
          variant="ghost"
          class="w-full text-left justify-start ml-4"
      >
        <div class="flex items-center justify-center gap-2">
          <i :class="`fa-solid fa-microchip`"></i>
          <span>{{device.name}}</span>
        </div>
      </Button>
    </RouterLink>
  </SidebarMenuItem>
</template>

<script>

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { Button } from '@components/ui/button'
import { useDeviceStore } from '@store/useDeviceStore.js'
import NewDeviceDialog from '@/components/EdgeManager/Devices/NewDeviceDialog.vue'

export default {

  setup () {
    return {
      d: useDeviceStore(),
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
    NewDeviceDialog
  },

  props: {
    cluster: {
      type: Object,
    },
    node: {
      type: Object,
    },
  },

  computed: {
    devices () {
      return Array.isArray(this.d.data) ? this.d.data.filter(e => e.deviceInformation?.node === this.node.uuid).toSorted((a, b) => a.name.localeCompare(b.name)) : []
    },

    devicesLoading () {
      return this.d.loading
    },
  },

  methods: {
    newDevice () {
      window.events.emit('show-new-device-dialog-for-node', this.node);
    },
  },
}
</script>
