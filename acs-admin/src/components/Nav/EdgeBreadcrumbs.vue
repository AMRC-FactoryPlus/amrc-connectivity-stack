<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex items-center">
    <div v-if="currentEdgeCluster" class="flex items-center p-3">
      <RouterLink :to="`/edge-clusters/${currentEdgeCluster?.uuid}`">
        <Button title="Go to cluster" variant="ghost" size="sm">
          <i class="fa-solid fa-circle-nodes mr-2"></i>
          <div :class="!currentNode ? '!font-bold' : ''">{{currentEdgeCluster?.name}}</div>
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
    <span v-if="currentNode">/</span>
    <div v-if="currentNode" class="flex items-center p-3">
      <RouterLink :to="`/edge-clusters/${currentEdgeCluster?.uuid}/nodes/${currentNode?.uuid}`">
        <Button title="Go to node" variant="ghost" size="sm">
          <i class="fa-solid fa-cube mr-2"></i>
          <div :class="!currentDevice ? '!font-bold' : ''">{{currentNode?.name}}</div>
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
    <span v-if="currentDevice">/</span>
    <div v-if="currentDevice" class="flex items-center p-3">
      <RouterLink :to="`/edge-clusters/${currentEdgeCluster?.uuid}/nodes/${currentNode?.uuid}/devices/${currentDevice?.uuid}`">
        <Button title="Go to device" variant="ghost" size="sm">
          <i class="fa-solid fa-plug mr-2"></i>
          <div class="!font-bold">{{currentDevice?.name}}</div>
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
          <RouterLink :key="device.uuid"
              v-for="device in devices"
              :to="`/edge-clusters/${currentEdgeCluster?.uuid}/nodes/${currentNode?.uuid}/devices/${device?.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{device.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
<script>

import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
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
      useDeviceStore,
    }
  },

  mounted () {
    useNodeStore().start()
  },

  computed: {
    route () {
      return this.$route
    },

    // ║  Edge Clusters  ║
    // ╚═════════════════╝
    edgeClusters () {
      return useEdgeClusterStore().data.toSorted((a, b) => a.name.localeCompare(b.name))
    },
    currentEdgeCluster () {
      return useEdgeClusterStore().data.find((edgeCluster) => edgeCluster.uuid === this.$route.params.clusteruuid)
    },

    // ║  Nodes  ║
    // ╚═════════╝
    nodes () {
      return useNodeStore().data.filter((node) => node.deployment?.cluster === this.$route.params.clusteruuid).toSorted((a, b) => a.name.localeCompare(b.name))
    },
    currentNode () {
      if (useNodeStore().data instanceof Array) {
        return useNodeStore().data.find((node) => node.uuid === this.$route.params.nodeuuid)
      }
    },

    // ║  Devices  ║
    // ╚═══════════╝
    devices () {
      return useDeviceStore().data.filter((device) => device.deviceInformation?.node === this.$route.params.nodeuuid).toSorted((a, b) => a.name.localeCompare(b.name))
    },
    currentDevice () {
      if (useDeviceStore().data instanceof Array) {
        return useDeviceStore().data.find((device) => device.uuid === this.$route.params.deviceuuid)
      }
    },
  },
}
</script>
