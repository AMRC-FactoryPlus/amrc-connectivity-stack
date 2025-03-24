<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="loadingDetails"/>
    <div v-else class="flex h-full">
      <!-- Main content -->
      <div class="flex-1 flex flex-col gap-4 pr-4">

      </div>

      <!-- Sidebar -->
      <div class="w-96 border-l border-border -my-4 -mr-4">
        <div class="flex items-center justify-start gap-2 p-4 border-b">
          <i :class="`fa-fw fa-solid fa-microchip`"></i>
          <div class="font-semibold text-xl">{{device.name}}</div>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="fas fa-key"
              label="Device UUID"
              :value="device.uuid"
          />
          <SidebarDetail
              icon="fas fa-bolt-lightning"
              label="Sparkplug Device ID"
              :value="device.sparkplugName"
          />
          <SidebarDetail
              v-if="device.createdAt"
              :title="device.createdAt"
              icon="clock"
              label="Created"
              :value="moment(device.createdAt).fromNow()"
          />
        </div>
        <div class="font-semibold text-lg p-4 border-b">Schema</div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="fas fa-code"
              label="Schema Type"
              :value="device.schemaType"
          />
          <SidebarDetail
              icon="fas fa-square-v"
              label="Schema Version"
              :value="device.schemaVersion"
          />
        </div>
        <div class="font-semibold text-lg p-4 border-b">Connection</div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="fas fa-plug"
              label="Connection"
              :value="device.connection"
          />
        </div>
      </div>
    </div>
  </EdgeContainer>
</template>

<script>
import { useNodeStore } from '@store/useNodeStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'
import { Button } from '@components/ui/button/index.js'
import DetailCard from '@components/DetailCard.vue'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import { storeReady } from '@store/useStoreReady.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import EdgePageSkeleton from '@components/EdgeManager/EdgePageSkeleton.vue'
import { inop } from '@utils/inop.js'
import SidebarDetail from '@/components/SidebarDetail.vue'
import moment from 'moment'

export default {
  components: {
    EdgePageSkeleton,
    Button,
    CardContent,
    Card,
    EdgeContainer,
    CardDescription,
    CardFooter,
    CardTitle,
    CardHeader,
    Copyable,
    DetailCard,
    SidebarDetail,
  },

  setup () {
    return {
      n: useNodeStore(),
      d: useDeviceStore(),
      inop,
      moment,
    }
  },

  watch: {
    async '$route.params.deviceuuid' (newUuid) {
      await this.getDeviceDetails(newUuid)
    },
  },

  mounted () {
    this.getDeviceDetails(this.$route.params.deviceuuid)
  },

  methods: {
    async getDeviceDetails (uuid) {
      this.loadingDetails = true

      await storeReady(this.d)

      // Instantiate the device object as the information that we
      // already have
      this.device = this.d.data.find(e => e.uuid === uuid)

      if (!this.device) {
        toast.error('Device not found')
        this.loadingDetails = false
        return
      }

      // > BEFORE CLOSE - Hydrate the rest of the device information
      // from various stores

      this.loadingDetails = false
    },
  },

  data () {
    return {
      loadingDetails: true,
      device: {},
    }
  },
}
</script>