<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="node" @update:open="handleOpen">
    <DialogContent v-if="node" class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{existingConnection ? 'Edit Connection' : 'Create a New Connection'}}</DialogTitle>
        <DialogDescription>{{existingConnection ? 'Edit connection in' : 'Create a new connection in'}} the {{node.name}} node</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-3 overflow-auto flex-1 fix-inset">
        <!-- Driver Selection -->
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="host">Driver</label>
          <Select :disabled="existingConnection" name="host" v-model="selectedDriverName">
            <SelectTrigger>
              <SelectValue>
                {{selectedDriverName ?? 'Select a Driver...'}}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="driver in sortedDrivers" :value="driver.name" :key="driver.uuid">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-medium">{{driver.name}}</div>
                    <div v-if="driver.image" class="flex items-center justify-center gap-1.5 text-gray-400">
                      <i class="fa-solid fa-cube text-sm"></i>
                      <div>Split</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <!-- Driver-specific form fields -->
        <JSONFormElement
          v-for="key in orderedFormFields"
          :key="key"
          :element="{
            ...formSchema.properties[key],
            key: key,
            required: formSchema.required?.includes(key)
          }"
          v-model="formData[key]"
          :formData="formData"
          :onEncrypt="encryptSensitiveInfo"
          @change="handleFormChange"
        />

        <!-- Payload Format (only shown after driver selection) -->
        <div v-if="selectedDriverName" class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="payloadFormat">Payload Format</label>
          <Select name="payloadFormat" v-model="formData.payloadFormat">
            <SelectTrigger>
              <SelectValue placeholder="Select a Payload Format...">
                {{ formData.payloadFormat }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="format in PAYLOAD_FORMATS" :value="format" :key="format">
                  {{ format }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button 
          :disabled="v$.$invalid || isSubmitting" 
          @click="createConnection"
        >
          <div class="flex items-center justify-center gap-2">
            <i :class="{
              'fa-solid': true,
              'fa-pen': existingConnection && !isSubmitting,
              'fa-plus': !existingConnection && !isSubmitting,
              'fa-circle-notch': isSubmitting,
              'animate-spin': isSubmitting
            }"></i>
            <div>{{isSubmitting ? 'Saving...' : (existingConnection ? 'Update Connection' : 'Create Connection')}}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { VisuallyHidden } from 'reka-ui'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDriverStore } from '@store/useDriverStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import JSONFormElement from '@/components/ui/form/JSONFormElement.vue'
import { useVuelidate } from '@vuelidate/core'
import { required } from '@vuelidate/validators'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { toast } from 'vue-sonner'
import _ from 'lodash'
import { useConnectionStore } from '@store/useConnectionStore.js'

const PAYLOAD_FORMATS = [
  "Defined by Protocol",
  "Delimited String",
  "JSON",
  "XML",
  "Buffer"
];

export default {

  setup () {
    const v$ = useVuelidate()

    return {
      v$,
      s: useServiceClientStore(),
      c: useEdgeClusterStore(),
      dr: useDriverStore(),
      cn: useConnectionStore(),
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
    DialogTrigger,
    VisuallyHidden,
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    JSONFormElement
  },

  watch: {
    selectedDriverName(newVal, oldVal) {
      // Only reset if actually changing drivers
      if (newVal !== oldVal && oldVal !== null) {
        this.resetFormWithDefaults()
      }
    }
  },

  mounted () {
    window.events.on('show-new-connection-dialog-for-node', async ({
      node,
      existingConnection,
    }) => {
      if (existingConnection?.configuration) {

        this.existingConnection = existingConnection
        const existingConfig    = existingConnection.configuration
        this.selectedDriverName = this.dr.data.find(d => d.uuid === existingConfig.driver_uuid)?.name
        this.formData           = {
          ...existingConfig.config,
          payloadFormat: existingConfig.source.payloadFormat,
        }
      }

      this.node = node
    })
  },

  computed: {
    sortedDrivers() {
      return [...this.dr.data].sort((a, b) => a.name.localeCompare(b.name))
    },
    selectedDriver () {
      return this.dr.data.find(d => d.name === this.selectedDriverName)
    },
    formSchema() {
      const baseSchema = this.selectedDriver?.definition?.schema || {};
      
      // Only include payloadFormat in schema if driver is selected
      return this.selectedDriverName ? {
        ...baseSchema,
        properties: {
          ...baseSchema.properties
        },
        required: [
          ...(baseSchema.required || []),
          'payloadFormat'
        ]
      } : baseSchema;
    },
    orderedFormFields() {
      if (!this.formSchema?.properties) return []

      return Object.entries(this.formSchema.properties)
        .sort(([, a], [, b]) => {
          const orderA = a.options?.order ?? Infinity
          const orderB = b.options?.order ?? Infinity
          return orderA - orderB
        })
        .map(([key]) => key)
    },
    rules() {
      return {
        ...this.selectedDriver?.definition?.schema?.required?.reduce((acc, field) => {
          acc[field] = { required }
          return acc
        }, {}),
        payloadFormat: { required }
      }
    }
  },

  validations() {
    return {
      selectedDriverName: { required },
      formData: this.rules
    }
  },

  methods: {
    async encryptSensitiveInfo(value) {
      if (!this.node) throw new Error('No node selected')
      
      // Generate a unique identifier for this sensitive info
      const key = '__FPSI__' + crypto.randomUUID()
      const cluster = this.node.cluster;
      const namespace = this.c.data.find(c => c.uuid === cluster)?.namespace;

      if (!namespace) throw new Error('No namespace found for cluster')

      const name = 'edge-agent-sensitive-information-' + this.node.uuid;

      await this.s.client.Fetch.fetch({
        service: UUIDs.Service.Clusters,
        // url: `v1/cluster/${this.node.cluster}/secret/${this.node.namespace}/edge-agent-sensitive-information-${this.node.uuid}/${key}`,
        url: `v1/cluster/${cluster}/secret/${namespace}/${name}/${key}`,
        method: 'PUT',
        contentType: 'application/octet-stream',
        body: value
      })

      return key
    },

    resetFormWithDefaults() {
      this.formData = {
        payloadFormat: "Defined by Protocol"
      }

      if (!this.selectedDriver?.definition?.schema?.properties) return

      const { properties } = this.selectedDriver.definition.schema

      Object.entries(properties).forEach(([key, prop]) => {
        if ('default' in prop) {
          this.formData[key] = prop.default
        }
      })

      this.v$.$reset()
    },

    handleFormChange(event) {
      const newFormData = _.cloneDeep(this.formData);
      
      if (event.value === "") {
        delete newFormData[event.field];
      } else {
        const fieldSchema = this.selectedDriver?.definition?.schema?.properties[event.field];
        newFormData[event.field] = fieldSchema?.type === 'number' ? Number(event.value) : event.value;
      }

      // Update the entire form data object at once
      this.formData = newFormData;

      this.validationState[event.field] = event.valid;
      this.errors = Object.values(this.validationState).some(valid => !valid);
    },

    resetForm() {
      this.selectedDriverName = null
      this.formData = {
        payloadFormat: "Defined by Protocol"
      }
      this.errors = false
      this.validationState = {}
      this.isSubmitting = false
      this.existingConnection = null
      this.v$.$reset()
    },

    async createConnection() {
      if (this.isSubmitting) return
      
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      this.isSubmitting = true

      try {
        const {
                payloadFormat,
                ...configData
              } = _.cloneDeep(this.formData)

        if (this.existingConnection) {
          // Update existing connection
          await this.s.client.ConfigDB.patch_config(UUIDs.App.ConnectionConfiguration, this.existingConnection.uuid, 'merge',  // Add this parameter
            {
              config: configData,
              driver_uuid: this.selectedDriver.uuid,
              source: {
                payloadFormat: payloadFormat,
              },
              topology: {
                cluster: this.node.cluster,
                host: this.node.hostname,
              },
            })

          toast.success(`Connection updated successfully!`)
        }
        else {
          // Create new connection
          const connectionName = `${this.selectedDriverName}-${crypto.randomUUID()} (${this.node.name})`
          const connectionUUID = await this.s.client.ConfigDB.create_object(UUIDs.Class.EdgeAgentConnection)

          // Create the info config first
          await this.s.client.ConfigDB.put_config(UUIDs.App.Info, connectionUUID, {
            name: connectionName,
          })

          // Then create the connection configuration
          const payload = {
            createdAt: new Date().toISOString(),
            config: configData,
            deployment: {},
            driver: this.selectedDriver.uuid,
            edgeAgent: this.node.uuid,
            source: {
              payloadFormat: payloadFormat,
            },
            topology: {
              cluster: this.node.cluster,
              host: this.node.hostname,
            },
          }

          await this.s.client.ConfigDB.put_config(UUIDs.App.ConnectionConfiguration, connectionUUID, payload)

          toast.success(`Connection created successfully!`)
        }

        this.handleOpen(false)
        this.resetForm()
      } catch (err) {
        toast.error(this.existingConnection ? 'Unable to update connection' : 'Unable to create new connection')
        console.error(err)
      } finally {
        this.isSubmitting = false
      }
    },

    handleOpen(e) {
      if (e === false) {
        this.node = null
        if (this.existingConnection) {
          this.selectedDriverName = null
        }
      }
    },
  },

  data () {
    return {
      node: null,
      selectedDriverName: null,
      formData: {
        payloadFormat: "Defined by Protocol"
      },
      errors: false,
      validationState: {},
      PAYLOAD_FORMATS,
      isSubmitting: false,
      existingConnection: null,
    }
  },
}
</script>
