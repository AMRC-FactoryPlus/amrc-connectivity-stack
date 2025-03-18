<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex items-center">
    <div v-if="currentEdgeCluster" class="flex items-center p-3">
      <RouterLink :to="`/edge-clusters/${currentEdgeCluster?.uuid}`">
        <Button title="Go to cluster" variant="ghost" size="sm">
          <i class="fa-solid fa-circle-nodes mr-2"></i>
          {{currentEdgeCluster?.name}}
        </Button>
      </RouterLink>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button title="Go to cluster" variant="ghost" size="plain" class="p-2">
            <div class="flex flex-col">
              <i style="font-size: 9pt" class="fa-solid fa-chevron-up -mb-0.5"></i>
              <i style="font-size: 9pt" class="fa-solid fa-chevron-down -mt-0.5"></i>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <RouterLink :key="edgeCluster.uuid" v-for="edgeCluster in edgeClusters" :to="`/edge-clusters/${edgeCluster.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{edgeCluster.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div v-if="currentNode" class="flex items-center">
      <span class="mr-4">/</span>
      <RouterLink :to="`/edge-clusters/${currentEdgeCluster?.uuid}/nodes/${currentNode?.uuid}`">
        <Button title="Go to node" variant="ghost" size="sm">
          <i class="fa-solid fa-cube mr-2"></i>
          {{currentNode?.name}}
        </Button>
      </RouterLink>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button title="Go to cluster" variant="ghost" size="plain" class="p-2">
            <div class="flex flex-col">
              <i style="font-size: 9pt" class="fa-solid fa-chevron-up -mb-0.5"></i>
              <i style="font-size: 9pt" class="fa-solid fa-chevron-down -mt-0.5"></i>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <RouterLink :key="node.uuid" v-for="node in nodes" :to="`/edge-clusters/${currentEdgeCluster?.uuid}/nodes/${node.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{node.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <!--    TODO: Implement device lookup-->
    <div v-if="currentDevice" class="flex items-center">
      <span class="mr-4">/</span>
      <i class="fa-solid fa-plug mr-2"></i>
      <RouterLink :to="`/edge-clusters/${currentEdgeCluster?.uuid}`">
        <Button title="Go to cluster" variant="ghost" size="plain" class="p-2">{{currentEdgeCluster?.name}}</Button>
      </RouterLink>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button title="Go to cluster" variant="ghost" size="plain" class="p-2">
            <div class="flex flex-col">
              <i style="font-size: 9pt" class="fa-solid fa-chevron-up -mb-0.5"></i>
              <i style="font-size: 9pt" class="fa-solid fa-chevron-down -mt-0.5"></i>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <RouterLink :key="edgeCluster.uuid" v-for="edgeCluster in edgeClusters" :to="`/edge-clusters/${edgeCluster.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{edgeCluster.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
<script>

import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@components/ui/button/index.js'

export default {
  name: 'EdgeBreadcrumbs',

  components: {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  },

  setup () {
    return {
      useEdgeClusterStore,
      useNodeStore,
    }
  },

  computed: {
    route () {
      return this.$route
    },

    // ║  Edge Clusters  ║
    // ╚═════════════════╝
    edgeClusters () {
      return useEdgeClusterStore().data
    },
    currentEdgeCluster () {
      return useEdgeClusterStore().data.find((edgeCluster) => edgeCluster.uuid === this.$route.params.clusteruuid)
    },

    // ║  Nodes  ║
    // ╚═════════╝
    nodes () {
      return useNodeStore().data.filter((node) => node.cluster === this.$route.params.clusteruuid)
    },
    currentNode () {
      if (useNodeStore().data instanceof Array) {
        return useNodeStore().data.find((node) => node.uuid === this.$route.params.nodeuuid)
      }
    },

    // ║  Devices  ║
    // ╚═══════════╝
    currentDevice () {
      return null
    },
  },
}
</script>