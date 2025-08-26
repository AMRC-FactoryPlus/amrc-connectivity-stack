<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <SidebarMenuItem v-for="node in nodes" :key="node.uuid" v-if="nodes.length">
    <Collapsible :defaultOpen="false" class="group/collapsible">
      <!-- TODO: This should navigate to the cluster page when clicked -->
      <!-- TODO: Ctrl+Click should expand instead of click -->
      <RouterLink :to="`/edge-clusters/${cluster.uuid}/nodes/${node.uuid}`">
        <Button
            title="View Node"
            size="sm"
            variant="ghost"
            class="w-full text-left justify-start"
        >
          <div class="flex items-center justify-center gap-2">
            <CollapsibleTrigger as-child>
              <div @click.stop.prevent class="flex items-center justify-center size-5 group/collapsible-trigger">
                <i class="group-hover/collapsible-trigger:text-gray-500 fa-solid fa-chevron-right text-xs transition-transform duration-75 group-data-[state=open]/collapsible:rotate-90"></i>
              </div>
            </CollapsibleTrigger>
            <i :class="`fa-solid fa-cube`"></i>
            <span>{{node.name}}</span>
          </div>
        </Button>
      </RouterLink>
      <CollapsibleContent>
        <SidebarMenuSub>
          <DeviceList :node :cluster/>
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>
</template>

<script>

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@components/ui/button'
import { useNodeStore } from '@store/useNodeStore.js'
import DeviceList from '@/components/Nav/DeviceList.vue'

export default {

  setup () {
    return {
      s: useNodeStore(),
    }
  },

  components: {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarMenuSub,
    Button,
    DeviceList,
  },

  props: {
    cluster: {
      type: Object,
    },
  },

  computed: {
    nodes () {
      return Array.isArray(this.s.data) ? this.s.data.filter(e => e.deployment?.cluster === this.cluster.uuid).toSorted((a, b) => a.name.localeCompare(b.name)) : []
    },

  },

  async mounted () {
    await this.s.start()
  }
}
</script>
