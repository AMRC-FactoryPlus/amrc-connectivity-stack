<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="loadingDetails"/>
    <div v-else class="flex flex-col gap-4">
      <div class="flex items-center justify-center gap-2">
        <DetailCard
            class="w-3/5 flex items-center justify-center"
            :text="node.name"
            text-tooltip="The name of the node"
            :detail="node.sparkplug.node_id"
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
            :text="node.hostname"
            text-tooltip="The physical name of the host that this node is running on"
            :detail="node.clusterDetails.name"
            detail-icon="circle-nodes"
            detail-tooltip="The cluster that this host is part of"
        />
      </div>
      <DataTable :data="node.devices" :columns="deviceColumns" :filters="[]">
<!--        <template #toolbar-left>-->
<!--          <div class="text-xl font-semibold">{{`${node.devices.length} Device${node.devices.length > 1 ? 's' : ''}`}}</div>-->
<!--        </template>-->
      </DataTable>
    </div>
  </EdgeContainer>
</template>

<script>
import { useNodeStore } from '@store/useNodeStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import { Label } from '@components/ui/label/index.js'
import { Input } from '@components/ui/input/index.js'
import { Button } from '@components/ui/button/index.js'
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
import DetailCard from '@components/DetailCard.vue'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { deviceColumns } from './deviceColumns.ts'

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