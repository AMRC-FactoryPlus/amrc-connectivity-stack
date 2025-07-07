<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="node" @update:open="handleOpen">
    <DialogContent v-if="node">
      <DialogHeader>
        <DialogTitle>{{existingConnection ? 'Edit Connection' : 'Create a New Connection'}}</DialogTitle>
        <DialogDescription>{{existingConnection ? 'Edit connection in' : 'Create a new connection in'}} the {{node.name}} node</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-3 overflow-auto flex-1 fix-inset">
        <!-- Connection Name -->
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Connection Name <span class="text-red-500">*</span></label>
          <Input
              placeholder="e.g. Machine Connection"
              v-model="v$.name.$model"
              :v="v$.name"
              required
          />
        </div>
        <!-- Driver Selection -->
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="host">Driver <span class="text-red-500">*</span></label>
          <Select :disabled="existingConnection" name="host" v-model="v$.selectedDriverName.$model">
            <SelectTrigger :class="{'border-red-500': v$.selectedDriverName.$error}">
              <SelectValue>
                {{v$.selectedDriverName.$model ?? 'Select a Driver...'}}
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
          <div v-if="v$.selectedDriverName.$error" class="text-sm text-red-500 mt-1">
            Please select a driver
          </div>
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
          v-model="v$.formData[key].$model"
          :formData="formData"
          :onEncrypt="encryptSensitiveInfo"
          :v="v$.formData[key]"
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

        <!-- Poll Interval (in milliseconds) - only for polled drivers -->
        <div v-if="selectedDriver?.definition?.polled === true" class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="pollInt">Poll Interval (ms) <span class="text-red-500">*</span></label>
          <Input
            type="number"
            info="The interval in milliseconds between device polls"
            name="pollInt"
            :v="v$.pollInt"
            v-model="v$.pollInt.$model"
            min="1"
            required
          />
        </div>
      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <div class="flex w-full items-center justify-between">
          <!-- Delete button - only show when editing -->
          <Button
            v-if="existingConnection"
            variant="destructiveGhost"
            :disabled="isSubmitting || isDeleting"
            @click="deleteConnection"
          >
            <div class="flex items-center justify-center gap-2">
              <i :class="{
                'fa-solid': true,
                'fa-trash': !isDeleting,
                'fa-circle-notch': isDeleting,
                'animate-spin': isDeleting
              }"></i>
              <div>{{ isDeleting ? 'Deleting...' : 'Delete Connection' }}</div>
            </div>
          </Button>
          <!-- Spacer when not editing -->
          <div v-else></div>

          <!-- Existing save button -->
          <Button
            :disabled="v$.$invalid || isSubmitting"
            @click="save"
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
        </div>
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

// Function to sanitize connection names for Kubernetes compatibility
function sanitizeConnectionName(name) {
  if (!name) return name;
  // Replace spaces and other non-alphanumeric characters with hyphens
  // Convert to lowercase and ensure it follows RFC 1123 subdomain naming rules
  return name.toLowerCase()
    .replace(/[^a-z0-9-\.]/g, '-')
    .replace(/^[^a-z0-9]+/, '') // Ensure it starts with alphanumeric
    .replace(/[^a-z0-9]+$/, ''); // Ensure it ends with alphanumeric
}
import { helpers, required, minLength } from '@vuelidate/validators'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { toast } from 'vue-sonner'
import _ from 'lodash'
import { useConnectionStore } from '@store/useConnectionStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { updateEdgeAgentConfig } from '@utils/edgeAgentConfigUpdater.js'

const PAYLOAD_FORMATS = [
  "Defined by Protocol",
  "Delimited String",
  "JSON",
  "JSON (Batched)",
  "XML",
  "Buffer"
];

export default {

  setup () {

    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      c: useEdgeClusterStore(),
      dr: useDriverStore(),
      cn: useConnectionStore(),
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
      // Reset form when driver changes
      if (newVal !== oldVal && !this.existingConnection) {
        if (newVal) {
          this.resetFormWithDefaults()
        } else {
          // When clearing driver selection, reset the form
          this.resetForm()
        }
      }
    }
  },

  mounted () {
    window.events.on('show-new-connection-dialog-for-node', async ({
      node,
      existingConnection,
    }) => {
      // Reset the form first to clear any previous state
      this.resetForm()

      if (existingConnection?.configuration) {
        // If editing an existing connection, populate the form
        this.existingConnection = existingConnection
        const existingConfig    = existingConnection.configuration
        this.v$.selectedDriverName.$model = this.dr.data.find(d => d.uuid === existingConfig.driver_uuid)?.name
        this.v$.name.$model = existingConnection.name
        this.pollInt = existingConfig.pollInt || 1000 // Load existing poll interval or default to 1000ms
        this.formData = {
          ...existingConfig.config,
          // Make sure we handle different possible structures for the payload format
          payloadFormat: existingConfig.source?.payloadFormat || "Defined by Protocol",
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
    // Removed isPolledDriver computed property to avoid recursive updates
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

  },

  validations() {
    // Create a validation rules object
    const rules = {
      selectedDriverName: { required },
      name: {
        required,
        // Only allow characters that are valid for Kubernetes resource names
        // This will prevent issues with LocalSecret resources
        kubernetesNameSafe: helpers.withMessage(
          'Only letters, numbers, hyphens, and dots are allowed. Must start and end with an alphanumeric character.',
          (value) => {
            if (!value) return true; // Skip validation if empty (required will catch this)
            // RFC 1123 subdomain pattern - lowercase alphanumeric, hyphens and dots
            // Must start and end with alphanumeric
            return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(value.toLowerCase());
          }
        ),
      },
      pollInt: {
        requiredWhenPolled: helpers.withMessage(
          'Poll interval is required for polled drivers',
          (value) => !this.selectedDriver?.definition?.polled || value !== null
        ),
        numeric: helpers.withMessage(
          'Must be a number',
          (value) => !isNaN(parseFloat(value)) && isFinite(value)
        ),
        min: helpers.withMessage(
          'Must be at least 0',
          (value) => parseInt(value) >= 0
        )
      },
      formData: {}
    }

    // Initialize formData if it doesn't exist
    if (!this.formData) {
      console.debug('Initializing formData')
      this.formData = {
        payloadFormat: "Defined by Protocol"
      }
    }

    // Only add form field validations if we have a schema
    if (this.formSchema?.properties) {
      // For each property in the schema
      Object.entries(this.formSchema.properties).forEach(([key, schema]) => {
        // Create an empty validation object for this field
        rules.formData[key] = {}

        // Add required validation if field is in required array
        if (this.formSchema.required?.includes(key)) {
          // For boolean fields (checkboxes), we need special handling
          if (schema.type === 'boolean') {
            // For checkboxes, we'll consider them valid if they have a default value
            // or if they've been explicitly set (even to false)
            rules.formData[key].required = helpers.withMessage(
              `${schema.title || key} is required`,
              (value) => {
                // If the field has a default value, consider it valid
                if ('default' in schema) {
                  return true;
                }
                // Otherwise, check if it's been explicitly set (not undefined)
                return value !== undefined;
              }
            )
          } else {
            // For non-boolean fields, use the standard required validator
            rules.formData[key].required = helpers.withMessage(
              `${schema.title || key} is required`,
              required
            )
          }
        }

        // Add minLength validation if specified
        if (schema.minLength) {
          rules.formData[key].minLength = helpers.withMessage(
            `Minimum length is ${schema.minLength}`,
            minLength(schema.minLength)
          )
        }

        // Add pattern validation if specified
        if (schema.pattern) {
          rules.formData[key].pattern = helpers.withMessage(
            schema.options?.patternmessage || `Must match pattern: ${schema.pattern}`,
            helpers.regex(new RegExp(schema.pattern))
          )
        }

        // Add numeric validation for number types
        if (schema.type === 'number') {
          rules.formData[key].numeric = helpers.withMessage(
            'Must be a number',
            (value) => value === null || value === '' || (!isNaN(parseFloat(value)) && isFinite(value))
          )

          // Add min/max validations if specified
          if (schema.minimum !== undefined) {
            rules.formData[key].min = helpers.withMessage(
              `Minimum value is ${schema.minimum}`,
              (value) => value === null || value === '' || parseFloat(value) >= schema.minimum
            )
          }

          if (schema.maximum !== undefined) {
            rules.formData[key].max = helpers.withMessage(
              `Maximum value is ${schema.maximum}`,
              (value) => value === null || value === '' || parseFloat(value) <= schema.maximum
            )
          }
        }
      })
    }

    return rules
  },

  methods: {
    random() {
      if (crypto.randomUUID)
        return crypto.randomUUID();

      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      return buf.toHex();
    },

    async encryptSensitiveInfo(value) {
      if (!this.node) throw new Error('No node selected')

      // Generate a unique identifier for this sensitive info
      const key = '__FPSI__' + this.random()
      const cluster = this.node.deployment.cluster;
      const config = this.c.data.find(c => c.uuid === cluster)
      const namespace = config?.configuration?.namespace;

      console.debug("Node: %o, cluster: %o, config: %o, ns: %o",
          this.node, cluster, config, namespace);

      if (!namespace) throw new Error('No namespace found for cluster')

      const name = 'edge-agent-sensitive-information-' + this.node.uuid;

      await this.s.client.Fetch.fetch({
        service: UUIDs.Service.Clusters,
        // url: `v1/cluster/${this.node.cluster}/secret/${this.node.namespace}/edge-agent-sensitive-information-${this.node.uuid}/${key}`,
        url: `v1/cluster/${cluster}/secret/${namespace}/${name}/${key}`,
        method: 'PUT',
        body: value,
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      })

      return key
    },

    resetFormWithDefaults() {
      // First reset the validation state
      this.v$.$reset()

      // Initialize with default payload format
      this.formData = {
        payloadFormat: "Defined by Protocol"
      }

      if (!this.selectedDriver?.definition?.schema?.properties) return

      const { properties } = this.selectedDriver.definition.schema

      // Initialize all fields with appropriate default values
      Object.entries(properties).forEach(([key, prop]) => {
        // For boolean fields, initialize with false if no default
        if (prop.type === 'boolean') {
          this.formData[key] = 'default' in prop ? prop.default : false
        } else {
          // For other fields, initialize with empty string
          this.formData[key] = ''
        }
      })

      // Then apply defaults from schema for non-boolean fields
      Object.entries(properties).forEach(([key, prop]) => {
        if ('default' in prop && prop.type !== 'boolean') {
          this.formData[key] = prop.default
        }
      })

      // After setting defaults, touch all fields to trigger validation
      this.$nextTick(() => {
        if (this.v$.formData) {
          Object.keys(this.formData).forEach(key => {
            if (this.v$.formData[key]) {
              // For boolean fields with default values, we need to mark them as dirty and valid
              const prop = properties[key];
              if (prop.type === 'boolean' && 'default' in prop) {
                this.v$.formData[key].$touch();
                // Force the field to be considered valid
                this.v$.formData[key].$commit();
              } else {
                // For other fields, just touch them
                this.v$.formData[key].$touch();
              }
            }
          })
        }
      })
    },

    handleFormChange(event) {
      // Get the field schema to determine the type
      const fieldSchema = this.selectedDriver?.definition?.schema?.properties[event.field];

      // Convert value to the appropriate type
      let typedValue = event.value;
      if (event.value !== "" && fieldSchema?.type === 'number') {
        typedValue = Number(event.value);
      } else if (fieldSchema?.type === 'boolean') {
        // For boolean fields, ensure the value is a boolean
        typedValue = Boolean(event.value);
      }

      // Update the form data directly
      this.formData[event.field] = typedValue;

      // Touch the field to trigger validation
      this.$nextTick(() => {
        if (this.v$.formData && this.v$.formData[event.field]) {
          this.v$.formData[event.field].$touch();
        }
      });
    },

    resetForm() {
      // First reset the validation state
      this.v$.$reset()

      // Reset all form fields
      this.v$.selectedDriverName.$model = null
      this.v$.name.$model = null
      this.pollInt = 1000 // Reset to default 1000ms
      this.formData = {
        payloadFormat: "Defined by Protocol"
      }
      this.isSubmitting = false
      this.existingConnection = null
    },

    async save() {
      if (this.isSubmitting) return

      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      this.isSubmitting = true

      try {
        const {
                payloadFormat,
                ...configData
              } = _.cloneDeep(this.formData)

        // Store the original name for display purposes
        const originalName = this.name;
        // Sanitize the name for Kubernetes compatibility
        const sanitizedName = sanitizeConnectionName(originalName);

        console.debug('Connection name:', originalName);
        console.debug('Sanitized name for Kubernetes:', sanitizedName);

        if (this.existingConnection) {

          // Update existing connection - update both info and configuration
          await Promise.all([
            // Update the name in Info app
            this.s.client.ConfigDB.patch_config(UUIDs.App.Info, this.existingConnection.uuid, 'merge', {
              name: originalName,
              // Add the sanitized name as a separate field
              k8s_name: sanitizedName,
            }),
            // Update the connection configuration
            this.s.client.ConfigDB.patch_config(UUIDs.App.ConnectionConfiguration, this.existingConnection.uuid, 'merge', {
              config: configData,
              driver_uuid: this.selectedDriver.uuid,
              ...(this.selectedDriver?.definition?.polled === true ? { pollInt: parseInt(this.pollInt) } : {}), // Add poll interval only for polled drivers
              source: {
                payloadFormat: payloadFormat,
              },
              topology: {
                cluster: this.node.cluster,
                hostname: this.node.hostname,
              },
            })
          ])

          // Update the edge agent config
          console.debug('Updating edge agent config for connection:', this.existingConnection.uuid)
          await updateEdgeAgentConfig({
            connectionId: this.existingConnection.uuid
          })
          console.debug('Edge agent config update completed')

          toast.success('Success!', {
            description: 'The connection has been updated successfully.',
          })
        }
        else {
          // Log the payload format being saved for new connection
          console.debug('Creating new connection with payload format:', payloadFormat)
          // Create new connection
          const connectionUUID = await this.s.client.ConfigDB.create_object(UUIDs.Class.EdgeAgentConnection)

          // Create the info config first
          await this.s.client.ConfigDB.put_config(UUIDs.App.Info, connectionUUID, {
            name: originalName,
            // Add the sanitized name as a separate field
            k8s_name: sanitizedName,
          })

          // Then create the connection configuration
          const payload = {
            createdAt: new Date().toISOString(),
            config: configData,
            deployment: {},
            driver: this.selectedDriver.uuid,
            edgeAgent: this.node.uuid,
            ...(this.selectedDriver?.definition?.polled === true ? { pollInt: parseInt(this.pollInt) } : {}), // Add poll interval only for polled drivers
            source: {
              payloadFormat: payloadFormat,
            },
            topology: {
              cluster: this.node.cluster,
              hostname: this.node.hostname,
            },
          }

          await this.s.client.ConfigDB.put_config(UUIDs.App.ConnectionConfiguration, connectionUUID, payload)

          // Update the edge agent config
          console.debug('Updating edge agent config for new connection:', connectionUUID)
          await updateEdgeAgentConfig({
            connectionId: connectionUUID
          })
          console.debug('Edge agent config update completed for new connection')

          toast.success('Success!', {
            description: 'The connection has been created successfully.',
          })
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
        // Always reset the form when closing the dialog
        this.resetForm()
      }
    },

    async deleteConnection() {
      if (this.isDeleting) return

      toast.warning('Delete connection?', {
        description: 'Are you sure you want to delete this connection? This action cannot be undone.',
        duration: 5000,
        closeButton: true,
        action: {
          label: 'Delete',
          onClick: async () => {
            this.isDeleting = true

            try {

              // Delete the object itself
              await this.s.client.ConfigDB.delete_object(
                this.existingConnection.uuid
              )

              // Set all devices that use this connection UUID to have a
              // connection value of null (use the deviceStore)
              this.d.data.forEach(device => {
                if (device.deviceInformation.connection === this.existingConnection.uuid) {
                  this.s.client.ConfigDB.patch_config(
                    UUIDs.App.DeviceInformation,
                    device.uuid,
                    'merge',
                    {
                      connection: null,
                    }
                  )
                }
              })


              toast.success('Success!', {
                description: 'The connection has been deleted successfully.',
              })

              this.handleOpen(false)
              this.resetForm()
            } catch (err) {
              console.error('Failed to delete connection:', err)
              toast.error('Unable to delete connection', {
                description: 'There was a problem deleting the connection.',
                action: {
                  label: 'Try again',
                  onClick: () => this.deleteConnection()
                }
              })
            } finally {
              this.isDeleting = false
            }
          }
        }
      })
    }
  },

  data () {
    return {
      node: null,
      name: null,
      selectedDriverName: null,
      pollInt: 1000, // Default to 1000ms (1 second)
      formData: {
        payloadFormat: "Defined by Protocol"
      },
      PAYLOAD_FORMATS,
      isSubmitting: false,
      existingConnection: null,
      isDeleting: false,
    }
  },
}
</script>
