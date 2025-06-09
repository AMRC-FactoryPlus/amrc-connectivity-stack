<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="dialogOpen" @update:open="e => dialogOpen = e">
    <DialogTrigger>
      <Button>
        <div class="flex items-center justify-center gap-2">
          <i class="fa-solid fa-plus"></i>
          <div>Create Object</div>
        </div>
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[550px]">
      <DialogHeader>
        <DialogTitle>Create a new object</DialogTitle>
        <DialogDescription>Create a new object in the ConfigDB</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col w-full gap-1">
          <label class="text-sm font-medium">Name</label>
          <Input
              title="Object Name"
              class="max-w-sm"
              placeholder="e.g. My Object"
              v-model="v$.objectName.$model"
              :v="v$.objectName"
          />
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col w-full gap-1">
          <div class="flex justify-between items-center">
            <label class="text-sm font-medium">UUID</label>
            <div class="flex items-center space-x-2">
              <Switch :model-value="autoGenerateUuid" @update:model-value="toggleAutoGenerateUuid" id="auto-generate-uuid"/>
              <div class="text-xs text-gray-600">Auto-generate UUID</div>
            </div>
          </div>
          <Input
              v-if="!autoGenerateUuid"
              title="Object UUID"
              class="max-w-sm"
              placeholder="e.g. 00000000-0000-0000-0000-000000000000"
              v-model="v$.objectUuid.$model"
              :v="v$.objectUuid"
          />
          <div v-if="!autoGenerateUuid" class="text-xs text-slate-500">Enter a custom UUID</div>
          <div v-else class="text-xs text-slate-500">UUID will be auto-generated</div>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col w-full gap-1">
          <label class="text-sm font-medium">Type</label>
          <Skeleton v-if="!objs" class="h-16 rounded-lg mb-2" />
          <ObjectSelector
              v-else
              v-model="selectedClass"
              :store-data="objs"
              title="Select Class"
              subtitle="Select the Class the new object should be"
              column1-header="Name"
              column1-main-key="name"
              column1-sub-key="uuid"
              column2-header="Class"
              column2-main-key="class.name"
              column2-sub-key="class.uuid"
              :multi-select="false"
          >
            <div class="w-full border-2 border-dashed border-gray-200 hover:border-gray-300 rounded-lg p-3 pl-4 bg-gray-50 hover:bg-gray-100 gap-4">
              <div v-if="!selectedClass.length" class="flex items-center justify-between gap-4">
                <div class="flex flex-col items-start">
                  <div class="text-sm font-medium">Select a type</div>
                  <div class="text-xs text-gray-400">No type selected</div>
                </div>
                <i class="fa-solid fa-chevron-down mr-2 text-gray-400"></i>
              </div>
              <div v-else class="flex items-center justify-between gap-4">
                <div class="flex flex-col items-start">
                  <div class="text-sm font-medium">{{selectedClass[0].name}}</div>
                  <div class="text-xs text-gray-400">{{selectedClass[0].uuid}}</div>
                </div>
              </div>
            </div>
          </ObjectSelector>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex justify-between items-center">
          <label class="text-sm font-medium">Configuration</label>
          <div class="flex items-center space-x-2">
            <Switch :model-value="settings.useYaml" @update:model-value="toggleYaml" id="yaml-switch"/>
            <div class="text-xs text-gray-600">Edit as Yaml</div>
          </div>
        </div>
        <MonacoEditor
            class="editor min-h-60 w-full border border-slate-300"
            :language="format"
            :value="v$.config.$model"
            @change="editorChange"
            :options="{
              lineNumbers: true,
              tabCompletion: 'on',
              glyphMargin: true,
              automaticLayout: true,
            }"
        />
      </div>

      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <div class="flex justify-between gap-6 flex-1">
          <div class="flex gap-2">
            <div class="flex items-center space-x-2">
              <Switch :model-value="createAnother" @update:model-value="toggleCreateAnother" id="create-another"/>
              <div class="text-xs text-gray-600">Create More</div>
            </div>
          </div>
          <Button :disabled="v$.$invalid" @click="formSubmit" class="ml-auto">
            <div class="flex items-center justify-center gap-2">
              <i class="fa-solid fa-plus"></i>
              <div>Create Object</div>
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
import useVuelidate from '@vuelidate/core'
import { required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { toast } from 'vue-sonner'
import { defineAsyncComponent, h } from 'vue'
import { UUIDs } from '@amrc-factoryplus/rx-client'
import { Checkbox } from '@components/ui/checkbox/index.js'
import { useRouter } from 'vue-router'
import { Switch } from '@/components/ui/switch'
import MonacoEditor from 'vue-monaco'
import yaml from 'yaml'
import { useUserSettingsStore } from '@store/useUserSettingsStore.js'
import {Skeleton} from "@components/ui/skeleton/index.js";

MonacoEditor.render = () => h('div')

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      router: useRouter(),
      settings: useUserSettingsStore(),
    }
  },

  components: {
    Skeleton,
    Switch,
    Checkbox,
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
    MonacoEditor,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
  },

  props: {
    objs: {
      type: Array,
      default: () => [],
    }
  },

  watch: {
    selectedClass: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      const klass = val[0]
      this.classUuid = klass.uuid
    },
  },

  methods: {
    editorChange (e) {
      if (typeof e === 'string' || e instanceof String) {
        this.v$.config.$model = e
      }
    },

    toggleYaml() {
      this.settings.setUseYaml(!this.settings.useYaml)
      if (this.v$.config.$model) {
        const obj = this.parse(this.v$.config.$model)
        this.format = this.settings.useYaml ? 'yaml' : 'json'
        this.v$.config.$model = this.stringify(obj)
      }
    },

    toggleAutoGenerateUuid() {
      this.autoGenerateUuid = !this.autoGenerateUuid
      if (this.autoGenerateUuid) {
        // Clear the UUID field when auto-generate is enabled
        this.objectUuid = null
      }
    },

    toggleCreateAnother() {
      this.createAnother = !this.createAnother
    },

    parse(s) {
      return this.formats[this.format].parse(s)
    },

    stringify(o) {
      return this.formats[this.format].stringify(o)
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      let newObjectUuid = null
      try {
        // If auto-generate is enabled, pass null as the UUID to let the server generate it
        const uuidToUse = this.autoGenerateUuid ? null : this.objectUuid

        newObjectUuid = await this.s.client.ConfigDB.create_object(this.classUuid, uuidToUse)
        if (newObjectUuid) {
          const configData = { name: this.objectName }

          // If we have config data, merge it with the name
          if (this.v$.config.$model) {
            try {
              const configObj = this.parse(this.v$.config.$model)
              Object.assign(configData, configObj)
            } catch (parseErr) {
              toast.error(`Error parsing configuration: ${parseErr.message}`)
              console.error(parseErr)
              return
            }
          }

          await this.s.client.ConfigDB.patch_config(UUIDs.App.Info, newObjectUuid, "merge", configData)
          toast.success(`${this.objectName} has been created with UUID ${newObjectUuid}`)
        } else {
          toast.error(`Unable to create ${this.objectName}`)
          console.error(newObjectUuid)
        }
      } catch (err) {
        toast.error(`Unable to create ${this.objectName}`)
        console.error(err)
      }
      this.objectName = null
      this.objectUuid = null
      this.classUuid = null
      this.config = null
      this.selectedClass = []
      if (!this.createAnother) {
        this.dialogOpen = false
      }
    }
  },

  data () {
    return {
      format: this.settings?.useYaml ? 'yaml' : 'json',
      formats: {
        json: {
          parse: JSON.parse,
          stringify: (o) => JSON.stringify(o, null, 2),
        },
        yaml: {
          parse: yaml.parse,
          stringify: (o) => yaml.stringify(o, null, {
            sortMapEntries: true,
            blockQuote: "literal",
            indent: 2,
          }),
        }
      },
      dialogOpen: false,
      objectName: null,
      objectUuid: null,
      classUuid: null,
      config: '',
      selectedClass: [],
      autoGenerateUuid: true,
      createAnother: false,
    }
  },

  validations: {
    objectName: { required },
    objectUuid: {  },
    classUuid: { required },
    config: {  },
  },
}
</script>