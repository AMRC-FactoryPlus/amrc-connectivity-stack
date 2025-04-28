<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="clusterLoading"/>
    <div v-else class="flex h-full">
      <div class="flex-1 flex flex-col gap-4 pr-4">
        <EmptyState
            v-if="!bootstrapped"
            :title="`Bootstrap Required for ${cluster.name}`"
            description="This edge cluster needs to be bootstrapped before it can be used. Click the button below to copy the bootstrap command to run on the Linux host of the first node in the cluster. Note that it may take a few minutes to show up after running the bootstrap command."
            icon="rocket"
        >
            <template #actions>
                <Button
                    @click="copyBootstrap"
                    :disabled="copyingBootstrap"
                    class="flex items-center justify-center gap-2"
                >
                    <i v-if="copyingBootstrap" class="fa-solid fa-circle-notch animate-spin"></i>
                    <i v-else class="fa-solid fa-rocket"></i>
                    Bootstrap
                </Button>
            </template>
        </EmptyState>
        <Tabs v-else default-value="nodes" class="flex flex-col flex-1 z-50">
          <div>
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
              <DataTable :data="nodes" :columns="nodeColumns" :filters="[]" @rowClick="selectNode">
<!--                <template #toolbar-left>-->
<!--                  <div class="flex items-center justify-between gap-2">-->
<!--                    <TabsList>-->
<!--                      <TabsTrigger value="nodes">-->
<!--                        {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}-->
<!--                      </TabsTrigger>-->
<!--                      <TabsTrigger value="deployments" disabled>-->
<!--                        Deployments-->
<!--                      </TabsTrigger>-->
<!--                      <TabsTrigger value="hosts" :disabled="hosts.length === 0">-->
<!--                        {{hosts.length ? `${hosts.length} Host${hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}-->
<!--                      </TabsTrigger>-->
<!--                    </TabsList>-->
<!--                  </div>-->
<!--                </template>-->
                <template #toolbar-right>
                  <Button
                      @click="newNode"
                      size="sm"
                      class="ml-auto hidden lg:flex items-center justify-center gap-1.5"
                  >
                    <i class="fa-solid fa-plus"></i>
                    Add Node
                  </Button>
                </template>
              </DataTable>
            </div>
            <EmptyState
                v-else
                title="No Nodes"
                :description="`No nodes have been added to the ${cluster.name} cluster yet.`"
                :button-text="`Add Node`"
                button-icon="plus"
                @button-click="newNode"/>
          </TabsContent>
          <TabsContent value="deployments">
          </TabsContent>
          <TabsContent value="hosts">
            <DataTable :data="hosts" :columns="hostColumns" :filters="[]">
<!--              <template #toolbar-left>-->
<!--                <div class="flex items-center justify-between gap-2">-->
<!--                  <TabsList>-->
<!--                    <TabsTrigger value="nodes">-->
<!--                      {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}-->
<!--                    </TabsTrigger>-->
<!--                    <TabsTrigger value="deployments" disabled>-->
<!--                      Deployments-->
<!--                    </TabsTrigger>-->
<!--                    <TabsTrigger value="hosts" :disabled="hosts.length === 0">-->
<!--                      {{hosts.length ? `${hosts.length} Host${hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}-->
<!--                    </TabsTrigger>-->
<!--                  </TabsList>-->
<!--                </div>-->
<!--              </template>-->
            </DataTable>
          </TabsContent>
        </Tabs>
      </div>

      <div class="w-96 border-l border-border -my-4 -mr-4">
        <div class="flex items-center justify-between gap-2 w-full p-4 border-b">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-fw fa-solid fa-circle-nodes"></i>
            <div class="font-semibold text-xl">{{cluster.name}}</div>
          </div>
          <Button v-if="bootstrapped" title="Re-Bootstrap" size="xs" class="flex items-center justify-center gap-2 mr-1" @click="copyBootstrap" variant="ghost">
            <i class="fa-solid fa-refresh text-gray-400" :class="copyingBootstrap ? 'animate-spin' : ''"></i>
          </Button>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="key"
              label="Edge Cluster UUID"
              :value="cluster.uuid"
          />
          <SidebarDetail
              icon="bolt-lightning"
              label="Sparkplug Group ID"
              :value="cluster.sparkplug"
          />
          <SidebarDetail
              v-if="cluster.createdAt"
              :title="cluster.createdAt"
              icon="clock"
              label="Created"
              :value="moment(cluster.createdAt).fromNow()"
          />
        </div>
      </div>
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
import SidebarDetail from '@components/SidebarDetail.vue'
import moment from 'moment'

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
    EdgePageSkeleton,
    SidebarDetail,
  },

  setup () {
    return {
      e: useEdgeClusterStore(),
      n: useNodeStore(),
      hostColumns,
      nodeColumns,
      moment
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
      return this.cluster?.status?.hosts
    },

    bootstrapped () {
      return this.hosts?.length > 0
    },
  },

  methods: {

    newNode () {
      window.events.emit('show-new-node-dialog-for-cluster', this.cluster)
    },

    selectNode: function (e) {
      this.$router.push({
        name: 'Node',
        params: {
          nodeuuid: e.original.uuid,
          clusteruuid: e.original.cluster,
        },
      })
    },

    copy (text, confirmation = 'Text copied to clipboard') {
      navigator.clipboard.writeText(text)
      toast.success(confirmation)
    },
    async copyBootstrap () {
      this.copyingBootstrap = true
      let responseJson
      try {

        const bootstrapResponse = await useServiceClientStore().client.Fetch.fetch({
          service: UUIDs.Service.Clusters,
          url: `v1/cluster/${this.$route.params.clusteruuid}/bootstrap-url`,
          method: 'POST',
        })

        responseJson = await bootstrapResponse.json()

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
        if (responseJson) {
          toast.warning(
            `Unable to copy bootstrap script, likely due to an insecure deployment. Manually run the following command on the edge node to bootstrap the first node of the cluster: ${responseJson}`)
        }
        else {
          toast.error('The bootstrap script is not ready yet. Please wait a few moments and try again.')
        }
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