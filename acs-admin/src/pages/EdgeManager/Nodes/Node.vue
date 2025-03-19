<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="loadingDetails"/>
    <div v-else class="flex flex-col gap-4">
      <div class="flex items-center justify-center gap-2">
        <Card class="w-3/5 h-36">
          <CardHeader>
            <div class="flex items-center justify-between gap-1">
              <div class="flex flex-col gap-1">
                <div class="flex mb-2">
                  <div class="px-1.5 py-0.5 rounded-md bg-gray-500 text-sm font-bold uppercase tracking-wide text-white">
                    INOP
                  </div>
                </div>
                <Copyable :text="node.name">
                  <CardTitle title="Node friendly name" class="text-2xl">
                    {{node.name}}
                  </CardTitle>
                </Copyable>
                <Copyable :text="node.name">
                  <div title="Sparkplug Node ID"
                      class="flex items-center justify-center gap-1 text-sm text-gray-600 hover:text-gray-950 bg-gray-100 px-1.5 py-0.5 rounded-md">
                    <i class="fa-solid fa-bolt-lightning"></i>
                    <div>{{node.sparkplug.node_id}}</div>
                  </div>
                </Copyable>
              </div>
            </div>
          </CardHeader>
        </Card>
        <Card class="w-2/5 h-36">
          <CardHeader>
            <div class="flex items-center justify-between gap-1">
              <div class="flex flex-col gap-1">
                <h3 class="text-gray-500 text-sm">
                  <i class="fa-solid fa-server text-xs"></i>
                  Host
                </h3>
                <Copyable :text="node.name">
                  <CardTitle title="Node friendly name" class="text-2xl">
                    {{node.hostname}}
                  </CardTitle>
                </Copyable>
                <Copyable :text="node.clusterDetails.name">
                  <div title="Edge cluster"
                      class="flex items-center justify-center gap-1 text-sm text-gray-600 hover:text-gray-950 bg-gray-100 px-1.5 py-0.5 rounded-md">
                    <i class="fa-solid fa-circle-nodes"></i>
                    <div>{{node.clusterDetails.name}}</div>
                  </div>
                </Copyable>
              </div>
              <Button @click="inop()"
                  title="Change the host or cluster that this node is physically deployed on"
                  variant="ghost"
                  class="flex items-center gap-2">
                <i class="fa-solid fa-arrow-right-arrow-left"></i>
                Move
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
      <div v-if="node.devices.length > 0">
        <DataTable :data="node.devices" :columns="deviceColumns" :filters="[]"/>
      </div>
      <!--      <Tabs default-value="nodes" class="flex flex-col">-->
      <!--        <div class="flex items-center justify-between gap-2">-->
      <!--          <TabsList>-->
      <!--            <TabsTrigger value="nodes">-->
      <!--              {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}-->
      <!--            </TabsTrigger>-->
      <!--            <TabsTrigger value="deployments" disabled>-->
      <!--              Deployments-->
      <!--            </TabsTrigger>-->
      <!--            <TabsTrigger value="hosts" :disabled="cluster.hosts.length === 0">-->
      <!--              {{cluster.hosts.length ? `${cluster.hosts.length} Host${cluster.hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}-->
      <!--            </TabsTrigger>-->
      <!--          </TabsList>-->
      <!--        </div>-->
      <!--        <TabsContent value="nodes">-->
      <!--          <div v-if="nodes.length > 0">-->
      <!--            <DataTable :data="nodes" :columns="nodeColumns" :filters="[]"/>-->
      <!--          </div>-->
      <!--        </TabsContent>-->
      <!--        <TabsContent value="deployments">-->
      <!--        </TabsContent>-->
      <!--        <TabsContent value="hosts">-->
      <!--          <DataTable :data="cluster.hosts" :columns="hostColumns" :filters="[]">-->
      <!--            <template #toolbar-left>-->
      <!--              <div class="text-xl font-semibold">{{`${cluster.hosts.length} Host${cluster.hosts.length > 1 ? 's' : ''}`}}</div>-->
      <!--            </template>-->
      <!--          </DataTable>-->
      <!--        </TabsContent>-->
      <!--      </Tabs>-->
    </div>
  </EdgeContainer>
</template>

<script>
import { useNodeStore } from '@store/useNodeStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import LinkUserDialog from '@pages/AccessControl/LinkUserDialog.vue'
import { Label } from '@components/ui/label/index.js'
import { Input } from '@components/ui/input/index.js'
import { Button } from '@components/ui/button/index.js'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert/index.js'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import { storeReady } from '@store/useStoreReady.js'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useDeviceStore } from '@store/useDeviceStore.js'
import EdgePageSkeleton from '@components/EdgeManager/EdgePageSkeleton.vue'
import { inop } from '@utils/inop.js'
import { deviceColumns } from './deviceColumns.ts'

export default {
  components: {
    EdgePageSkeleton,
    AlertDescription,
    Alert,
    AlertTitle,
    DataTable,
    Button,
    CardContent,
    Card,
    Input,
    Label,
    LinkUserDialog,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    EdgeContainer,
    CardDescription,
    CardFooter,
    CardTitle,
    CardHeader,
    Copyable,
  },

  setup () {
    return {
      c: useEdgeClusterStore(),
      n: useNodeStore(),
      d: useDeviceStore(),
      inop,
      deviceColumns
    }
  },

  watch: {
    async '$route.params.nodeuuid' (newUuid) {
      await this.getNodeDetails(newUuid)

    },
  },

  mounted () {
    this.getNodeDetails(this.$route.params.nodeuuid)
  },

  methods: {
    deviceColumns () {
      return deviceColumns
    },
    async getNodeDetails (uuid) {

      this.loadingDetails = true

      // Get the node details here and merge them with the node
      // object. We need:
      // - The name and the host from the nodeStore
      // - The name of the cluster from the clusterStore, using the uuid on nodeStore
      // - The Sparkplug name from 8e32801b-f35a-4cbf-a5c3-2af64d3debd7 Sparkplug Address Information Application
      // - The list of devices for this node from deviceStore

      await storeReady(this.n)

      // Instantiate the node object as the information that we already
      // have
      this.node = this.n.data.find(e => e.uuid === uuid)


      if (!this.node) {
        toast.error('Node not found')
        this.loadingDetails = false
        return
      }

      // Hydrate the cluster details from the clusterStore using the
      // uuid on nodeStore

      await storeReady(this.c)

      this.node.clusterDetails = this.c.data.find(e => e.uuid === this.node.cluster)

      // Get the Sparkplug information from the Sparkplug Address Information Application

      const sparkplugAddressInfoResponse = await useServiceClientStore().
        client.
        ConfigDB.
        fetch(`/v1/app/${UUIDs.App.SparkplugAddress}/object/${this.node.uuid}`)

      this.node.sparkplug = sparkplugAddressInfoResponse[1]

      // Get the list of devices for this node from the deviceStore

      await storeReady(this.d)

      this.node.devices = this.d.data.filter(e => e.node === this.node.uuid) ?? []

      this.loadingDetails = false
    },
  },

  data () {
    return {
      loadingDetails: true,
      node: {},
    }
  },
}
</script>