<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex items-center">
    <div class="flex items-center p-3">
      <i class="fa-solid fa-circle-nodes mr-2"></i>
      <RouterLink :to="`/edge-cluster/${currentEdgeCluster.uuid}`">
        <Button title="Go to cluster" variant="ghost" size="plain" class="p-2">{{currentEdgeCluster.name}}</Button>
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
          <RouterLink :key="edgeCluster.uuid" v-for="edgeCluster in useEdgeClusterStore().data" :to="`/edge-cluster/${edgeCluster.uuid}`">
            <DropdownMenuItem>{{edgeCluster.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>

    </div>
    /
    <div class="border p-3 border-black">Node</div>
    <div class="border p-3 border-black">Device</div>
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
    currentEdgeCluster () {
      return useEdgeClusterStore().data.find((edgeCluster) => edgeCluster.uuid === this.$route.params.uuid)
    },
  },
}
</script>