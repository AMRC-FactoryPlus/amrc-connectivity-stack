<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <BridgesContainer>
    <Skeleton v-if="!bridge.ready" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
    <DataTableSearchable v-else
        :columns="columns"
        :data="bridges"
        :limit-height="false"
        :clickable="true"
        :filters="[]"
        :selected-objects="[]"
        :default-sort="initialSort"
        @row-click="e => bridgeClick(e.original)"
    >
      <template #toolbar-right>
        <Button class="gap-2" @click="newBridge">
          <i class="fa-solid fa-plus"></i>
          <span>New Bridge</span>
        </Button>
      </template>
      <template #empty>
        <EmptyState
            title="No Bridges"
            description="No UNS bridges have been configured yet. Create a bridge to forward messages between your local MQTT broker and remote brokers."
            button-text="New Bridge"
            button-icon="plus"
            @button-click="newBridge"/>
      </template>
    </DataTableSearchable>
    <template v-slot:sidebar>
      <!-- Sidebar -->
      <div v-if="selectedBridge.uuid" class="w-96 border-l border-border -mr-4">
        <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
          <div class="flex items-center gap-2 w-full mr-3">
            <div class="flex items-center gap-2">
              <i class="fa-fw fa-solid fa-arrow-down-up-across-line"></i>
              <div class="font-semibold text-xl">Bridge Details</div>
            </div>
            <Button v-if="selectedBridge.uuid" title="Go to deployment" size="xs" class="flex gap-1 ml-auto" @click="goToDeployment" variant="ghost">
              <i class="fa-solid fa-external-link text-gray-400"></i>
            </Button>
          </div>
        </div>
        <div v-if="selectedBridge.uuid" class="space-y-4 p-4">
          <SidebarDetail
              icon="key"
              label="Bridge UUID"
              :value="selectedBridge.uuid"
          />
          <SidebarDetail
              icon="tag"
              label="Name"
              :value="selectedBridge.name"
          />
          <SidebarDetail
              icon="arrows-left-right"
              label="Type"
              :value="bridgeType"
          />
          <SidebarDetail
              icon="hashtag"
              label="Topics"
              :value="topics"
          />
          <SidebarDetail
              v-if="remoteHost"
              icon="server"
              label="Remote Broker"
              :value="remoteHost"
          />
          <SidebarDetail
              icon="server"
              label="Host"
              :value="selectedBridge.deployment?.hostname ?? 'Floating'"
          />
          <SidebarDetail
              v-if="selectedBridge.deployment?.createdAt"
              icon="clock"
              label="Created"
              :value="moment(selectedBridge.deployment.createdAt).fromNow()"
              :title="selectedBridge.deployment.createdAt"
          />
        </div>
        <div v-else class="p-4 text-gray-400 text-center">
          <p>Select a bridge to view details</p>
        </div>
      </div>
    </template>
  </BridgesContainer>
</template>

<script>
import { Button } from "@components/ui/button/index.js";
import { Skeleton } from "@components/ui/skeleton/index.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import BridgesContainer from '@components/Containers/BridgesContainer.vue';
import { bridgeColumns } from "./bridgeColumns.ts";
import { useBridgeStore } from "@store/useBridgeStore";
import SidebarDetail from "@components/SidebarDetail.vue";
import EmptyState from '@components/EmptyState.vue';
import { ref } from "vue";
import { useRouter } from "vue-router";
import { UUIDs } from "@amrc-factoryplus/service-client";
import moment from 'moment';

export default {
  emits: ['rowClick'],
  name: 'Bridges',
  components: { SidebarDetail, DataTableSearchable, Skeleton, Button, BridgesContainer, EmptyState },

  setup() {
    return {
      selectedBridge: ref({}),
      bridge: useBridgeStore(),
      columns: bridgeColumns,
      router: useRouter(),
      moment,
    }
  },

  async mounted() {
    await this.bridge.start();
  },

  computed: {
    bridges() {
      return this.bridge.data;
    },
    initialSort() {
      return [{
        id: 'name',
        desc: false
      }]
    },
    bridgeType() {
      const hasRemote = this.selectedBridge.deployment?.values?.remote?.host
      return hasRemote ? 'Outgoing' : 'Incoming'
    },
    topics() {
      const topics = this.selectedBridge.deployment?.values?.topics ?? []
      return topics.length > 0 ? topics.join(', ') : 'No topics'
    },
    remoteHost() {
      const remote = this.selectedBridge.deployment?.values?.remote
      if (!remote?.host) return null
      return `${remote.host}:${remote.port || 8883}`
    }
  },

  methods: {
    bridgeClick(bridge) {
      this.selectedBridge = bridge ?? {};
    },
    newBridge() {
      window.events.emit('show-new-bridge-dialog')
    },
    goToDeployment() {
      if (!this.selectedBridge?.uuid) return
      this.router.push({
        name: 'ApplicationObjectEditor',
        params: {
          application: UUIDs.App.EdgeAgentDeployment,
          object: this.selectedBridge.uuid,
        },
      })
    },
  },

  async unmounted() {
    await this.bridge.stop();
  }
}
</script>
