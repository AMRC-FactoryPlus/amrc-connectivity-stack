<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <ChangeSchemaDialog
      v-if="device.deviceInformation"
      v-model:show="showSchemaDialog"
      :device-id="device.uuid"
      :current-schema-uuid="device?.deviceInformation.schema"
      @download-config="downloadConfig"
  />
  <EdgeContainer>
    <EdgePageSkeleton v-if="loadingDetails"/>
    <div v-else class="flex h-full gap-4">
      <!-- Main content -->
      <div class="flex-1 flex flex-col gap-4 relative">
        <!-- Speech Bubble -->
        <Transition name="speech">
          <div v-if="robotBeep" 
               class="absolute z-10 left-1/2 top-[32%] transform -translate-x-1/2 bg-white dark:bg-slate-800 px-4 py-2 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
            <div class="text-sm font-medium">{{ robotBeep }}</div>
            <!-- Speech bubble triangle -->
            <div class="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 rotate-45 w-2 h-2 bg-white dark:bg-slate-800 border-r border-b border-slate-200 dark:border-slate-700"></div>
          </div>
        </Transition>
        <EmptyState
            v-if="!device.deviceInformation.schema"
            icon="robot"
            :title="`What is ${device.name}?`"
            description="Get started by assigning this device a schema."
            button-text="Choose Schema"
            button-icon="magnifying-glass"
            @button-click="changeSchema"
        />
        <div v-else>{{device}}</div>
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
              :value="device.deviceInformation.sparkplugName"
          />
          <SidebarDetail
              v-if="device.createdAt"
              :title="device.createdAt"
              icon="clock"
              label="Created"
              :value="moment(device.createdAt).fromNow()"
          />
        </div>
        <div class="flex items-center justify-between gap-2 p-4 border-b">
          <div class="font-semibold text-lg">Schema</div>
          <Button 
              @click="changeSchema" 
              size="sm" 
              :variant="device.deviceInformation.schema ? 'ghost' : 'default'"
              class="flex items-center justify-center gap-2"
          >
              <i :class="`fa-solid ${device.deviceInformation.schema ? 'fa-sync' : 'fa-magnifying-glass'} text-sm`"></i>
              <div class="text-sm">{{device.deviceInformation.schema ? 'Change' : 'Choose'}} Schema</div>
          </Button>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="fas fa-code"
              label="Schema Type"
              :value="schema?.schemaInformation?.name"
          />
          <SidebarDetail
              icon="fas fa-square-v"
              label="Schema Version"
              :value="schema?.schemaInformation?.version"
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
import EmptyState from '@components/EmptyState.vue'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useSchemaStore } from '@store/useSchemaStore.js'
import ChangeSchemaDialog from '@components/EdgeManager/Devices/ChangeSchemaDialog.vue'

export default {
  components: {
    EmptyState,
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
    ChangeSchemaDialog,
  },

  setup () {
    return {
      n: useNodeStore(),
      d: useDeviceStore(),
      sch: useSchemaStore(),
      inop,
      moment,
    }
  },

  watch: {
    async '$route.params.deviceuuid' (newUuid) {
      await this.getDeviceDetails(newUuid)
    },
    
    // Add schema watcher to stop beeping when schema is assigned
    schema(newSchema) {
      if (newSchema) {
        this.stopRobotBeep()
      } else if (!this.beepInterval) {
        this.startRobotBeep()
      }
    }
  },

  mounted () {
    this.getDeviceDetails(this.$route.params.deviceuuid)
    this.startRobotBeep()
    this.sch.start()
  },

  beforeUnmount() {
    this.stopRobotBeep()
  },

  computed: {
    device() {
      return this.d.data.find(e => e.uuid === this.$route.params.deviceuuid) || {}
    },
    
    schema() {
      const schemaUuid = this.device?.deviceInformation?.schema
      if (!schemaUuid) return null
      
      return this.sch.data.find(s => s.uuid === schemaUuid) || null
    }
  },

  methods: {
    downloadConfig() {
      const blob = new Blob([JSON.stringify(this.device, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `device-${this.device.name}-${this.device.uuid}-config.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    },

    changeSchema () {
      this.showSchemaDialog = true
    },

    async getDeviceDetails (uuid) {
      this.loadingDetails = true
      await storeReady(this.d)

      if (!this.device) {
        toast.error('Device not found')
      }

      this.loadingDetails = false
    },

    startRobotBeep() {
      if (this.device?.deviceInformation?.schema && this.device?.deviceInformation?.connection) return

      this.beepInterval = setInterval(() => {
        this.robotBeep = this.robotMessages[this.currentMessageIndex]
        this.currentMessageIndex = (this.currentMessageIndex + 1) % this.robotMessages.length
        setTimeout(() => {
          this.robotBeep = null
        }, 5000)
      }, 15000)
    },

    stopRobotBeep() {
      if (this.beepInterval) {
        clearInterval(this.beepInterval)
        this.beepInterval = null
        this.robotBeep = null
        this.currentMessageIndex = 0  // Reset the index when stopping
      }
    },
  },

  data () {
    return {
      showSchemaDialog: false,
      loadingDetails: true,
      robotBeep: null,
      beepInterval: null,
      currentMessageIndex: 0,
      robotMessages: [
        "Beep Boop! What am I?",
        "ERROR 404: Identity not found",
        "Help! I don't know what I am! 🤖",
        "01001000 01000101 01001100 01010000",
        "Searching for meaning... and schemas... and connections...",
        "I think, therefore I... wait, what am I?",
        "404: Purpose not found",
        "Existential crisis mode: Activated",
      ],
    }
  },
}
</script>

<style scoped>
.speech-enter-active,
.speech-leave-active {
  transition: all 0.1s ease;
}

.speech-enter-from,
.speech-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px) scale(0.95);
}

.speech-enter-to,
.speech-leave-from {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
</style>
