<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="loadingDetails"/>
    <div v-else class="flex flex-col gap-4">
      <DetailCard
          badge="Status?"
          :text="cluster.name"
          text-tooltip="The name of the cluster"
          :detail="cluster.sparkplug"
          detail-icon="bolt-lightning"
          detail-tooltip="The Sparkplug name of the cluster"
      >
        <template #action>
          <Button size="sm" class="flex items-center justify-center gap-2" @click="copyBootstrap">
            <span class="hidden md:inline">Bootstrap</span>
            <i v-if="copyingBootstrap" class="fa-solid fa-circle-notch animate-spin"></i>
            <i v-else class="fa-solid fa-rocket"></i>
          </Button>
        </template>
      </DetailCard>
      <Tabs default-value="nodes" class="flex flex-col">
        <div class="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="nodes">
              {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}
            </TabsTrigger>
            <TabsTrigger value="deployments" disabled>
              Deployments
            </TabsTrigger>
            <TabsTrigger value="hosts" :disabled="cluster.hosts.length === 0">
              {{cluster.hosts.length ? `${cluster.hosts.length} Host${cluster.hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="nodes">
          <div v-if="nodes.length > 0">
            <DataTable :data="nodes" :columns="nodeColumns" :filters="[]" @rowClick="selectNode"/>
          </div>
        </TabsContent>
        <TabsContent value="deployments">
        </TabsContent>
        <TabsContent value="hosts">
          <DataTable :data="cluster.hosts" :columns="hostColumns" :filters="[]">
            <template #toolbar-left>
              <div class="text-xl font-semibold">{{`${cluster.hosts.length} Host${cluster.hosts.length > 1 ? 's' : ''}`}}</div>
            </template>
          </DataTable>
        </TabsContent>
      </Tabs>
    </div>
  </EdgeContainer>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import EdgePageSkeleton from '@components/EdgeManager/EdgePageSkeleton.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@components/ui/label/index.js'
import { Input } from '@components/ui/input/index.js'
import { Button } from '@components/ui/button/index.js'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { hostColumns } from './hostColumns.ts'
import { nodeColumns } from './nodeColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert/index.js'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import DetailCard from '@components/DetailCard.vue'

export default {
  components: {
    DetailCard,
    AlertDescription,
    Alert,
    AlertTitle,
    DataTable,
    Button,
    CardContent,
    Card,
    Input,
    Label,
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
    EdgePageSkeleton
  },

  setup () {
    return {
      e: useEdgeClusterStore(),
      s: useNodeStore(),
      hostColumns,
      nodeColumns,
    }
  },

  watch: {
    async '$route.params.clusteruuid' (newUuid) {

      await this.getClusterDetails(newUuid)

    },
  },

  mounted () {
    this.getClusterDetails(this.$route.params.clusteruuid)
  },

  methods: {
    selectNode(e) {
      this.$router.push({
        name: 'Node',
        params: {
          nodeuuid: e.original.uuid,
          clusteruuid: e.original.cluster
        },
      })
    },
    copy (text) {
      navigator.clipboard.writeText(text)
      toast.success('Text copied to clipboard')
    },
    async copyBootstrap () {
      this.copyingBootstrap = true
      try {
        const bootstrapResponse = await useServiceClientStore().client.Fetch.fetch({
          service: UUIDs.Service.Clusters,
          url: `v1/cluster/${this.$route.params.clusteruuid}/bootstrap-url`,
        })
        console.log(bootstrapResponse)
        const bootstrap = bootstrapResponse[1]
        if (bootstrap.data) {
          this.copyingBootstrap = false
          this.copy(`curl ${bootstrap.data} | sh -`)
        }
        else {
          this.copyingBootstrap = false
          toast.error('The bootstrap script is not ready yet. Please wait a few moments and try again.')
        }
      }
      catch {
        this.copyingBootstrap = false
        toast.error('The bootstrap script is not ready yet. Please wait a few moments and try again.')
      }
    },
    async getClusterDetails (uuid) {
      this.loadingDetails = true

      // Get the cluster details here and merge them with the cluster
      // object. We need:
      // - Name & Deployed Helm Chart (we get this from bdb13634-0b3d-4e38-a065-9d88c12ee78d Edge cluster configuration)
      // - The hosts that are assigned to this cluster and their details (we get this from 747a62c9-1b66-4a2e-8dd9-0b70a91b6b75 Edge cluster status)
      // - The Nodes in this cluster, their name, status and\ other information (we get this from useNodeStore)

      this.cluster.uuid = uuid
      this.cluster.name = this.e.data.find(e => e.uuid === uuid)?.name ?? ''

      const edgeClusterConfigResponse = await useServiceClientStore().
        client.
        ConfigDB.
        fetch(`/v1/app/${UUIDs.App.EdgeClusterConfiguration}/object/${this.cluster.uuid}`)

      const edgeClusterConfig = edgeClusterConfigResponse[1]
      this.cluster.sparkplug       = edgeClusterConfig.name
      this.cluster.namespace  = edgeClusterConfig.namespace

      // Get the name of the deployed helm chart from its UUID using the
      // Helm Chart Template App
      const helmChartTemplateAppResponse = await useServiceClientStore().
        client.
        ConfigDB.
        fetch(`/v1/app/${UUIDs.App.HelmChartTemplate}/object/${edgeClusterConfig.chart}`)

      const helmChartTemplate = helmChartTemplateAppResponse[1]

      this.cluster.helmChart = {
        chart: helmChartTemplate.chart,
        source: helmChartTemplate.source,
      }

      // Get the hosts assigned to this cluster and their details using
      // the Edge cluster status app
      const edgeClusterStatusResponse = await useServiceClientStore().
        client.
        ConfigDB.
        fetch(`/v1/app/${UUIDs.App.EdgeClusterStatus}/object/${this.cluster.uuid}`)

      const edgeClusterStatus = edgeClusterStatusResponse[1]

      this.cluster.hosts = edgeClusterStatus?.hosts ?? []

      await this.s.fetch()

      // this.cluster.nodes = this.s.data.filter(e => e.cluster === this.cluster.uuid) ?? []

      this.loadingDetails = false
    },
  },

  computed: {
    nodes () {
      return Array.isArray(this.s.data) ? this.s.data.filter(e => e.cluster === this.cluster.uuid) : []
    },
  },

  data () {
    return {
      copyingBootstrap: false,
      loadingDetails: true,
      cluster: {},
    }
  },
}
</script>