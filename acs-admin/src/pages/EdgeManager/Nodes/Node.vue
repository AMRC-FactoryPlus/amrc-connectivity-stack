<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="nodeLoading"/>
    <div v-else class="flex h-full min-h-0">
      <!-- Main content -->
      <div class="flex-1 min-w-0 flex flex-col gap-4 pr-4 -my-4 py-4 overflow-y-auto">
        <div class="flex-1">
          <Tabs default-value="devices" class="flex flex-col flex-1 h-full">
            <TabsContent value="devices" class="flex-1">
              <div>
                <DataTable :data="devices" :columns="deviceColumns" :filters="deviceFilters" :default-sort="initialNameSort" @rowClick="selectDevice">
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
                        v-if="can.newDevice"
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
                        :button-text="can.newDevice ? 'Add Device' : null"
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
                      :button-text="can.newConnection ? 'Add Connection' : null"
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
                      v-if="can.newConnection"
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
      <div class="w-96 shrink-0 border-l border-border -my-4 -mr-4 overflow-y-auto">
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
              :warning="hostWarning"
          >
            <template #action>
              <MoveHostButton
                  labelled
                  :uuid="node.uuid"
                  :name="node.name"
                  kind="node"
                  :deployment="node.deployment"
              />
            </template>
            <template #badge>
              <StaleHostPill v-if="hostWarning"/>
            </template>
          </SidebarDetail>

        </div>
        <!-- Only for people the Cluster Manager says may delete it. -->
        <div v-if="deletePlan.allowed" class="p-4 border-t">
          <Button variant="destructiveOutline" size="sm" class="w-full gap-2" :disabled="deleting" @click="deleteNode">
            <i :class="deleting ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-trash'"></i>
            Delete node
          </Button>
        </div>
      </div>
    </div>
  </EdgeContainer>
</template>

<script>
import { useNodeStore } from '@store/useNodeStore.js'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useISA95Store } from '@store/useISA95Store.js'
import { placement_state } from '@/lib/isa95-placement.js'
import { useConnectionStore } from '@store/useConnectionStore.js'
import { useAccessStore } from '@store/useAccessStore.js'
import { can_new_connection, can_new_device, can_rebirth } from '@/lib/access/perms-edge.js'
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
import MoveHostButton from '@components/EdgeManager/Nodes/MoveHostButton.vue'
import StaleHostPill from '@components/EdgeManager/Nodes/StaleHostPill.vue'
import { staleHostWarning } from '@utils/hosts.js'
import moment from 'moment'
import { toast } from 'vue-sonner'
import { useDialog } from '@/composables/useDialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { delete_message, delete_node, node_delete_plan } from '@/lib/node-delete.js'

export default {
  components: {
    Tabs,
    SidebarDetail,
    MoveHostButton,
    StaleHostPill,
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
    const d = useDeviceStore()

    return {
      access: useAccessStore(),
      c: useEdgeClusterStore(),
      n: useNodeStore(),
      d,
      cn: useConnectionStore(),
      isa95: useISA95Store(),
      inop,
      deviceColumns,
      connectionColumns,
      moment,
    }
  },

  mounted () {
    this.cn.start();
    // The device list shows each device's placement, and its i3X access
    // column grants through these nodes.
    this.isa95.start();
  },

  watch: {
    /* Ask again whenever the page shows a different node. */
    deleteKey: {
      immediate: true,
      handler () { this.loadDeletePlan() },
    },
  },

  computed: {
    can () {
      const c = this.access.check
      return {
        newDevice: can_new_device(c),
        newConnection: can_new_connection(c),
      }
    },

    node () {
      return this.n.data.find(e => e.uuid === this.$route.params.nodeuuid)
    },

    deleteKey () {
      return `${this.node?.deployment?.cluster ?? ''}/${this.node?.uuid ?? ''}`
    },

    nodeLoading () {
      return !this.n.ready || this.n.loading || !this.node
    },

    clusterObject () {
      return this.c.data.find(e => e.uuid === this.node.deployment?.cluster)
    },

    cluster() {
      return this.clusterObject?.name
    },

    devices () {
      const filtered = Array.isArray(this.d.data) ? this.d.data.filter(e => e.deviceInformation?.node === this.node.uuid) : []
      // Null until the vocabulary loads, so nothing shows as broken.
      const vocab = this.isa95.ready ? this.isa95.vocabulary : null
      return filtered.map(d => ({
        ...d,
        _nodeAddress: this.node.sparkplugAddress,
        _canRebirth: can_rebirth(this.access.check, d.uuid),
        _placement: vocab ? placement_state(vocab, d.placement, d.uuid) : null,
      }))
    },

    deviceFilters () {
      return [{
        name: 'UNS',
        property: 'uns',
        options: [
          { label: 'On UNS', value: 'on' },
          { label: 'Not on UNS', value: 'off' },
        ],
      }]
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

    hostWarning() {
      return staleHostWarning(this.clusterObject, this.node.deployment?.hostname)
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

    /* Ask the Cluster Manager whether this person may delete the node,
     * and what would go with it. */
    async loadDeletePlan () {
      const cluster = this.node?.deployment?.cluster
      const uuid = this.node?.uuid
      if (!cluster || !uuid) {
        this.deletePlan = { allowed: false }
        return
      }
      await serviceClientReady()
      const plan = await node_delete_plan(useServiceClientStore().client, cluster, uuid)
      /* The page may have moved on to another node meanwhile. */
      if (this.node?.uuid === uuid) this.deletePlan = plan
    },

    async deleteNode () {
      const cluster = this.node.deployment?.cluster
      const name = this.node.name
      /* Show what is there now, not what was there when the page opened. */
      await this.loadDeletePlan()
      if (!this.deletePlan.allowed) {
        toast.error('You can no longer delete this node.')
        return
      }
      useDialog({
        title: 'Delete this node?',
        message: delete_message(name, this.cluster, this.deletePlan),
        confirmText: 'Delete node',
        onConfirm: async () => {
          this.deleting = true
          try {
            await delete_node(useServiceClientStore().client, cluster, this.node.uuid)
            toast.success(`Deleting ${name}. It leaves the cluster within a minute or two.`)
            this.$router.push({ name: 'Cluster', params: { clusteruuid: cluster } })
          }
          catch (err) {
            toast.error(err.message)
          }
          finally {
            this.deleting = false
          }
        },
      })
    },
  },

  data () {
    return {
      deletePlan: { allowed: false },
      deleting: false,
    }
  },
}
</script>
