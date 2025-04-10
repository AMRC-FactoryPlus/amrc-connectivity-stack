<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="show" @update:open="handleOpen">
    <DialogContent v-if="show" class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Select a Schema</DialogTitle>
        <DialogDescription>Choose the data model for this device</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="space-y-1">
          <Label>Schema</Label>
          <Select v-model="selectedSchema">
            <SelectTrigger>
              <SelectValue placeholder="Select a schema"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                  v-for="schema in schemas"
                  :key="schema.uuid"
                  :value="schema"
              >
                {{schema.schemaInformation?.name}}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-1">
          <Label>Version</Label>
          <Select v-model="selectedVersion" :disabled="!selectedSchema">
            <SelectTrigger>
              <SelectValue placeholder="Select a version"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                  v-for="version in availableVersions"
                  :key="version"
                  :value="version"
              >
                Version {{version.schemaInformation?.version}}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button :disabled="!selectedSchema || !selectedVersion" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-check"></i>
            <div>Set Schema</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Label,
  },

  computed: {
    schemas () {
      // Group schemas by name
      const schemaGroups = this.schemaStore.data
        .filter(schema => schema.schemaInformation?.name)
        .reduce((groups, schema) => {
          const name = schema.schemaInformation.name;
          if (!groups[name] || parseInt(schema.schemaInformation.version) > parseInt(groups[name].schemaInformation.version)) {
            groups[name] = schema;
          }
          return groups;
        }, {});

      // Convert back to array and sort by name
      return Object.values(schemaGroups)
        .sort((a, b) => a.schemaInformation.name.localeCompare(b.schemaInformation.name));
    },

    availableVersions() {
      if (!this.selectedSchema) return []

      // Sort in descending order
      return this.schemaStore.data
      .filter(schema => schema.schemaInformation?.name === this.selectedSchema.schemaInformation?.name)
      .sort((a, b) => b.schemaInformation?.version - a.schemaInformation?.version)
    }
  },

  watch: {

    show(newVal) {
      if (newVal === true) {
        this.handleOpen(true)
      }
    },

    selectedSchema(newVal) {
      if (newVal && this.availableVersions.length > 0) {
        // Default to highest version when schema is selected
        this.selectedVersion = this.availableVersions[0]
      } else {
        this.selectedVersion = null
      }
    }
  },

  mounted () {
    this.d.start()
    this.setInitialSchema()
  },

  methods: {
    setInitialSchema () {
      if (this.currentSchemaUuid) {
        const currentSchema  = this.schemaStore.data.find(s => s.uuid === this.currentSchemaUuid)
        this.selectedSchema  = currentSchema
        // Find and select the current version
        this.selectedVersion = currentSchema
      }
    },

    handleOpen (e) {
      if (e === false) {
        this.resetForm()
        this.$emit('update:show', false)
      }
      else {
        this.$emit('update:show', true)
        this.setInitialSchema()
      }
    },

    resetForm() {
      this.selectedSchema = null
      this.selectedVersion = null
    },

    async formSubmit() {
      // Only download config if we're changing from an existing schema
      if (this.currentSchemaUuid) {
        this.$emit('download-config')
        toast.info('Changing a schema clears device configuration, so we\'ve downloaded the old configuration for you as a backup.')
      }

      try {
        // When changing schema, we need to clear the origin map
        // First, update the schema
        await this.s.client.ConfigDB.patch_config(
          UUIDs.App.DeviceInformation,
          this.deviceId,
          "merge",
          { schema: this.selectedVersion.uuid }
        )

        // Then clear the origin map
        await this.s.client.ConfigDB.patch_config(
          UUIDs.App.DeviceInformation,
          this.deviceId,
          "merge",
          { originMap: null }
        )

        // Refresh the device data by restarting the device store
        this.d.stop()
        this.d.start()
        await storeReady(this.d)

        // Store the selected version UUID before resetting the form
        const selectedVersionUuid = this.selectedVersion.uuid

        // Reset the form completely
        this.resetForm()

        // Emit schema-changed event to notify parent component
        this.$emit('schema-changed', selectedVersionUuid)
        this.$emit('update:show', false)
      } catch (err) {
        toast.error('Unable to update schema')
        console.error(err)
      }
    },
  },

  data () {
    return {
      selectedSchema: null,
      selectedVersion: null,
    }
  },
}
</script>