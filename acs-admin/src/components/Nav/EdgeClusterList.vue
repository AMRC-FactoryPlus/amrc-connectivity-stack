<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <SidebarMenuItem v-for="cluster in clusters" :key="cluster.uuid" v-if="clusters.length">
    <Collapsible :defaultOpen="false" class="group/collapsible-cluster">
      <RouterLink :to="`/edge-clusters/${cluster.uuid}`">
        <Button
            title="View Cluster"
            size="sm"
            variant="ghost"
            class="w-full text-left justify-start"
        >
          <div class="flex items-center justify-center gap-2">
            <CollapsibleTrigger as-child>
              <div title="Show nodes for this cluster" @click.stop.prevent class="flex items-center justify-center size-5 group/collapsible-trigger">
                <i class="group-hover/collapsible-trigger:text-gray-900 text-gray-500 fa-solid fa-chevron-right text-xs transition-transform duration-75 group-data-[state=open]/collapsible-cluster:rotate-90"></i>
              </div>
            </CollapsibleTrigger>
            <i :class="`fa-solid fa-circle-nodes`"></i>
            <span>{{cluster.name}}</span>
          </div>
        </Button>
      </RouterLink>
      <CollapsibleContent>
        <SidebarMenuSub>
          <NodeList :cluster/>
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>
  <Button @click="newCluster" class="flex items-center justify-center gap-1 text-gray-400 my-1" variant="ghost" size="sm">
    <i class="fa-solid fa-plus"></i>
    <span>New Cluster</span>
  </Button>
</template>

<script>

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@components/ui/button'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import NodeList from './NodeList.vue'
import { useObjectStore } from '@store/useObjectStore.js'
import { useDriverStore } from '@store/useDriverStore.js'
import { useDeploymentStore } from '@store/useDeploymentStore.js'
import { useHelmChartStore } from '@store/useHelmChartStore.js'

export default {

  setup () {
    return {
      obj: useObjectStore(),
      c: useEdgeClusterStore(),
      n: useNodeStore(),
      d: useDeviceStore(),
      dr: useDriverStore(),
      dp: useDeploymentStore(),
      hc: useHelmChartStore(),
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
    NodeList,
  },

  computed: {
    clusters () {
      return this.c.data.toSorted((a, b) => a.name.localeCompare(b.name))
    },
  },

  async mounted () {
    await this.n.start()
    await this.c.start()
    await this.d.start()
    await this.dr.start()
    await this.dp.start()
    await this.hc.start()
  },

  methods: {
    newCluster() {
      window.events.emit('show-new-cluster-dialog');
    }
  }
}
</script>
