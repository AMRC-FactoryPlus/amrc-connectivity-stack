<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="show" @update:open="handleOpen">
    <DialogContent v-if="show" class="sm:max-w-[620px]">
      <DialogHeader>
        <DialogTitle>Select a schema</DialogTitle>
        <DialogDescription>Choose the data model for this device</DialogDescription>
      </DialogHeader>

      <SchemaPicker
          v-model="selectedUuid"
          :schemas="schemaStore.data"
          :devices="d.data"
          latest-only/>

      <div v-if="currentSchemaUuid && selectedUuid !== currentSchemaUuid"
          class="flex items-start gap-2.5 rounded-md bg-amber-50 px-3 py-2.5">
        <i class="fa-solid fa-triangle-exclamation mt-0.5 text-[11px] text-amber-700"></i>
        <div class="text-xs leading-relaxed text-amber-900">
          Changing the schema clears this device's configuration. The old
          configuration is downloaded first as a backup.
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleOpen(false)">Cancel</Button>
        <Button :disabled="!selectedUuid || working" @click="formSubmit">
          <i v-if="working" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
          <i v-else class="fa-solid fa-check mr-2"></i>
          Set schema
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import SchemaPicker from '@components/Schemas/SchemaPicker.vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useSchemaStore } from '@store/useSchemaStore.js'
import { useDeviceStore } from '@/store/useDeviceStore'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { storeReady } from '@store/useStoreReady.js'

export default {
  props: {
    show: {
      type: Boolean,
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    currentSchemaUuid: {
      type: String,
      required: false,
      default: null,
    },
  },

  emits: ['update:show', 'download-config', 'schema-changed'],

  setup () {
    return {
      s: useServiceClientStore(),
      schemaStore: useSchemaStore(),
      d: useDeviceStore(),
    }
  },

  components: {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    SchemaPicker,
  },

  watch: {
    show (open) {
      if (open) this.selectedUuid = this.currentSchemaUuid ?? null
    },
  },

  mounted () {
    this.d.start()
    this.schemaStore.start()
    this.selectedUuid = this.currentSchemaUuid ?? null
  },

  methods: {
    handleOpen (open) {
      if (open) {
        this.selectedUuid = this.currentSchemaUuid ?? null
        this.$emit('update:show', true)
      } else {
        this.selectedUuid = null
        this.$emit('update:show', false)
      }
    },

    async formSubmit () {
      if (this.selectedUuid === this.currentSchemaUuid) {
        this.handleOpen(false)
        return
      }

      /* Changing schema clears the origin map, so hand the old
       * configuration back before it goes. */
      if (this.currentSchemaUuid) {
        this.$emit('download-config')
        toast.info('Changing a schema clears device configuration, so we\'ve downloaded the old configuration for you as a backup.')
      }

      this.working = true
      try {
        await this.s.client.ConfigDB.patch_config(
          UUIDs.App.DeviceInformation, this.deviceId, "merge",
          { schema: this.selectedUuid })

        await this.s.client.ConfigDB.patch_config(
          UUIDs.App.DeviceInformation, this.deviceId, "merge",
          { originMap: null })

        this.d.stop()
        this.d.start()
        await storeReady(this.d)

        const chosen = this.selectedUuid
        this.$emit('schema-changed', chosen)
        this.handleOpen(false)
      } catch (err) {
        toast.error('Unable to update schema')
        console.error(err)
      } finally {
        this.working = false
      }
    },
  },

  data () {
    return {
      selectedUuid: null,
      working: false,
    }
  },
}
</script>
