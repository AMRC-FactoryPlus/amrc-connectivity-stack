<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex items-center">
    <div v-if="currentEdgeCluster" class="flex items-center p-3">
      <RouterLink :to="`/edge-cluster/${currentEdgeCluster?.uuid}`">
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
          <DropdownMenuLabel>Edge Clusters</DropdownMenuLabel>
          <DropdownMenuSeparator/>
          <RouterLink :key="edgeCluster.uuid" v-for="edgeCluster in otherEdgeClusters" :to="`/edge-cluster/${edgeCluster.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{edgeCluster.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
<!--    TODO: Implement node lookup-->
    <div v-if="currentEdgeNode" class="flex items-center">
      <span class="mr-4">/</span>
      <i class="fa-solid fa-cube mr-2"></i>
      <RouterLink :to="`/edge-cluster/${currentEdgeCluster?.uuid}`">
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
          <DropdownMenuLabel>Edge Clusters</DropdownMenuLabel>
          <DropdownMenuSeparator/>
          <RouterLink :key="edgeCluster.uuid" v-for="edgeCluster in otherEdgeClusters" :to="`/edge-cluster/${edgeCluster.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{edgeCluster.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
<!--    TODO: Implement device lookup-->
    <div v-if="currentEdgeDevice" class="flex items-center">
      <span class="mr-4">/</span>
      <i class="fa-solid fa-plug mr-2"></i>
      <RouterLink :to="`/edge-cluster/${currentEdgeCluster?.uuid}`">
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
          <DropdownMenuLabel>Edge Clusters</DropdownMenuLabel>
          <DropdownMenuSeparator/>
          <RouterLink :key="edgeCluster.uuid" v-for="edgeCluster in otherEdgeClusters" :to="`/edge-cluster/${edgeCluster.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{edgeCluster.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
<script>

import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
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
    }
  },

  computed: {
    route () {
      return this.$route
    },
    currentEdgeCluster () {
      return useEdgeClusterStore().data.find((edgeCluster) => edgeCluster.uuid === this.$route.params.clusteruuid)
    },
    otherEdgeClusters () {
      return useEdgeClusterStore().data.filter((edgeCluster) => edgeCluster.uuid !== this.$route.params.clusteruuid)
    },
    // TODO: Implement node and device lookup
    currentEdgeNode () {
      return null
      return useEdgeClusterStore().data.find((edgeCluster) => edgeCluster.uuid === this.$route.params.clusteruuid)
    },
    otherEdgeNodes () {
      return null
      return useEdgeClusterStore().data.filter((edgeCluster) => edgeCluster.uuid !== this.$route.params.clusteruuid)
    },
    currentEdgeDevice () {
      return null
      return useEdgeClusterStore().data.find((edgeCluster) => edgeCluster.uuid === this.$route.params.clusteruuid)
    },
    otherEdgeDevices () {
      return null
      return useEdgeClusterStore().data.filter((edgeCluster) => edgeCluster.uuid !== this.$route.params.clusteruuid)
    }
  },
}
</script>