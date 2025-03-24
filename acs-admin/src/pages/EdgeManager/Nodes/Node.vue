<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="nodeLoading"/>
    <div v-else class="flex h-full">
      <!-- Main content -->
      <div class="flex-1 flex flex-col gap-4 pr-4">
        <div class="flex-1">
          <Tabs v-if="!nodeLoading" default-value="devices" class="flex flex-col flex-1">
            <div class="flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="devices">
                  {{devices.length ? `${devices.length}  Device${devices.length > 1 ? 's' : ''}` : 'No Devices'}}
                </TabsTrigger>
                <TabsTrigger value="connections" disabled>
                  Connections
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="devices" class="flex-1 ">
              <div v-if="devices.length > 0">
                <DataTable v-if="devices.length > 0" :data="devices" :columns="deviceColumns" :filters="[]" @rowClick="selectDevice"/>
              </div>
              <EmptyState
                  v-else
                  :title="`No devices found for ${node.name}`"
                  :description="`No devices have been added to the ${node.name} node yet.`"
                  :button-text="`Add Device`"
                  button-icon="plus"
                  @button-click="newDevice"/>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="w-96 border-l border-border -my-4 -mr-4">
        <div class="flex items-center justify-start gap-2 p-4 border-b">
          <i :class="`fa-fw fa-solid fa-cube`"></i>
          <div class="font-semibold text-xl">{{ node.name }}</div>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="key"
              label="Node UUID"
              :value="node.uuid"
          />
          <SidebarDetail
              icon="bolt-lightning"
              label="Sparkplug Node ID"
              :value="node.sparkplug"
          />
          <SidebarDetail
              v-if="node.createdAt"
              :title="node.createdAt"
              icon="clock"
              label="Created"
              :value="moment(node.createdAt).fromNow()"
          />
        </div>
        <div class="font-semibold text-lg p-4 border-b">Cluster Details</div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="circle-nodes"
              label="Cluster"
              :value="cluster"
          />
          <SidebarDetail
              icon="server"
              label="Host"
              :value="hostname"
          />

        </div>
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Copyable from '@components/Copyable.vue'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import EdgePageSkeleton from '@components/EdgeManager/EdgePageSkeleton.vue'
import { inop } from '@utils/inop.js'
import DetailCard from '@components/DetailCard.vue'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { deviceColumns } from './deviceColumns.ts'
import EmptyState from '@/components/EmptyState.vue'
import SidebarDetail from '@/components/SidebarDetail.vue'
import moment from 'moment'
import { toast } from 'vue-sonner'

export default {
  components: {
    Tabs,
    SidebarDetail,
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
    TabsContent,
    TabsList,
    TabsTrigger,
  },

  setup () {
    return {
      c: useEdgeClusterStore(),
      n: useNodeStore(),
      d: useDeviceStore(),
      inop,
      deviceColumns,
      moment,
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

    selectDevice(e) {
      const cluster = this.n.data?.find(f => f.uuid === e.original.node)?.cluster;

      if (!cluster) {
        toast.error('Device has no cluster')
        return
      }

      this.$router.push({
        name: 'Device',
        params: {
          clusteruuid: cluster,
          nodeuuid: e.original.node,
          deviceuuid: e.original.uuid,
        },
      })
    },
  },
}
</script>