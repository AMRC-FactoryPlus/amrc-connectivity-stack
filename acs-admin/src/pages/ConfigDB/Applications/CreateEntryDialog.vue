<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="dialogOpen" @update:open="e => dialogOpen = e">
    <DialogTrigger>
      <Button>
        <div class="flex items-center justify-center gap-2">
          <i class="fa-solid fa-plus"></i>
          <div>Create Entry</div>
        </div>
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[550px]">
      <DialogHeader>
        <DialogTitle>New Application Entry</DialogTitle>
        <DialogDescription>Create a config entry for an object against an application. You can select an existing object or create a new one.</DialogDescription>
      </DialogHeader>
      <Tabs
          v-model="selectedTab"
          class="w-full"
          @update:modelValue="changeNewModel"
      >
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="existing" class="text-xs">
            Existing Object
          </TabsTrigger>
          <TabsTrigger value="new" class="text-xs">
            New Object
          </TabsTrigger>
        </TabsList>
      </Tabs>
        <ObjectSelector
            v-if="!isNewObject"
            v-model="selectedObj"
            :store-data="objs"
            title="Select Existing Object"
            subtitle="Select the object you are adding a configuration for"
            column1-header="Name"
            column1-main-key="name"
            column1-sub-key="uuid"
            column2-header="Class"
            column2-main-key="class.name"
            column2-sub-key="class.uuid"
            :multi-select="false"
        >
          <div class="w-full border-2 border-dashed border-gray-200 hover:border-gray-300 rounded-lg p-3 pl-4 bg-gray-50 hover:bg-gray-100 gap-4">
            <div v-if="!selectedObj.length" class="flex items-center justify-between gap-4">
              <div class="flex flex-col items-start">
                <div class="text-sm font-medium">Select an object</div>
                <div class="text-xs text-gray-400">No object selected</div>
              </div>
              <i class="fa-solid fa-chevron-down mr-2 text-gray-400"></i>
            </div>
            <div v-else class="flex items-center justify-between gap-4">
              <div class="flex flex-col items-start">
                <div class="text-sm font-medium">{{selectedObj[0].name}}</div>
                <div class="text-xs text-gray-400">{{selectedObj[0].uuid}}</div>
              </div>
              <div class="text-xs text-muted-foreground uppercase font-bold tracking-wide flex items-center justify-center p-1.5 px-2  text-gray-500 rounded">{{selectedObj[0].class.name}}</div>
            </div>
          </div>
        </ObjectSelector>

      <div class="flex flex-col gap-2">
        <div v-if="isNewObject" class="flex flex-col w-full gap-1">
          <label class="text-sm font-medium">Type</label>
          <ObjectSelector
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
        <div v-if="isNewObject" class="flex justify-center gap-6 overflow-auto flex-1 fix-inset items-end">
          <div class="flex flex-col w-full gap-1">
            <label class="text-sm font-medium">Name</label>
            <Input
                :disabled="!isNewObject"
                title="Object Name"
                class="max-w-sm"
                placeholder="e.g. My Object"
                v-model="v$.objectName.$model"
                :v="v$.objectName"
            />
          </div>
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
              <Switch :model-value="createAnother" @update:model-value="() => {createAnother = !createAnother; navigateAfter = false}" id="create-another"/>
              <div class="text-xs text-gray-600">Create More</div>
            </div>
          </div>
          <!--            <Button variant="outline" @click="() => {navigateAfter = !navigateAfter; createAnother = false}">-->
          <!--              <Checkbox :model-value="navigateAfter" @click="() => {navigateAfter = !navigateAfter; createAnother = false}" />-->
          <!--              <div class="ml-2">Navigate after?</div>-->
          <!--            </Button>-->
        </div>
        <Button :disabled="v$.$invalid" @click="formSubmit" class="ml-auto">
            <div class="flex items-center justify-center gap-2">
              <i class="fa-solid fa-plus"></i>
              <div>Create Entry</div>
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
import useVuelidate from '@vuelidate/core'
import { required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { toast } from 'vue-sonner'
import { defineAsyncComponent, h } from 'vue'
import { UUIDs } from '@amrc-factoryplus/rx-client'
import { Checkbox } from '@components/ui/checkbox/index.js'
import { useRouter } from 'vue-router'
import ObjectList from '@pages/ConfigDB/Objects/ObjectList.vue'
import CreateObjectDialog from '@pages/ConfigDB/CreateObjectDialog.vue'
import ApplicationList from '@pages/ConfigDB/Applications/ApplicationList.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs/index.js'
import { Switch } from '@/components/ui/switch'
import MonacoEditor from 'vue-monaco'
import yaml from 'yaml'
import { useUserSettingsStore } from '@store/useUserSettingsStore.js'

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
    Switch,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    ApplicationList,
    CreateObjectDialog,
    ObjectList,
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
    app: {
      type: String,
      required: true,
    },
    objs: {
      type: Array,
      default: () => [],
    },
  },

  watch: {
    isNewObject: async function(val, oldVal) {
      this.objectUuid = null
      this.objectName = null
      this.classUuid = null
    },
    selectedObj: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      const object = val[0]
      this.objectUuid = object.uuid
      this.objectName = object.name
      this.classUuid = object.class.uuid
    },
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

    parse(s) {
      return this.formats[this.format].parse(s)
    },

    stringify(o) {
      return this.formats[this.format].stringify(o)
    },

    changeNewModel (newModel) {
      this.selectedTab = newModel
      if (newModel === 'new') {
        this.isNewObject = true
      }
      else {
        this.isNewObject = false
      }
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      let newObjectUuid = null
      if (this.isNewObject) {
        try {
          newObjectUuid = await this.s.client.ConfigDB.create_object(this.classUuid, this.objectUuid)
          if (newObjectUuid) {
            await this.s.client.ConfigDB.patch_config(UUIDs.App.Info, newObjectUuid, "merge", {name: this.objectName})
          } else {
            toast.error(`Unable to create ${this.objectName}`)
            console.error(newObjectUuid)
          }
        } catch (err) {
          toast.error(`Unable to create ${this.objectName}`)
          console.error(err)
        }
      } else {
        newObjectUuid = this.objectUuid
      }
      try {
        // Parse the config value based on the current format
        const configObj = this.v$.config.$model ? this.parse(this.v$.config.$model) : null
        await this.s.client.ConfigDB.put_config(this.app, newObjectUuid, configObj)
        toast.success(`Config entry for ${this.objectName} created successfully.`)
      } catch (err) {
        toast.error(`Unable to create entry for ${this.objectName}`)
        console.error(err)
      }
      this.objectName = null
      this.objectUuid = null
      this.classUuid = null
      this.selectedClass = []
      if (!this.createAnother) {
        this.dialogOpen = false
      }
      if (newObjectUuid && this.navigateAfter) {
        this.router.push({ path: `/configdb/applications/${this.app}/${newObjectUuid}` })
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
      selectedTab: 'existing',
      dialogOpen: false,
      isNewObject: false,
      objectName: null,
      objectUuid: null,
      classUuid: null,
      config: '',
      selectedClass: [],
      selectedObj: [],
      navigateAfter: false,
      createAnother: false,
    }
  },

  validations: {
    objectName: {  },
    objectUuid: {  },
    classUuid: { required },
    config: {  },
  },
}
</script>