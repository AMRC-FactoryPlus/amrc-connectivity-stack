<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="clusterLoading"/>
    <div v-else class="flex h-full min-h-0">
      <div class="flex-1 min-w-0 flex flex-col gap-4 pr-4 -my-4 py-4 overflow-y-auto">
        <EmptyState
            v-if="!bootstrapped && depotSetup"
            :title="`${depotSetup.name} is setting up ${cluster.name}`"
            :description="`The Gateway Depot onboarded this gateway, and it is installing K3s and bootstrapping the cluster by itself, so there is nothing to run. This page updates when the cluster reports in, usually within 10 minutes.${depotSetup.step ? ' Now: ' + depotSetup.step + '.' : ''}`"
            icon="circle-notch fa-spin"
        >
            <template #actions>
                <Button variant="outline" as-child>
                    <RouterLink :to="{ name: 'GatewayDepotGateway', params: { id: depotSetup.id } }">
                        <i class="fa-solid fa-server mr-2"></i>Open in the Gateway Depot
                    </RouterLink>
                </Button>
            </template>
        </EmptyState>
        <EmptyState
            v-else-if="!bootstrapped"
            :title="`Bootstrap Required for ${cluster.name}`"
            description="This edge cluster needs to be bootstrapped before it can be used. Click the button below to copy the bootstrap command to run on the Linux host of the first node in the cluster. Note that it may take a few minutes to show up after running the bootstrap command."
            icon="rocket"
        >
            <template #actions>
                <Button
                    v-if="can.bootstrap"
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
          <TabsContent value="nodes" class="flex-1 ">
            <div>
              <DataTable :data="nodes" :columns="nodeColumns" :filters="[]" :default-sort="initialNameSort" @rowClick="selectNode">
                <template #toolbar-left>
                  <div class="flex items-center justify-between gap-2">
                    <TabsList>
                      <TabsTrigger value="nodes">
                        {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}
                      </TabsTrigger>
                      <TabsTrigger value="deployments">
                        {{deployments.length ? `${deployments.length}  Deployment${deployments.length > 1 ? 's' : ''}` : 'No Deployments'}}
                      </TabsTrigger>
                      <TabsTrigger value="hosts" :disabled="hosts.length === 0">
                        {{hosts.length ? `${hosts.length} Host${hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </template>
                <template #toolbar-right>
                  <Button
                      v-if="can.newNode"
                      @click="newNode"
                      size="sm"
                      class="ml-auto hidden lg:flex items-center justify-center gap-1.5"
                  >
                    <i class="fa-solid fa-plus"></i>
                    Add Node
                  </Button>
                </template>
                <template #empty>
                  <EmptyState
                      title="No Nodes"
                      :description="`No nodes have been added to the ${cluster.name} cluster yet.`"
                      :button-text="can.newNode ? 'Add Node' : null"
                      button-icon="plus"
                      @button-click="newNode"/>
                </template>
              </DataTable>
            </div>
          </TabsContent>
          <TabsContent value="deployments">
            <DataTable :data="deployments" :columns="deploymentColumns" :filters="[]" :default-sort="initialNameSort" @rowClick="selectDeployment">
              <template #toolbar-left>
                <div class="flex items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="nodes">
                      {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}
                    </TabsTrigger>
                    <TabsTrigger value="deployments">
                      {{deployments.length ? `${deployments.length}  Deployment${deployments.length > 1 ? 's' : ''}` : 'No Deployments'}}
                    </TabsTrigger>
                    <TabsTrigger value="hosts" :disabled="hosts.length === 0">
                      {{hosts.length ? `${hosts.length} Host${hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}
                    </TabsTrigger>
                  </TabsList>
                </div>
              </template>
              <template #toolbar-right>
                <Button
                    v-if="can.newDeployment"
                    @click="newDeployment"
                    size="sm"
                    class="ml-auto hidden lg:flex items-center justify-center gap-1.5"
                >
                  <i class="fa-solid fa-plus"></i>
                  New Edge Deployment
                </Button>
              </template>
              <template #empty>
                <EmptyState
                    title="No Edge Deployments"
                    :description="`No edge deployments have been added to the ${cluster.name} cluster yet.`"
                    :button-text="can.newDeployment ? 'New Edge Deployment' : null"
                    button-icon="plus"
                    @button-click="newDeployment"/>
              </template>
            </DataTable>
          </TabsContent>
          <TabsContent value="hosts">
            <DataTable :data="hosts" :columns="hostColumns" :filters="[]" :default-sort="initialHostSort">
              <template #toolbar-left>
                <div class="flex items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="nodes">
                      {{nodes.length ? `${nodes.length}  Node${nodes.length > 1 ? 's' : ''}` : 'No Nodes'}}
                    </TabsTrigger>
                    <TabsTrigger value="deployments">
                      {{deployments.length ? `${deployments.length}  Deployment${deployments.length > 1 ? 's' : ''}` : 'No Deployments'}}
                    </TabsTrigger>
                    <TabsTrigger value="hosts" :disabled="hosts.length === 0">
                      {{hosts.length ? `${hosts.length} Host${hosts.length > 1 ? 's' : ''}` : 'No Hosts'}}
                    </TabsTrigger>
                  </TabsList>
                </div>
              </template>
            </DataTable>
          </TabsContent>
        </Tabs>
      </div>

      <div class="w-96 shrink-0 border-l border-border -my-4 -mr-4 overflow-y-auto">
        <div class="flex items-center justify-between gap-2 w-full p-4 border-b">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-fw fa-solid fa-circle-nodes"></i>
            <div class="font-semibold text-xl">{{cluster.name}}</div>
          </div>
          <Button v-if="bootstrapped && can.bootstrap" title="Re-Bootstrap" size="xs" class="flex items-center justify-center gap-2 mr-1" @click="copyBootstrap" variant="ghost">
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
        <!-- Only for people the Cluster Manager says may delete it. -->
        <div v-if="deletePlan.allowed" class="p-4 border-t space-y-2">
          <Button variant="destructiveOutline" size="sm" class="w-full gap-2" :disabled="deleting || deletePlan.online.length > 0" @click="deleteCluster">
            <i :class="deleting ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-trash'"></i>
            Delete cluster
          </Button>
          <p v-if="deletePlan.online.length" class="text-sm text-gray-500">{{ onlineMessage }}</p>
        </div>
      </div>
    </div>
  </EdgeContainer>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useAccessStore } from '@store/useAccessStore.js'
import { can_bootstrap, can_new_deployment, can_new_node, can_rebirth } from '@/lib/access/perms-edge.js'
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
import { deploymentColumns } from './deploymentColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert/index.js'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import DetailCard from '@components/DetailCard.vue'
import EmptyState from '@components/EmptyState.vue'
import SidebarDetail from '@components/SidebarDetail.vue'
import moment from 'moment'
import { useDeploymentStore } from '@store/useDeploymentStore.js'
import { useDepotGatewayStore } from '@store/useDepotGatewayStore.js'
import { depot_setup_of } from '@/lib/gateway-depot/model.js'
import { hostIsKnown } from '@utils/hosts.js'
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import { useDialog } from '@/composables/useDialog'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { cluster_delete_message, cluster_delete_plan, delete_cluster, ONLINE_MESSAGE } from '@/lib/cluster-delete.js'

export default {
  components: {
    DataTableSearchable,
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
    const n = useNodeStore()

    return {
      access: useAccessStore(),
      depotGateways: useDepotGatewayStore(),
      e: useEdgeClusterStore(),
      dp: useDeploymentStore(),
      n,
      hostColumns,
      nodeColumns,
      deploymentColumns,
      moment,
      onlineMessage: ONLINE_MESSAGE,
    }
  },

  watch: {
    /* Ask again whenever the page shows a different cluster. */
    '$route.params.clusteruuid': {
      immediate: true,
      handler () { this.loadDeletePlan() },
    },
  },

  computed: {
    can () {
      const c = this.access.check
      return {
        bootstrap: can_bootstrap(c, this.cluster?.uuid),
        newNode: can_new_node(c),
        newDeployment: can_new_deployment(c),
      }
    },

    cluster () {
      return this.e.data.find(e => e.uuid === this.$route.params.clusteruuid)
    },

    clusterLoading () {
      return !this.e.ready || this.e.loading
    },

    nodes () {
      const filtered = Array.isArray(this.n.data) ? this.n.data.filter(e => e.deployment?.cluster === this.cluster.uuid) : []
      return filtered.map(n => ({
        ...n,
        _canRebirth: can_rebirth(this.access.check, n.uuid),
        _hostStale: !hostIsKnown(this.cluster, n.deployment?.hostname),
      }))
    },

    deployments () {
      const filtered = Array.isArray(this.dp.data) ? this.dp.data.filter(e => e.deployment?.cluster === this.cluster.uuid) : []
      return filtered.map(d => ({
        ...d,
        _hostStale: !hostIsKnown(this.cluster, d.deployment?.hostname),
      }))
    },

    hosts () {
      return this.cluster?.status?.hosts
    },

    bootstrapped () {
      return this.hosts?.length > 0
    },

    /* A gateway the Gateway Depot is setting this cluster up on, if any. */
    depotSetup () {
      return depot_setup_of(this.depotGateways.data, this.cluster?.uuid)
    },

    initialNameSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },

    initialHostSort () {
      return [{
        id: 'hostname',
        desc: false
      }]
    },
  },

  methods: {

    /* Ask the Cluster Manager whether this person may delete the
     * cluster, whether it is still online, and what would go with it. */
    async loadDeletePlan () {
      const uuid = this.$route.params.clusteruuid
      if (!uuid) {
        this.deletePlan = { allowed: false, online: [] }
        return
      }
      await serviceClientReady()
      const plan = await cluster_delete_plan(useServiceClientStore().client, uuid)
      /* The page may have moved on to another cluster meanwhile. */
      if (this.$route.params.clusteruuid === uuid) this.deletePlan = { online: [], ...plan }
    },

    async deleteCluster () {
      const uuid = this.cluster.uuid
      const name = this.cluster.name
      /* Show what is there now, not what was there when the page opened. */
      await this.loadDeletePlan()
      if (!this.deletePlan.allowed) {
        toast.error('You can no longer delete this cluster.')
        return
      }
      if (this.deletePlan.online.length) {
        toast.error(ONLINE_MESSAGE)
        return
      }
      useDialog({
        title: 'Delete this cluster?',
        message: cluster_delete_message(name, this.deletePlan),
        confirmText: 'Delete cluster',
        destructive: true,
        onConfirm: async () => {
          this.deleting = true
          try {
            await delete_cluster(useServiceClientStore().client, uuid)
            toast.success(`Deleting ${name}. It leaves the cluster list within a few minutes.`)
            this.$router.push('/')
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

    newNode () {
      window.events.emit('show-new-node-dialog-for-cluster', this.cluster)
    },

    newDeployment () {
      window.events.emit('show-new-deployment-dialog-for-cluster', this.cluster)
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

    selectDeployment: function (e) {
      this.$router.push({
        name: 'ApplicationObjectEditor',
        params: {
          application: UUIDs.App.EdgeAgentDeployment,
          object: e.original.uuid,
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
            `Unable to copy bootstrap script, likely due to an insecure deployment. Manually run the following command on the edge node to bootstrap the first node of the cluster: curl ${responseJson} | sh -`)
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
      deletePlan: { allowed: false, online: [] },
      deleting: false,
      /* Whether this page started the depot gateway store. */
      startedDepot: false,
    }
  },

  mounted () {
    if (!this.depotGateways.rxsub) {
      this.startedDepot = true
      this.depotGateways.start()
    }
  },

  unmounted () {
    if (this.startedDepot) this.depotGateways.stop()
  },
}
</script>