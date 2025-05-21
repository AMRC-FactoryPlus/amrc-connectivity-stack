<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="show" @update:open="$emit('update:show', $event)">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Select a Connection</DialogTitle>
        <DialogDescription>Choose how this device will communicate</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="space-y-1">
          <Label>Connection</Label>
          <Select v-model="selectedConnection">
            <SelectTrigger>
              <SelectValue class="text-left" placeholder="Select a connection"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                  v-for="connection in nodeConnections"
                  :key="connection.uuid"
                  :value="connection"
              >
                {{connection.name}}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="$emit('update:show', false)">Cancel</Button>
        <Button type="submit" @click="save" :disabled="!selectedConnection">Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConnectionStore } from '@/store/useConnectionStore'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { toast } from 'vue-sonner'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDeviceStore } from '@/store/useDeviceStore'
import { updateEdgeAgentConfig } from '@/utils/edgeAgentConfigUpdater'
import { storeReady } from '@store/useStoreReady.js'

export default {
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  },

  props: {
    show: Boolean,
    deviceId: String,
    nodeUuid: String,
    currentConnectionUuid: String,
  },

  emits: ['update:show'],

  setup() {
    return {
      s: useServiceClientStore(),
      conn: useConnectionStore(),
      d: useDeviceStore(),
    }
  },

  data() {
    return {
      selectedConnection: null,
    }
  },

  watch: {
    currentConnectionUuid: {
      immediate: true,
      handler(uuid) {
        if (uuid) {
          this.selectedConnection = this.conn.data.find(conn => conn.uuid === uuid) || null
        }
      }
    }
  },

  computed: {
    nodeConnections() {
      return this.conn.data.filter(conn => conn.configuration?.edgeAgent === this.nodeUuid)
    },
  },

  methods: {
    async save() {
      try {
        // Update the device connection
        await this.s.client.ConfigDB.patch_config(
          UUIDs.App.DeviceInformation,
          this.deviceId,
          "merge",
          {
            connection: this.selectedConnection.uuid,
          }
        )

        // Stop and restart the device store to force a refresh
        this.d.stop()
        this.d.start()
        await storeReady(this.d)

        // Update the Edge Agent configuration
        await updateEdgeAgentConfig({
          deviceId: this.deviceId
        })

        toast.success('Connection updated successfully')
        this.$emit('update:show', false)
      } catch (error) {
        console.error(error)
        toast.error('Failed to update connection')
      }
    },
  },

  mounted() {
    this.conn.start()
    this.d.start()
  },
}
</script>