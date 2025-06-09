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
          <Tabs default-value="devices" class="flex flex-col flex-1 h-full">
            <TabsContent value="devices" class="flex-1">
              <div>
                <DataTable :data="devices" :columns="deviceColumns" :filters="[]" :default-sort="initialNameSort" @rowClick="selectDevice">
                  <template #toolbar-left>
                    <div class="flex items-center justify-between gap-2">
                      <TabsList>
                        <TabsTrigger value="devices">
                          {{devices.length ? `${devices.length}  Device${devices.length > 1 ? 's' : ''}` : 'No Devices'}}
                        </TabsTrigger>
                        <TabsTrigger value="connections">
                          {{connections.length ? `${connections.length}  Connection${connections.length > 1 ? 's' : ''}` : 'No Connections'}}
                        </TabsTrigger>
                      </TabsList>
                    </div>
                  </template>
                  <template #toolbar-right>
                    <Button
                        @click="newDevice"
                        size="sm"
                        class="ml-auto hidden lg:flex items-center justify-center gap-1.5"
                    >
                      <i class="fa-solid fa-plus"></i>
                      Add Device
                    </Button>
                  </template>
                  <template #empty>
                    <EmptyState
                        title="No Devices"
                        :description="`No devices have been added to the ${node.name} node yet.`"
                        :button-text="`Add Device`"
                        button-icon="plus"
                        @button-click="newDevice"/>
                  </template>
                </DataTable>
              </div>
            </TabsContent>
            <TabsContent value="connections" class="flex-1">
              <DataTable :data="connections" :columns="connectionColumns" :filters="[]" :default-sort="initialNameSort" @rowClick="selectConnection">
                <template #empty>
                  <EmptyState
                      title="No Connections"
                      :description="`No connections have been added to the ${node.name} node yet.`"
                      :button-text="`Add Connection`"
                      button-icon="plus"
                      @button-click="newConnection"/>
                </template>
                <template #toolbar-left>
                  <div class="flex items-center justify-between gap-2">
                    <TabsList>
                      <TabsTrigger value="devices">
                        {{devices.length ? `${devices.length}  Device${devices.length > 1 ? 's' : ''}` : 'No Devices'}}
                      </TabsTrigger>
                      <TabsTrigger value="connections">
                        {{connections.length ? `${connections.length}  Connection${connections.length > 1 ? 's' : ''}` : 'No Connections'}}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </template>
                <template #toolbar-right>
                  <Button
                      @click="newConnection"
                      size="sm"
                      class="ml-auto hidden lg:flex items-center justify-center gap-1.5"
                  >
                    <i class="fa-solid fa-plus"></i>
                    Add Connection
                  </Button>
                </template>
              </DataTable>
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
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useConnectionStore } from '@store/useConnectionStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import { Label } from '@components/ui/label/index.js'
import { Input } from '@components/ui/input/index.js'
import { Button } from '@components/ui/button/index.js'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Copyable from '@components/Copyable.vue'
import EdgePageSkeleton from '@components/EdgeManager/EdgePageSkeleton.vue'
import { inop } from '@utils/inop.js'
import DetailCard from '@components/DetailCard.vue'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { deviceColumns } from './deviceColumns.ts'
import { connectionColumns } from './connectionColumns.ts'
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
      cn: useConnectionStore(),
      inop,
      deviceColumns,
      connectionColumns,
      moment,
    }
  },

  mounted () {
    this.cn.start();
  },

  computed: {
    node () {
      return this.n.data.find(e => e.uuid === this.$route.params.nodeuuid)
    },

    nodeLoading () {
      return !this.n.ready || this.n.loading || !this.node
    },

    cluster() {
      return this.c.data.find(e => e.uuid === this.node.deployment?.cluster)?.name
    },

    devices () {
      return Array.isArray(this.d.data) ? this.d.data.filter(e => e.deviceInformation?.node === this.node.uuid) : []
    },

    connections () {
      return Array.isArray(this.cn.data) 
        ? this.cn.data
            .filter(e => e.configuration?.edgeAgent === this.node.uuid)
        : []
    },

    hostname() {
      return this.node.deployment.hostname ?? 'Floating'
    },

    initialNameSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
  },

  methods: {
    newDevice () {
      window.events.emit('show-new-device-dialog-for-node', this.node)
    },

    newConnection () {
      window.events.emit('show-new-connection-dialog-for-node', {
        node: this.node,
      })
    },

    selectDevice(e) {
      console.log(this.n.data)
      const cluster = this.n.data?.find(f => f.uuid === e.original.deviceInformation.node)?.deployment.cluster;

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

    selectConnection(e) {
      window.events.emit('show-new-connection-dialog-for-node', {
        node: this.node,
        existingConnection: e.original
      })
    },
  },
}
</script>
