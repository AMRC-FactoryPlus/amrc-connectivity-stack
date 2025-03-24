<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="nodeLoading"/>
    <div v-else class="flex flex-col gap-4 flex-1 h-full">
      <div class="flex items-center justify-center gap-2">
        <DetailCard
            class="w-3/5 flex items-center justify-center"
            :text="node.name"
            text-tooltip="The name of the node"
            :detail="node.sparkplug?.node_id"
            detail-icon="bolt-lightning"
            detail-tooltip="The Sparkplug name of the Node"
            :second-detail="node.uuid"
            second-detail-icon="hashtag"
            second-detail-tooltip="The UUID of the Node"
        />
        <DetailCard
            class="w-2/5 flex items-center justify-center"
            titleIcon="server"
            title="Host"
            :text="hostname"
            text-tooltip="The physical name of the host that this node is running on"
            :detail="cluster"
            detail-icon="circle-nodes"
            detail-tooltip="The cluster that this host is part of"
        />
      </div>
      <div class="flex-1">
        <DataTable v-if="devices.length > 0" :data="devices" :columns="deviceColumns" :filters="[]"/>
<!--          <template #toolbar-left>-->
<!--            <div class="text-xl font-semibold">{{`${devices.length} Device${devices.length > 1 ? 's' : ''}`}}</div>-->
<!--          </template>-->
<!--        </DataTable>-->
        <EmptyState
            v-else
            :title="`No devices found for ${node.name}`"
            :description="`No devices have been added to the ${node.name} node yet.`"
            :button-text="`Add Device`"
            button-icon="plus"
            @button-click="newDevice"/>
      </div>
    </div>
  </EdgeContainer>
</template>

<script>
import { useNodeStore } from '@store/useNodeStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import { Label } from '@components/ui/label/index.js'
import { Input } from '@components/ui/input/index.js'
import { Button } from '@components/ui/button/index.js'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import EdgePageSkeleton from '@components/EdgeManager/EdgePageSkeleton.vue'
import { inop } from '@utils/inop.js'
import DetailCard from '@components/DetailCard.vue'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { deviceColumns } from './deviceColumns.ts'
import EmptyState from '@/components/EmptyState.vue'

export default {
  components: {
    DataTable,
    DetailCard,
    EdgePageSkeleton,
    Button,
    CardContent,
    Card,
    Input,
    Label,
    EdgeContainer,
    CardDescription,
    CardFooter,
    CardTitle,
    CardHeader,
    Copyable,
    EmptyState,
  },

  setup () {
    return {
      c: useEdgeClusterStore(),
      n: useNodeStore(),
      d: useDeviceStore(),
      inop,
      deviceColumns,
    }
  },

  computed: {
    node () {
      return this.n.data.find(e => e.uuid === this.$route.params.nodeuuid)
    },

    nodeLoading () {
      return !this.n.ready || this.n.loading || !this.node
    },

    cluster() {
      return this.c.data.find(e => e.uuid === this.node.cluster)?.name
    },

    devices () {
      return Array.isArray(this.d.data) ? this.d.data.filter(e => e.node === this.node.uuid) : []
    },

    hostname() {
      return this.node.hostname ?? 'Floating'
    },
  },

  methods: {
    newDevice () {
      window.events.emit('show-new-device-dialog-for-node', this.node)
    },
  },
}
</script>