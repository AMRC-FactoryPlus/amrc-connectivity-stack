<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="dialogOpen" @update:open="e => dialogOpen = e">
    <DialogTrigger>
      <Button>
        <div class="flex items-center justify-center gap-2">
<!--          <i class="fa-solid fa-user-plus"></i>-->
          <div>Create Config Entry</div>
        </div>
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[550px]">
      <DialogHeader>
        <DialogTitle>Create a new config entry</DialogTitle>
        <DialogDescription>Create a config entry for an object. The object can be an existing one or a new one.</DialogDescription>
      </DialogHeader>
      <div class="flex justify-between">
        <Button variant="outline" @click="() => {isNewObject = !isNewObject}">
          <Checkbox :model-value="isNewObject" @click="() => {isNewObject = !isNewObject}" />
          <div class="ml-2">Create New Object?</div>
        </Button>
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
          <Button>Select Object</Button>
        </ObjectSelector>
      </div>
      <div class="flex justify-center gap-6 overflow-auto flex-1 fix-inset items-end">
        <Input
            :disabled="!isNewObject"
            title="Object Name"
            class="max-w-sm"
            placeholder="e.g. My Object"
            v-model="v$.objectName.$model"
            :v="v$.objectName"
        />
      </div>
      <div class="flex gap-6 overflow-auto flex-1 fix-inset items-end">
        <Input
            v-if="isNewObject"
            title="Class UUID"
            class="max-w-sm"
            placeholder="e.g. 00000000-0000-0000-0000-000000000000"
            v-model="v$.classUuid.$model"
            :v="v$.classUuid"
        />
        <ObjectSelector
            v-if="isNewObject"
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
          <Button>Select</Button>
        </ObjectSelector>
      </div>
      <div>
        <div>Config Value (JSON)</div>
        <textarea class="border border-slate-300" v-model="v$.config.$model"></textarea>
      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <div class="flex justify-between gap-6">
          <div class="flex gap-2">
            <Button variant="outline" @click="() => {navigateAfter = !navigateAfter; createAnother = false}">
              <Checkbox :model-value="navigateAfter" @click="() => {navigateAfter = !navigateAfter; createAnother = false}" />
              <div class="ml-2">Navigate after?</div>
            </Button>
            <Button variant="outline" @click="() => {createAnother = !createAnother; navigateAfter = false}">
              <Checkbox :model-value="createAnother" @click="() => {createAnother = !createAnother; navigateAfter = false}" />
              <div class="ml-2">Create another?</div>
            </Button>
          </div>
          <Button :disabled="v$.$invalid" @click="formSubmit">
            <div class="flex items-center justify-center gap-2">
              <!--            <i class="fa-solid fa-user-plus"></i>-->
              <div>Create Entry</div>
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
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import {defineAsyncComponent} from "vue";
import {UUIDs} from "@amrc-factoryplus/rx-client";
import {Checkbox} from "@components/ui/checkbox/index.js";
import {useRouter} from "vue-router";

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      router: useRouter(),
    }
  },

  components: {
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
        await this.s.client.ConfigDB.put_config(this.app, newObjectUuid, this.config)
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
      dialogOpen: false,
      isNewObject: false,
      objectName: null,
      objectUuid: null,
      classUuid: null,
      config: null,
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