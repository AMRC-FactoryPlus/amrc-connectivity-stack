<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
    <EdgePageSkeleton v-if="loadingDetails"/>
    <div v-else class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <DetailCard
            class="w-1/3 flex items-center justify-center"
            title="Details"
            title-icon="id-badge"
            text="[Name]"
            text-tooltip="The name of the device"
            detail="[Instance_UUID]"
            detail-icon="hashtag"
            detail-tooltip="The Instance_UUID of the device"
            :action="inop"
            action-tooltip="Change the device name"
            action-icon="edit"
        />
        <DetailCard
            class="w-1/3 flex items-center justify-center"
            title="Schema"
            title-icon="code"
            text="[Schema Type]"
            text-tooltip="The schema that the device is using"
            detail="[Version]"
            detail-icon="square-v"
            detail-tooltip="The version of the schema that this device is using"
            :action="inop"
            action-tooltip="Change the schema name"
            action-icon="edit"
        />
        <DetailCard
            class="w-1/3 flex items-center justify-center"
            title="Device Connection"
            title-icon="ethernet"
        >
          [Dropdown here to show connections]
        </DetailCard>
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
  },

  setup () {
    return {
      n: useNodeStore(),
      d: useDeviceStore(),
      inop,
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