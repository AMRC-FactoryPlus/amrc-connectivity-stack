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
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'

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
  },

  setup () {
    return {
      s: useServiceClientStore(),
      schemaStore: useSchemaStore(),
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
    selectedSchema(newVal) {
      if (newVal && this.availableVersions.length > 0) {
        // Default to highest version when schema is selected
        this.selectedVersion = this.availableVersions[0]
      } else {
        this.selectedVersion = null
      }
    }
  },

  methods: {
    handleOpen (e) {
      if (e === false) {
        this.selectedSchema = null
        this.selectedVersion = null
        this.$emit('update:show', false)
      }
    },

    async formSubmit () {
      try {
        await this.s.client.ConfigDB.put_config(UUIDs.App.DeviceInformation, this.deviceId, {
          schema: this.selectedVersion.uuid,
        })

        toast.success('Schema updated successfully')
        this.$emit('update:show', false)
      }
      catch (err) {
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
  }
}
</script>