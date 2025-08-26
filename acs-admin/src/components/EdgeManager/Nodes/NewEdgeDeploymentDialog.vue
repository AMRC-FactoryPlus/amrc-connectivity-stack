<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="cluster" @update:open="handleOpen">
    <DialogContent v-if="cluster" class="sm:max-w-[700px]">
      <DialogHeader>
        <DialogTitle>Create a New {{isNode ? 'Node' : 'Edge Deployment'}}</DialogTitle>
        <DialogDescription>Create a new {{isNode ? 'node' : 'edge deployment'}} in the {{cluster.name}} cluster</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-2 flex-1 fix-inset">
        <Input
            title="Name"
            class="max-w-sm"
            :placeholder="`e.g. ${isNode ? 'Cell Gateway' : 'Edge Application 1'}`"
            v-model="v$.name.$model"
            :v="v$.name"
        />
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="host">Host</label>
          <Select name="host" v-model="hostname">
            <SelectTrigger>
              <SelectValue>
                {{hostname ?? 'Floating'}}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="host in hosts" :value="host.hostname" :key="host.hostname">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-medium">{{host.hostname}}</div>
                    <div class="flex items-center justify-center gap-1.5 text-gray-400">
                      <i class="fa-solid fa-microchip text-sm"></i>
                      <div>{{host.arch}}</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div v-if="!isNode" class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="host">Chart</label>
          <Select name="chart" v-model="selectedHelmChart">
            <SelectTrigger>
              <SelectValue>
                {{selectedHelmChart?.name ?? 'Select a chart...'}}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="chart in helmCharts" :value="chart" :key="chart.uuid">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-medium">{{chart.name}}</div>
                  </div>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <div class="flex justify-between items-center">
            <label class="text-sm font-medium" for="host">Values</label>
            <Button variant="outline" @click="toggleYaml" class="mb-1">
              <Checkbox :model-value="settings.useYaml" @click="toggleYaml"/>
              <div class="ml-2">Edit as Yaml</div>
            </Button>
          </div>
          <MonacoEditor
              class="editor min-h-60 w-full border b-slate-300"
              :language="format"
              :value="editorValue"
              @change="editorChange"
              :options="{
              lineNumbers: true,
              tabCompletion: 'on',
              glyphMargin: true,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
              wordWrap: 'on'
            }"
          />
        </div>
      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-plus"></i>
            <div>Create {{isNode ? 'Node' : 'Edge Deployment'}}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { UUIDs } from '@amrc-factoryplus/service-client'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { VisuallyHidden } from 'reka-ui'
import { Input } from '@/components/ui/input'
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useHelmChartStore } from '@store/useHelmChartStore.js'
import { toast } from 'vue-sonner'
import { sparkplug_safe_string } from '@amrc-factoryplus/service-client/lib/sparkplug/util.js'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { TagsInput, TagsInputInput, TagsInputItem, TagsInputItemDelete, TagsInputItemText } from '@/components/ui/tags-input'
import { Checkbox } from '@components/ui/checkbox'
import MonacoEditor from 'vue-monaco'
import { h } from 'vue'
import yaml from 'yaml'
import { useUserSettingsStore } from '@store/useUserSettingsStore.js'

MonacoEditor.render = () => h('div')

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      h: useHelmChartStore(),
      settings: useUserSettingsStore(),
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
    Combobox,
    ComboboxAnchor,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    TagsInput,
    TagsInputInput,
    TagsInputItem,
    TagsInputItemDelete,
    TagsInputItemText,
    Checkbox,
    MonacoEditor,
  },

  mounted () {
    this.h.start()

    // Initialize format from user settings
    this.format = this.settings.useYaml ? 'yaml' : 'json'

    window.events.on('show-new-node-dialog-for-cluster', (cluster) => {
      this.cluster = cluster
    })
    window.events.on('show-new-deployment-dialog-for-cluster', (cluster) => {
      this.isNode  = false
      this.cluster = cluster

      // Initialize empty values in the correct format when opening the dialog
      if (this.values === null) {
        this.values = this.format === 'yaml' ? '' : '{}'
      }
    })
  },

  computed: {
    sparkplugName () {
      return sparkplug_safe_string(this.name)
    },

    hosts () {
      return [
        {
          hostname: 'Floating',
          arch: 'any',
        }, ...this.cluster.status.hosts,
      ]
    },

    helmCharts () {
      // Filter out system charts by checking if they are not instances of SystemHelmChart
      return this.h.data.filter(chart =>
        {
          return chart.class.uuid !== UUIDs.Class.SystemHelmChart
        }
      );
    },

    editorValue () {
      if (this.values === null || this.values === undefined || this.values === '') {
        // Return empty object in the current format (JSON or YAML)
        if (this.format === 'yaml') {
          // In YAML, an empty object can be represented as an empty string or '{}'.
          // Using empty string for cleaner initial state
          return ''
        }
        else {
          return '{}'
        }
      }
      if (typeof this.values === 'string') {
        try {
          // If it's already a string, try to parse it and then stringify it in the correct format
          let parsed
          if (this.format === 'yaml') {
            parsed = yaml.parse(this.values) || {}
          }
          else {
            parsed = JSON.parse(this.values)
          }
          return this.stringify(parsed)
        }
        catch (e) {
          // If parsing fails, return as is (might be invalid JSON or already in YAML format)
          return this.values
        }
      }
      // If it's an object, stringify it in the correct format
      return this.stringify(this.values || {})
    },
  },

  methods: {
    parse (s) {
      return this.formats[this.format].parse(s)
    },

    stringify (o) {
      return this.formats[this.format].stringify(o)
    },

    editorChange (e) {
      if (typeof e === 'string' || e instanceof String) {
        try {
          // Try to parse the editor content to validate it
          const parsed = this.parse(e)
          // Store the parsed content as a string in the correct format
          this.values  = e
        }
        catch (error) {
          console.error('Invalid format in editor:', error)
          // Keep the invalid content in the editor but don't update values
        }
      }
    },

    toggleYaml () {
      this.settings.setUseYaml(!this.settings.useYaml)
      try {
        // Parse the current content and convert to the new format
        let obj = {}
        if (typeof this.values === 'string' && this.values.trim()) {
          try {
            // Try to parse using the current format
            obj = this.parse(this.values)
          }
          catch (e) {
            console.warn('Could not parse current values, using empty object')
          }
        }
        else if (this.values) {
          obj = this.values
        }

        // Update the format first
        this.format = this.settings.useYaml ? 'yaml' : 'json'

        // Then update the values with the new format
        if (Object.keys(obj).length === 0) {
          // For empty objects, use the appropriate representation
          this.values = this.format === 'yaml' ? '' : '{}'
        }
        else {
          this.values = this.stringify(obj)
        }
      }
      catch (error) {
        console.error('Error converting format:', error)
        toast.error('Error converting between formats')
        // Revert the setting if conversion fails
        this.settings.setUseYaml(!this.settings.useYaml)
        this.format = this.settings.useYaml ? 'yaml' : 'json'
      }
    },

    handleOpen (e) {
      if (e === false) {
        this.v$.name.$model = null
        this.v$.name.$reset()
        this.cluster  = null
        this.hostname = null
        this.selectedHelmChart = null
        this.values            = null
        this.isNode            = true
      }
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      try {

        // Create an entry
        let uuid = null
        if (this.isNode) {
          uuid = await this.s.client.ConfigDB.create_object(UUIDs.Class.EdgeAgent)
        }
        else {
          uuid = await this.s.client.ConfigDB.create_object(UUIDs.Class.EdgeDeployment)
        }
        this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
          name: this.name,
        })

        const managerConfig = await this.s.client.ConfigDB.get_config(UUIDs.App.ServiceConfig, UUIDs.Service.Manager)

        let payload = {
          createdAt: new Date().toISOString(),
          name: this.sparkplugName,
          cluster: this.cluster.uuid,
          hostname: this.hostname,
          chart: this.isNode ? managerConfig.helm.agent : this.selectedHelmChart?.uuid,
        }

        if (this.hostname === null || this.hostname === 'Floating') {
          delete payload.hostname
        }

        if (!this.isNode) {
          // Parse values from the editor using the current format (JSON or YAML)
          if (typeof this.values === 'string') {
            if (this.values.trim()) {
              try {
                payload.values = this.parse(this.values)
              }
              catch (e) {
                console.error(`Invalid ${this.format.toUpperCase()} in values:`, e)
                toast.error(`Invalid ${this.format.toUpperCase()} in values field`)
                return
              }
            }
            else {
              // Empty string in YAML mode should be treated as an empty object
              payload.values = {}
            }
          }
          else {
            payload.values = this.values || {}
          }
        }

        this.s.client.ConfigDB.put_config(UUIDs.App.EdgeAgentDeployment, uuid, payload)

        toast.success(`${this.name} has been created!`)
        this.cluster = null

      }
      catch (err) {
        toast.error(`Unable to create new node in ${this.cluster?.name}`)
        console.error(err)
      }
    },
  },

  data () {
    return {
      values: null,
      isNode: true,
      name: null,
      cluster: null,
      hostname: null,
      selectedHelmChart: null,
      format: this.settings.useYaml ? 'yaml' : 'json',
      formats: {
        json: {
          parse: JSON.parse,
          stringify: (o) => JSON.stringify(o, null, 2),
        },
        yaml: {
          parse: yaml.parse,
          stringify: (o) => yaml.stringify(o, null, {
            sortMapEntries: true,
            blockQuote: 'literal',
            indent: 2,
          }),
        },
      },
    }
  },

  validations () {
    return {
      name: {
        required,
        alphaNumUnderscoreSpace: helpers.withMessage('Letters, numbers, spaces and underscores are valid', (value) => {
          return /^[a-zA-Z0-9_ ]*$/.test(value)
        }),

      },
      selectedHelmChart: {
        // Only required if not a node
        requiredWhenNotNode: helpers.withMessage('A chart is required for edge deployments', (value) => this.isNode || value !== null),
      },
    }
  },

}
</script>