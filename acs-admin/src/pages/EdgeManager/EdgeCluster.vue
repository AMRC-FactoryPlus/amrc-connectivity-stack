<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <div v-if="loadingDetails">LOADING</div>
    <Tabs v-else default-value="details">
      <div class="flex items-center justify-between gap-2">
        <TabsList class="mb-6">
          <TabsTrigger value="details">
            Details
          </TabsTrigger>
          <TabsTrigger value="deployments" disabled>
            Deployments
          </TabsTrigger>
          <TabsTrigger value="hosts" :disabled="cluster.hosts.length === 0">
            {{cluster.hosts.length ? `${cluster.hosts.length} Host${cluster.hosts.length > 1 ? "s" : ""}` : "No Hosts"}}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="details">
        <div>
          <div>
            <label for="clusterName" class="font-semibold">Cluster Name</label>
            <div class="flex items-center gap-2">
              <Input disabled name="clusterName" :default-value="cluster.name" />
              <Button variant="ghost" @click="() => copy(cluster.name)">Copy</Button>
            </div>
          </div>
          <div class="mt-4">
            <label for="helmChart" class="font-semibold">Helm Chart</label>
            <div class="flex items-center gap-2">
              <Input disabled name="helmChart" :default-value="cluster.helmChart.chart" />
              <Button variant="ghost" @click="() => copy(cluster.helmChart.chart)">Copy</Button>
            </div>
          </div>
        </div>
        <div v-if="nodes.length > 0" class="mt-8">
          <DataTable :data="nodes" :columns="nodeColumns" :filters="[]">
            <template #toolbar-left>
              <div class="text-xl font-semibold">{{`${nodes.length} Node${nodes.length > 1 ? "s" : ""}`}}</div>
            </template>
          </DataTable>
        </div>
      </TabsContent>
      <TabsContent value="deployments">
      </TabsContent>
      <TabsContent value="hosts">
        <DataTable :data="cluster.hosts" :columns="hostColumns" :filters="[]">
          <template #toolbar-left>
            <div class="text-xl font-semibold">{{`${cluster.hosts.length} Host${cluster.hosts.length > 1 ? "s" : ""}`}}</div>
          </template>
        </DataTable>
      </TabsContent>
    </Tabs>
    <template #header>
      <div class="flex bg-white items-center justify-between gap-2">
        <Button>Status</Button>
        <Button>Copy Bootstrap</Button>
      </div>
    </template>
  </EdgeContainer>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useNodeStore } from '@store/useNodeStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import PermissionList from "@pages/AccessControl/Permissions/PermissionList.vue";
import PrincipalList from "@pages/AccessControl/PrincipalList.vue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import LinkUserDialog from "@pages/AccessControl/LinkUserDialog.vue";
import GroupList from "@pages/AccessControl/GroupList.vue";
import {Label} from "@components/ui/label/index.js";
import {Input} from "@components/ui/input/index.js";
import {Card, CardContent} from "@components/ui/card/index.js";
import {Button} from "@components/ui/button/index.js";
import DataTable from "@components/ui/data-table/DataTable.vue";
import { hostColumns } from './hostColumns.ts'
import { nodeColumns } from './nodeColumns.ts'
import {Alert, AlertDescription, AlertTitle} from "@components/ui/alert/index.js";
import {toast} from "vue-sonner";

export default {
  components: {
    AlertDescription, Alert, AlertTitle,
    DataTable,
    Button,
    CardContent,
    Card,
    Input,
    Label,
    GroupList,
    LinkUserDialog,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    PrincipalList,
    PermissionList,
    EdgeContainer
  },

  setup () {
    return {
      s: useNodeStore(),
      hostColumns,
      nodeColumns,
    }
  },

  watch: {
    async '$route.params.clusteruuid' (newUuid) {

      await this.getClusterDetails(newUuid)

    },

    test: {
      handler (newVal, oldVal) {
        // console.log('test', newVal)
      },
      deep: true,
      immediate: true,
    }
  },

  mounted () {
    this.getClusterDetails(this.$route.params.clusteruuid)
  },

  methods: {
    copy (text) {
      navigator.clipboard.writeText(text)
      toast.success('Text copied to clipboard')
    },
    async getClusterDetails (uuid) {
      this.loadingDetails = true

      // Get the cluster details here and merge them with the cluster
      // object. We need:
      // - Name & Deployed Helm Chart (we get this from bdb13634-0b3d-4e38-a065-9d88c12ee78d Edge cluster configuration)
      // - The hosts that are assigned to this cluster and their details (we get this from 747a62c9-1b66-4a2e-8dd9-0b70a91b6b75 Edge cluster status)
      // - The Nodes in this cluster, their name, status and\ other information (we get this from useNodeStore)

      this.cluster.uuid = uuid;

      const edgeClusterConfigResponse = await useServiceClientStore().client.ConfigDB.fetch(`/v1/app/${UUIDs.App.EdgeClusterConfiguration}/object/${this.cluster.uuid}`)

      const edgeClusterConfig = edgeClusterConfigResponse[1]
      this.cluster.name       = edgeClusterConfig.name
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

      this.cluster.hosts = edgeClusterStatus.hosts

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
      loadingDetails: true,
      cluster: {},
      test: [],
    }
  },
}
</script>