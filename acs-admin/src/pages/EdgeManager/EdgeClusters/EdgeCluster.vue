<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="clusterLoading"/>
    <div v-else class="flex flex-col gap-4 flex-1 h-full">
      <DetailCard
          :text="cluster.name"
          text-tooltip="The name of the cluster"
          :detail="cluster.sparkplug"
          detail-icon="bolt-lightning"
          detail-tooltip="The Sparkplug name of the cluster"
      >
        <template #action>
          <Button size="sm" class="flex items-center justify-center gap-2" @click="copyBootstrap" :variant="bootstrapped ? 'ghost' : 'default'">
            <span v-if="bootstrapped" class="hidden md:inline text-gray-400">Re-Bootstrap</span>
            <span v-else class="hidden md:inline">Bootstrap</span>
            <i v-if="copyingBootstrap" class="fa-solid fa-circle-notch animate-spin" :class="bootstrapped ? 'text-gray-400' : ''"></i>
            <i v-else-if="bootstrapped" class="fa-solid fa-refresh text-gray-400"></i>
            <i v-else class="fa-solid fa-rocket"></i>
          </Button>
        </template>
      </DetailCard>
      <Tabs default-value="nodes" class="flex flex-col flex-1">
        <div class="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="nodes">
              {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}
            </TabsTrigger>
            <TabsTrigger value="deployments" disabled>
              Deployments
            </TabsTrigger>
            <TabsTrigger value="hosts" :disabled="hosts.length === 0">
              {{hosts.length ? `${hosts.length} Host${hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="nodes" class="flex-1 ">
          <div v-if="nodes.length > 0">
            <DataTable :data="nodes" :columns="nodeColumns" :filters="[]" @rowClick="selectNode"/>
          </div>
          <EmptyState
              v-else
              :title="`No nodes found for ${cluster.name}`"
              :description="`No nodes have been added to the ${cluster.name} cluster yet.`"
              :button-text="`Add Node`"
              button-icon="plus"
              @button-click="newNode"/>
        </TabsContent>
        <TabsContent value="deployments">
        </TabsContent>
        <TabsContent value="hosts">
          <DataTable :data="hosts" :columns="hostColumns" :filters="[]">
            <template #toolbar-left>
              <div class="text-xl font-semibold">{{`${hosts.length} Host${hosts.length > 1 ? 's' : ''}`}}</div>
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
import EmptyState from '@components/EmptyState.vue'

export default {
  components: {
    EmptyState,
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
      n: useNodeStore(),
      hostColumns,
      nodeColumns,
    }
  },

  computed: {
    cluster () {
      return this.e.data.find(e => e.uuid === this.$route.params.clusteruuid)
    },

    clusterLoading () {
      return !this.e.ready || this.e.loading
    },

    nodes () {
      return Array.isArray(this.n.data) ? this.n.data.filter(e => e.cluster === this.cluster.uuid) : []
    },

    hosts () {
      return this.cluster.status.hosts
    },

    bootstrapped () {
      return this.hosts.length > 0
    },
  },

  methods: {

    newNode () {
      window.events.emit('show-new-node-dialog-for-cluster', this.cluster)
    },

    selectNode(e) {
      this.$router.push({
        name: 'Node',
        params: {
          nodeuuid: e.original.uuid,
          clusteruuid: e.original.cluster
        },
      })
    },
    copy (text, confirmation = 'Text copied to clipboard') {
      navigator.clipboard.writeText(text)
      toast.success(confirmation)
    },
    async copyBootstrap () {
      this.copyingBootstrap = true
      try {

        const bootstrapResponse = await useServiceClientStore().client.Fetch.fetch({
          service: UUIDs.Service.Clusters,
          url: `v1/cluster/${this.$route.params.clusteruuid}/bootstrap-url`,
          method: 'POST',
        })

        const responseJson = await bootstrapResponse.json()

        if (bootstrapResponse.status) {
          this.copyingBootstrap = false
          this.copy(`curl ${responseJson} | sh -`,
            'The bootstrap script has been copied to clipboard! Run this on the edge node to bootstrap the first node of the cluster.')
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
  },

  data () {
    return {
      copyingBootstrap: false,
    }
  },
}
</script>