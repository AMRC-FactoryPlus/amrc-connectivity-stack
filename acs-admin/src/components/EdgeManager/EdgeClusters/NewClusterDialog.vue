<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="showing" @update:open="handleOpen">
    <DialogContent v-if="showing" class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create a New Edge Cluster</DialogTitle>
        <DialogDescription>Create a new edge cluster to logically group nodes</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-3 overflow-auto flex-1 fix-inset">
        <Input
            title="Name"
            class="max-w-sm"
            placeholder="e.g. Building 1"
            v-model="v$.name.$model"
            :v="v$.name"
        />
        <Collapsible class="px-2">
          <div class="flex items-center justify-between">
            <div class="text-sm text-gray-600">
              Show advanced options
            </div>
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="w-9 p-0">
                <i class="fa-solid fa-chevron-down text-gray-600"></i>
                <span class="sr-only">Toggle</span>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent class="space-y-2">
            <div class="flex items-center gap-3 rounded py-2">
              <Checkbox v-model="bare" id="bare"/>
              <label for="bare" class="flex flex-col gap-1">
                <div class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Bare Deployment</div>
                <div class="text-xs leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-600">Flux and Sealed Secrets are already deployed to this cluster</div>
              </label>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message" class="mt-6">
        <Button :disabled="v$.$invalid" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-plus"></i>
            <div>Create Edge Cluster</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Checkbox } from '@components/ui/checkbox'
import { VisuallyHidden } from 'reka-ui'
import { Input } from '@/components/ui/input'
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { toast } from 'vue-sonner'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { sparkplug_safe_string } from '@amrc-factoryplus/service-client/lib/sparkplug/util.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { UUIDs } from '@amrc-factoryplus/service-client'

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      e: useEdgeClusterStore(),
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
    Checkbox,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
  },

  mounted () {
    window.events.on('show-new-cluster-dialog', () => {
      this.showing = true
    })
  },

  computed: {
    sparkplugName () {
      return sparkplug_safe_string(this.name)
    },
  },

  methods: {

    handleOpen (e) {
      if (e === false) {
        this.v$.name.$model = null
        this.bare = false;
        this.v$.name.$reset()
        this.showing = false
      }
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      try {

        // Create an entry for the cluster as a member of
        // UUIDs.Class.Device with name as the name
        const edgeClusterUUID = await this.s.client.ConfigDB.create_object(UUIDs.Class.EdgeCluster)
        this.s.client.ConfigDB.put_config(UUIDs.App.Info, edgeClusterUUID, {
          name: this.name,
        })

        const managerConfig = await this.s.client.ConfigDB.get_config(UUIDs.App.ServiceConfig, UUIDs.Service.Manager);

        let config = {
          chart: managerConfig.helm.cluster,
          name: this.sparkplugName,
          namespace: 'fplus-edge',
        };

        if (this.bare) {
          config = {
            ...config,
            bare: true,
            values: {
              sealedSecrets: {
                enabled: false,
              },
            }
          }
        }

        await this.s.client.ConfigDB.put_config(UUIDs.App.EdgeClusterConfiguration, edgeClusterUUID, config)

        toast.success(`The ${this.name} edge cluster has been created!`)
        this.showing = false

        await this.e.refresh()

      }
      catch (err) {
        toast.error(`Unable to create new edge cluster`)
        console.error(err)
      }
    },
  },

  data () {
    return {
      showing: false,
      name: null,
      bare: false,
    }
  },

  validations: {
    name: {
      required,
      alphaNumUnderscoreSpace: helpers.withMessage('Letters, numbers, spaces and underscores are valid', (value) => {
        return /^[a-zA-Z0-9_ ]*$/.test(value)
      }),

    },
  },
}
</script>